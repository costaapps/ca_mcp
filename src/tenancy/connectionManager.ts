import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';

import {
  createDatabasePool,
  createDrizzleDatabase,
  type DatabaseCredentials,
  type McpDatabase
} from '../database/connection.js';
import { TENANT_ERROR_CODES, tenantError } from './errors.js';

export interface ConnectionManagerOptions {
  readonly connectionLimit: number;
  readonly connectTimeoutMs: number;
  readonly maxPools: number;
  readonly idleTtlMs: number;
  readonly now?: () => number;
  readonly createPool?: (
    credentials: DatabaseCredentials,
    options: { connectionLimit: number; connectTimeoutMs: number }
  ) => Pool;
  readonly logger?: (event: Readonly<Record<string, string | number>>) => void;
}

interface PoolGeneration {
  readonly idDatabase: number;
  readonly generation: number;
  readonly fingerprint: string;
  readonly pool: Pool;
  readonly db: McpDatabase;
  readonly createdAt: number;
  lastUsedAt: number;
  references: number;
  retired: boolean;
  closing: boolean;
  closePromise?: Promise<void>;
}

export interface TenantPoolLease {
  readonly pool: Pool;
  readonly db: McpDatabase;
  readonly generation: number;
  readonly generationKey: string;
  release(): Promise<void>;
}

function fingerprint(config: DatabaseCredentials): string {
  return createHash('sha256')
    .update(JSON.stringify([config.host, config.port, config.database, config.user, config.password]))
    .digest('hex');
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^[A-Z0-9_]{1,80}$/i.test(value.trim()) ? value.trim() : undefined;
}

export class ConnectionManager {
  private readonly now: () => number;
  private readonly poolFactory: NonNullable<ConnectionManagerOptions['createPool']>;
  private readonly logger: NonNullable<ConnectionManagerOptions['logger']>;
  private readonly active = new Set<PoolGeneration>();
  private readonly current = new Map<number, PoolGeneration>();
  private readonly databaseLocks = new Map<number, Promise<void>>();
  private readonly idleTimer: NodeJS.Timeout;
  private readonly waiters = new Set<() => void>();
  private generationSequence = 0;
  private reservations = 0;
  private accepting = true;
  private closed = false;
  private capacityLock: Promise<void> = Promise.resolve();

  public constructor(private readonly options: ConnectionManagerOptions) {
    if (!Number.isSafeInteger(options.connectionLimit) || options.connectionLimit <= 0) {
      throw new TypeError('TENANT_DB_CONNECTION_LIMIT deve ser positivo.');
    }
    if (!Number.isSafeInteger(options.connectTimeoutMs) || options.connectTimeoutMs <= 0) {
      throw new TypeError('TENANT_DB_CONNECT_TIMEOUT_MS deve ser positivo.');
    }
    if (!Number.isSafeInteger(options.maxPools) || options.maxPools <= 0) {
      throw new TypeError('TENANT_DB_MAX_POOLS deve ser positivo.');
    }
    if (!Number.isSafeInteger(options.idleTtlMs) || options.idleTtlMs < 0) {
      throw new TypeError('TENANT_DB_IDLE_TTL_MS deve ser não negativo.');
    }
    this.now = options.now ?? Date.now;
    this.poolFactory = options.createPool ?? createDatabasePool;
    this.logger = options.logger ?? ((event) => console.error(JSON.stringify(event)));
    const intervalMs = Math.max(1000, Math.min(options.idleTtlMs || 1000, 60000));
    this.idleTimer = setInterval(() => {
      void this.evictExpiredIdlePools();
    }, intervalMs);
    this.idleTimer.unref();
  }

