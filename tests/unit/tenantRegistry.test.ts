import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { CentralRegistry } from '../../src/tenancy/centralRegistry.js';
import type { CentralRegistryRow } from '../../src/tenancy/descriptor.js';
import { mapTenantDescriptor } from '../../src/tenancy/descriptor.js';

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';

function registryRow(overrides: Partial<CentralRegistryRow> = {}): CentralRegistryRow {
  return {
    IdDatabase: 10,
    IdCompany: 7,
    CompanyName: 'Tenant A',
    CompanyUUID: COMPANY_UUID,
    Hostname: '127.0.0.1',
    Port: 3306,
    DBName: 'tenant_a',
    Username: 'tenant_user',
    Password: 'tenant_secret',
    DatabaseRecordId: 10,
    LocalIdentityCount: 1,
    ...overrides
  };
}

function registryPool(rows: CentralRegistryRow[]) {
  const execute = vi.fn().mockResolvedValue([rows, []]);
  const end = vi.fn().mockResolvedValue(undefined);
  return { pool: { execute, end } as unknown as Pool, execute, end };
}

describe('central Registry e descriptor de tenant', () => {
  it('aceita o contrato central sem campos específicos do Background e protege as credenciais', () => {
    const descriptor = mapTenantDescriptor(registryRow());

    expect(descriptor).toMatchObject({
      companyUUID: COMPANY_UUID,
      idCompany: 7,
      idDatabase: 10,
      companyName: 'Tenant A',
      databaseConfig: {
        host: '127.0.0.1',
        port: 3306,
        database: 'tenant_a',
        user: 'tenant_user',
        password: 'tenant_secret'
      }
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.databaseConfig)).toBe(true);
  });

  it.each([
    { name: 'UUID inválido', overrides: { CompanyUUID: 'tenant-a' } },
    { name: 'IdDatabase inconsistente', overrides: { DatabaseRecordId: 20 } },
    { name: 'porta inválida', overrides: { Port: 65536 } },
    { name: 'host ausente', overrides: { Hostname: ' ' } },
    { name: 'banco ausente', overrides: { DBName: '' } },
    { name: 'usuário ausente', overrides: { Username: null } }
  ])('rejeita descriptor com $name', ({ overrides }) => {
    expect(() => mapTenantDescriptor(registryRow(overrides))).toThrow();
  });

  it('normaliza UUID antes da consulta e reutiliza a resposta em cache', async () => {
    const fake = registryPool([registryRow()]);
    const registry = new CentralRegistry(fake.pool, { ttlMs: 60_000 });

    const first = await registry.resolveByCompanyUUID(COMPANY_UUID.toUpperCase());
    const second = await registry.resolveByCompanyUUID(COMPANY_UUID);

    expect(first).toBe(second);
    expect(fake.execute).toHaveBeenCalledTimes(1);
    expect(fake.execute.mock.calls[0]?.[1]).toEqual([COMPANY_UUID]);
    await registry.close();
  });

  it('deduplica resoluções simultâneas do mesmo CompanyUUID', async () => {
    let resolveQuery!: (result: unknown) => void;
    const query = new Promise<unknown>((resolve) => { resolveQuery = resolve; });
    const execute = vi.fn(() => query);
    const end = vi.fn().mockResolvedValue(undefined);
    const registry = new CentralRegistry({ execute, end } as unknown as Pool, { ttlMs: 60_000 });

    const first = registry.resolveByCompanyUUID(COMPANY_UUID);
    const second = registry.resolveByCompanyUUID(COMPANY_UUID);
    expect(execute).toHaveBeenCalledTimes(1);

    resolveQuery([[registryRow()], []]);
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { companyUUID: COMPANY_UUID, idCompany: 7 },
      { companyUUID: COMPANY_UUID, idCompany: 7 }
    ]);
    await registry.close();
  });

  it('retorna TENANT_NOT_FOUND quando o UUID não existe', async () => {
    const fake = registryPool([]);
    const registry = new CentralRegistry(fake.pool, { ttlMs: 60_000 });

    await expect(registry.resolveByCompanyUUID(COMPANY_UUID))
      .rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    await expect(registry.resolveByCompanyUUID(COMPANY_UUID))
      .rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    expect(fake.execute).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  it.each([
    { name: 'vínculo Company/Databases divergente', rows: [registryRow({ DatabaseRecordId: 20 })] },
    { name: 'identidade local duplicada', rows: [registryRow({ LocalIdentityCount: 2 })] },
    { name: 'UUID duplicado', rows: [registryRow(), registryRow({ IdCompany: 8 })] }
  ])('rejeita $name como TENANT_REGISTRY_INVALID', async ({ rows }) => {
    const fake = registryPool(rows);
    const registry = new CentralRegistry(fake.pool, { ttlMs: 60_000 });

    await expect(registry.resolveByCompanyUUID(COMPANY_UUID))
      .rejects.toMatchObject({ code: 'TENANT_REGISTRY_INVALID' });
    await registry.close();
  });

  it('não expõe credenciais quando o Registry falha', async () => {
    const error = Object.assign(new Error('password=super-secret'), { code: 'ECONNREFUSED' });
    const execute = vi.fn().mockRejectedValue(error);
    const end = vi.fn().mockResolvedValue(undefined);
    const registry = new CentralRegistry({ execute, end } as unknown as Pool, { ttlMs: 0 });

    await expect(registry.resolveByCompanyUUID(COMPANY_UUID))
      .rejects.toMatchObject({ code: 'REGISTRY_UNAVAILABLE' });
    await registry.close();
  });
});
