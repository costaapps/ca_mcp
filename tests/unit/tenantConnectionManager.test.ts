import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from '../../src/tenancy/connectionManager.js';
import type { DatabaseCredentials } from '../../src/database/connection.js';

interface FakePool {
  pool: Pool;
  execute: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const credentials = (database: string, password = 'secret'): DatabaseCredentials => ({
  host: '127.0.0.1',
  port: 3306,
  database,
  user: 'test-user',
  password
});

function fakePool(execute = vi.fn().mockResolvedValue([[], []])): FakePool {
  const end = vi.fn().mockResolvedValue(undefined);
  return { pool: { execute, end } as unknown as Pool, execute, end };
}

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createManager(options: {
  maxPools?: number;
  idleTtlMs?: number;
  now?: () => number;
  factory?: (credentials: DatabaseCredentials) => Pool;
} = {}): ConnectionManager {
  return new ConnectionManager({
    connectionLimit: 2,
    connectTimeoutMs: 1000,
    maxPools: options.maxPools ?? 4,
    idleTtlMs: options.idleTtlMs ?? 60_000,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.factory === undefined ? {} : { createPool: options.factory })
  });
}

describe('ConnectionManager', () => {
  const managers: ConnectionManager[] = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
    vi.useRealTimers();
  });

  it('deduplica a criação concorrente e compartilha pool pela mesma configuração', async () => {
    const created = fakePool();
    const factory = vi.fn(() => created.pool);
    const manager = createManager({ factory });
    managers.push(manager);

    const [first, second] = await Promise.all([
      manager.acquire(10, credentials('tenant-a')),
      manager.acquire(10, credentials('tenant-a'))
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.pool).toBe(second.pool);
    expect(first.generation).toBe(second.generation);
    expect(manager.diagnostics()).toMatchObject([{ idDatabase: 10, references: 2, retired: false }]);

    await Promise.all([first.release(), second.release()]);
  });

  it('mantém a geração anterior viva até o fim da invocação quando a configuração rota', async () => {
    const oldPool = fakePool();
    const newPool = fakePool();
    const factory = vi.fn()
      .mockReturnValueOnce(oldPool.pool)
      .mockReturnValueOnce(newPool.pool);
    const manager = createManager({ maxPools: 2, factory });
    managers.push(manager);

    const oldLease = await manager.acquire(10, credentials('tenant-a', 'old-secret'));
    const newLease = await manager.acquire(10, credentials('tenant-a', 'new-secret'));

    expect(newLease.generation).toBeGreaterThan(oldLease.generation);
    expect(oldPool.end).not.toHaveBeenCalled();
    expect(manager.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ idDatabase: 10, generation: oldLease.generation, references: 1, retired: true }),
      expect.objectContaining({ idDatabase: 10, generation: newLease.generation, references: 1, retired: false })
    ]));

    await oldLease.release();
    expect(oldPool.end).toHaveBeenCalledTimes(1);
    await newLease.release();
  });

  it('protege a geração nova enquanto fecha a antiga sob pressão de capacidade', async () => {
    const oldCloseStarted = deferred<void>();
    const allowOldClose = deferred<void>();
    const oldPool = fakePool();
    oldPool.end.mockImplementation(async () => {
      oldCloseStarted.resolve();
      await allowOldClose.promise;
    });
    const rotatedPool = fakePool();
    const competingPool = fakePool();
    const factory = vi.fn()
      .mockReturnValueOnce(oldPool.pool)
      .mockReturnValueOnce(rotatedPool.pool)
      .mockReturnValueOnce(competingPool.pool);
    const manager = createManager({ maxPools: 2, factory });
    managers.push(manager);

    const original = await manager.acquire(10, credentials('tenant-a', 'old-secret'));
    await original.release();

    const rotating = manager.acquire(10, credentials('tenant-a', 'rotated-secret'));
    void rotating.catch(() => undefined);
    await oldCloseStarted.promise;

    // The old close is deliberately held open. Acquiring a different database
    // now forces the capacity path while the new generation has been published.
    const competing = manager.acquire(20, credentials('tenant-b'));
    void competing.catch(() => undefined);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(factory).toHaveBeenCalledTimes(2);
      expect(rotatedPool.end).not.toHaveBeenCalled();
      expect(manager.diagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ idDatabase: 10, references: 1, retired: false }),
        expect.objectContaining({ idDatabase: 10, references: 0, retired: true })
      ]));

      allowOldClose.resolve();
      const [rotatedLease, competingLease] = await Promise.all([rotating, competing]);

      expect(rotatedLease.pool).toBe(rotatedPool.pool);
      expect(rotatedPool.end).not.toHaveBeenCalled();
      expect(competingLease.pool).toBe(competingPool.pool);
      expect(factory).toHaveBeenCalledTimes(3);

      await Promise.all([rotatedLease.release(), competingLease.release()]);
    } finally {
      // Never leave the controlled old-pool close pending if an assertion fails.
      allowOldClose.resolve();
    }
    await manager.closeAll();

    expect(oldPool.end).toHaveBeenCalledTimes(1);
    expect(rotatedPool.end).toHaveBeenCalledTimes(1);
    expect(competingPool.end).toHaveBeenCalledTimes(1);
    expect(manager.diagnostics()).toEqual([]);
  });

  it('não encerra pools em uso para abrir espaço e retorna erro estável de capacidade', async () => {
    const firstPool = fakePool();
    const factory = vi.fn(() => firstPool.pool);
    const manager = createManager({ maxPools: 1, factory });
    managers.push(manager);

    const lease = await manager.acquire(10, credentials('tenant-a'));
    await expect(manager.acquire(20, credentials('tenant-b')))
      .rejects.toMatchObject({ code: 'TENANT_POOL_CAPACITY' });

    expect(firstPool.end).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
    await lease.release();
  });

  it('remove um pool ocioso para abrir espaço quando o limite é atingido', async () => {
    const firstPool = fakePool();
    const secondPool = fakePool();
    const factory = vi.fn()
      .mockReturnValueOnce(firstPool.pool)
      .mockReturnValueOnce(secondPool.pool);
    const manager = createManager({ maxPools: 1, factory });
    managers.push(manager);

    const first = await manager.acquire(10, credentials('tenant-a'));
    await first.release();
    const second = await manager.acquire(20, credentials('tenant-b'));

    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(second.pool).toBe(secondPool.pool);
    await second.release();
  });

  it('evicta pools ociosos pelo TTL sem encerrar leases ativos', async () => {
    vi.useFakeTimers();
    let timestamp = 100;
    const created = fakePool();
    const manager = createManager({
      idleTtlMs: 2000,
      now: () => timestamp,
      factory: () => created.pool
    });
    managers.push(manager);

    const lease = await manager.acquire(10, credentials('tenant-a'));
    timestamp = 5000;
    await vi.advanceTimersByTimeAsync(2000);
    expect(created.end).not.toHaveBeenCalled();

    await lease.release();
    timestamp = 9000;
    await vi.advanceTimersByTimeAsync(2000);
    expect(created.end).toHaveBeenCalledTimes(1);
    expect(manager.diagnostics()).toEqual([]);
  });

  it('isola uma falha de conexão e segue atendendo outros bancos', async () => {
    const unavailable = fakePool(vi.fn().mockRejectedValue(Object.assign(new Error('secret'), { code: 'ECONNREFUSED' })));
    const available = fakePool();
    const factory = vi.fn((dbCredentials: DatabaseCredentials) =>
      dbCredentials.database === 'offline' ? unavailable.pool : available.pool
    );
    const manager = createManager({ factory });
    managers.push(manager);

    await expect(manager.acquire(10, credentials('offline')))
      .rejects.toMatchObject({ code: 'TENANT_DATABASE_UNAVAILABLE' });
    const lease = await manager.acquire(20, credentials('online'));

    expect(unavailable.end).toHaveBeenCalledTimes(1);
    expect(lease.pool).toBe(available.pool);
    expect(manager.diagnostics()).toMatchObject([{ idDatabase: 20, references: 1 }]);
    await lease.release();
  });

  it('drena leases existentes e rejeita aquisições novas após beginDrain', async () => {
    const created = fakePool();
    const manager = createManager({ factory: () => created.pool });
    managers.push(manager);
    const lease = await manager.acquire(10, credentials('tenant-a'));

    manager.beginDrain();
    await expect(manager.acquire(20, credentials('tenant-b')))
      .rejects.toMatchObject({ code: 'TENANT_RUNTIME_DRAINING' });
    await expect(manager.waitForIdle(0)).resolves.toBe(false);
    await lease.release();
    await expect(manager.waitForIdle(0)).resolves.toBe(true);

    await manager.closeAll();
    expect(created.end).toHaveBeenCalledTimes(1);
  });
});