  public async acquire(idDatabaseInput: number, credentials: DatabaseCredentials): Promise<TenantPoolLease> {
    const idDatabase = Number(idDatabaseInput);
    if (!Number.isSafeInteger(idDatabase) || idDatabase <= 0) {
      throw tenantError(TENANT_ERROR_CODES.registryInvalid, 'IdDatabase inválido no Registry.');
    }

    return this.withDatabaseLock(idDatabase, async () => {
      this.assertAccepting();
      const nextFingerprint = fingerprint(credentials);
      const existing = this.current.get(idDatabase);
      if (existing?.fingerprint === nextFingerprint && !existing.closing) {
        return this.lease(existing);
      }

      await this.reserveCapacity();
      let pool: Pool | undefined;
      try {
        pool = this.poolFactory(credentials, {
          connectionLimit: this.options.connectionLimit,
          connectTimeoutMs: this.options.connectTimeoutMs
        });
        await pool.execute('SELECT 1');
      } catch (error) {
        if (pool) await pool.end().catch(() => undefined);
        this.reservations -= 1;
        this.notifyWaiters();
        const code = safeCode((error as { code?: unknown } | null)?.code);
        this.logger(Object.freeze({
          event: 'tenant_database_connect_failed',
          idDatabase,
          ...(code ? { errorCode: code } : {})
        }));
        throw tenantError(
          TENANT_ERROR_CODES.databaseUnavailable,
          'A base de dados da empresa está indisponível.'
        );
      }

      this.reservations -= 1;
      if (!this.accepting || this.closed) {
        await pool.end().catch(() => undefined);
        this.notifyWaiters();
        throw tenantError(TENANT_ERROR_CODES.draining, 'O serviço está encerrando.');
      }

      const timestamp = this.now();
      const entry: PoolGeneration = {
        idDatabase,
        generation: ++this.generationSequence,
        fingerprint: nextFingerprint,
        pool,
        db: createDrizzleDatabase(pool),
        createdAt: timestamp,
        lastUsedAt: timestamp,
        references: 0,
        retired: false,
        closing: false
      };
      const previous = this.current.get(idDatabase);
      this.active.add(entry);
      this.current.set(idDatabase, entry);
      if (previous && previous !== entry) {
        previous.retired = true;
        if (previous.references === 0) {
          // Publish the first reference before awaiting the old generation's
          // asynchronous close. Capacity eviction must not mistake this new
          // generation for an idle pool while this acquisition is suspended.
          const firstLease = this.lease(entry);
          try {
            await this.closeEntry(previous);
            this.assertLeaseUsable(entry);
            return firstLease;
          } catch (error) {
            entry.retired = true;
            await firstLease.release();
            throw error;
          }
        }
      }
      return this.lease(entry);
    });
  }

  public beginDrain(): void {
    this.accepting = false;
  }

