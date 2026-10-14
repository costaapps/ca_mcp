import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/config/env.js';
import { createTenantRuntime } from '../../src/tenancy/tenantRuntime.js';
import type { CentralRegistryRow } from '../../src/tenancy/descriptor.js';

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';

function config() {
  return loadEnv({
    NODE_ENV: 'test',
    CENTRAL_DB_HOST: '127.0.0.1',
    CENTRAL_DB_PORT: '3306',
    CENTRAL_DB_NAME: 'registry_test',
    CENTRAL_DB_USER: 'registry_reader',
    CENTRAL_DB_PASS: 'registry-secret',
    MCP_TENANT_ALLOWLIST: COMPANY_UUID
  } as NodeJS.ProcessEnv);
}

function registryRow(): CentralRegistryRow {
  return {
    IdDatabase: 10,
    IdCompany: 7,
    CompanyName: 'Tenant A',
    CompanyUUID: COMPANY_UUID,
    Hostname: '127.0.0.1',
    Port: 3306,
    DBName: 'tenant_a',
    Username: 'tenant_user',
    Password: 'tenant-secret',
    DatabaseRecordId: 10,
    LocalIdentityCount: 1
  };
}

function metadata() {
  return { Execution: { CompanyUUID: COMPANY_UUID } };
}

describe('TenantRuntime readiness e isolamento', () => {
  it('mantém readiness saudável quando uma base de empresa falha', async () => {
    const centralPool = {
      query: vi.fn().mockResolvedValue([[], []]),
      execute: vi.fn().mockResolvedValue([[registryRow()], []]),
      end: vi.fn().mockResolvedValue(undefined)
    } as unknown as Pool;
    const unavailableTenantPool = {
      execute: vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })),
      end: vi.fn().mockResolvedValue(undefined)
    } as unknown as Pool;
    const createPool = vi.fn(() => unavailableTenantPool);
    const runtime = createTenantRuntime(config(), { centralPool, createPool });

    await expect(runtime.provider.withTenantContext(metadata(), async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'TENANT_DATABASE_UNAVAILABLE' });

    expect(await runtime.isReady()).toBe(true);
    expect(centralPool.query).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(unavailableTenantPool.end).toHaveBeenCalledTimes(1);
  });

  it('retorna not ready quando o Registry falha ou o runtime está em drenagem', async () => {
    const query = vi.fn().mockRejectedValue(Object.assign(new Error('permission denied'), {
      code: 'ER_TABLEACCESS_DENIED_ERROR'
    }));
    const centralPool = {
      query,
      execute: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined)
    } as unknown as Pool;
    const runtime = createTenantRuntime(config(), { centralPool });

    expect(await runtime.isReady()).toBe(false);
    expect(query).toHaveBeenCalledWith({ sql: expect.any(String), timeout: 5000 });

    query.mockResolvedValue([[], []]);
    expect(await runtime.isReady()).toBe(true);

    runtime.beginDrain();
    expect(await runtime.isReady()).toBe(false);
    await expect(runtime.provider.withTenantContext(metadata(), async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'TENANT_RUNTIME_DRAINING' });
    await runtime.close();
  });
});