  public async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.activeReferences() === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const becameIdle = new Promise<boolean>((resolve) => {
      const resolveWhenIdle = (): void => {
        if (this.activeReferences() !== 0) return;
        this.waiters.delete(resolveWhenIdle);
        if (timer) clearTimeout(timer);
        resolve(true);
      };
      this.waiters.add(resolveWhenIdle);
      timer = setTimeout(() => {
        this.waiters.delete(resolveWhenIdle);
        resolve(false);
      }, Math.max(0, timeoutMs));
    });
    return becameIdle;
  }

  public async closeAll(timeoutMs = 0): Promise<void> {
    this.beginDrain();
    clearInterval(this.idleTimer);
    const idle = await this.waitForIdle(timeoutMs);
    if (!idle) {
      this.logger(Object.freeze({ event: 'tenant_pool_drain_timeout' }));
    }
    this.closed = true;
    const entries = [...this.active];
    await Promise.allSettled(entries.map((entry) => this.closeEntry(entry)));
  }

  public diagnostics(): readonly Readonly<{
    idDatabase: number;
    generation: number;
    createdAt: number;
    lastUsedAt: number;
    references: number;
    retired: boolean;
  }>[] {
    return Object.freeze([...this.active].map((entry) => Object.freeze({
      idDatabase: entry.idDatabase,
      generation: entry.generation,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
      references: entry.references,
      retired: entry.retired
    })));
  }

  private async reserveCapacity(): Promise<void> {
    const previousLock = this.capacityLock;
    let unlock!: () => void;
    const nextLock = new Promise<void>((resolve) => { unlock = resolve; });
    this.capacityLock = previousLock.then(() => nextLock);
    await previousLock;
    try {
      this.assertAccepting();
      while (this.active.size + this.reservations >= this.options.maxPools) {
        const idle = [...this.active]
          .filter((entry) => entry.references === 0 && !entry.closing)
          .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
        const entry = idle[0];
        if (entry) {
          await this.closeEntry(entry);
          continue;
        }
        const closing = [...this.active]
          .filter((candidate) => candidate.closing && candidate.closePromise !== undefined)
          .map((candidate) => candidate.closePromise as Promise<void>);
        if (closing.length > 0) {
          await Promise.all(closing);
          continue;
        }
        break;
      }
      if (this.active.size + this.reservations >= this.options.maxPools) {
        throw tenantError(
          TENANT_ERROR_CODES.poolCapacity,
          'O limite de conexões simultâneas para bases de empresas foi atingido.'
        );
      }
      this.reservations += 1;
    } finally {
      unlock();
    }
  }

  private async evictExpiredIdlePools(): Promise<void> {
    if (this.closed) return;
    const expiresBefore = this.now() - this.options.idleTtlMs;
    const expired = [...this.active].filter((entry) =>
      entry.references === 0 && entry.lastUsedAt <= expiresBefore
    );
    await Promise.allSettled(expired.map((entry) => this.closeEntry(entry)));
  }

  private async closeEntry(entry: PoolGeneration): Promise<void> {
    if (entry.closePromise) return entry.closePromise;
    entry.closing = true;
    if (this.current.get(entry.idDatabase) === entry) this.current.delete(entry.idDatabase);
    entry.closePromise = (async () => {
      try {
        await entry.pool.end();
      } catch {
        this.logger(Object.freeze({ event: 'tenant_pool_close_failed', idDatabase: entry.idDatabase }));
      } finally {
        this.active.delete(entry);
        this.notifyWaiters();
      }
    })();
    return entry.closePromise;
  }

  private lease(entry: PoolGeneration): TenantPoolLease {
    if (entry.closing || !this.active.has(entry)) {
      throw tenantError(
        TENANT_ERROR_CODES.databaseUnavailable,
        'A geração da conexão da empresa deixou de estar disponível.'
      );
    }
    entry.references += 1;
    entry.lastUsedAt = this.now();
    let released = false;
    return Object.freeze({
      pool: entry.pool,
      db: entry.db,
      generation: entry.generation,
      generationKey: `${entry.idDatabase}:${entry.generation}`,
      release: async () => {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        entry.lastUsedAt = this.now();
        if (entry.references === 0 && (entry.retired || this.closed)) {
          await this.closeEntry(entry);
        }
        this.notifyWaiters();
      }
    });
  }

  private assertLeaseUsable(entry: PoolGeneration): void {
    this.assertAccepting();
    if (
      entry.closing ||
      !this.active.has(entry) ||
      this.current.get(entry.idDatabase) !== entry
    ) {
      throw tenantError(
        TENANT_ERROR_CODES.databaseUnavailable,
        'A geração da conexão da empresa deixou de estar disponível.'
      );
    }
  }

  private async withDatabaseLock<T>(idDatabase: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.databaseLocks.get(idDatabase) ?? Promise.resolve();
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const tail = previous.then(() => gate);
    this.databaseLocks.set(idDatabase, tail);
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
      if (this.databaseLocks.get(idDatabase) === tail) this.databaseLocks.delete(idDatabase);
    }
  }

  private assertAccepting(): void {
    if (!this.accepting || this.closed) {
      throw tenantError(TENANT_ERROR_CODES.draining, 'O serviço está encerrando.');
    }
  }

  private activeReferences(): number {
    return [...this.active].reduce((total, entry) => total + entry.references, 0);
  }

  private notifyWaiters(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

export const connectionManagerInternals = { fingerprint, safeCode };
export { ConnectionManager as TenantConnectionManager };
