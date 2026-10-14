import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';

const requiredCentralConfig = {
  CENTRAL_DB_HOST: 'central-db.internal',
  CENTRAL_DB_NAME: 'registry',
  CENTRAL_DB_USER: 'mcp_registry_reader',
  CENTRAL_DB_PASS: 'test-secret'
};

describe('configuração multi-tenant', () => {
  it('usa defaults e converte allowlist UUID para lowercase', () => {
    const config = loadEnv({
      ...requiredCentralConfig,
      MCP_TENANT_ALLOWLIST: '11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222'.toUpperCase()
    } as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      port: 3102,
      centralDb: { port: 3306, connectionLimit: 4 },
      centralRegistryCacheMs: 60_000,
      tenantDb: {
        connectionLimit: 8,
        connectTimeoutMs: 10_000,
        maxPools: 32,
        idleTtlMs: 300_000
      },
      coreApiTimeoutMs: 60_000,
      mcpCoreSettingsCacheMs: 60_000,
      mcpShutdownTimeoutMs: 75_000
    });
    expect(config.mcpTenantAllowlist).toEqual(new Set([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    ]));
  });

  it('exige allowlist não vazia em produção', () => {
    expect(() => loadEnv({
      ...requiredCentralConfig,
      NODE_ENV: 'production',
      MCP_TENANT_ALLOWLIST: '  '
    } as NodeJS.ProcessEnv)).toThrow('MCP_TENANT_ALLOWLIST é obrigatório em produção');
  });

  it.each([
    { name: 'UUID inválido', allowlist: 'tenant-a' },
    {
      name: 'UUID duplicado após normalizar caixa',
      allowlist: '11111111-1111-4111-8111-111111111111,11111111-1111-4111-8111-111111111111'.toUpperCase()
    }
  ])('rejeita $name na allowlist', ({ allowlist }) => {
    expect(() => loadEnv({
      ...requiredCentralConfig,
      MCP_TENANT_ALLOWLIST: allowlist
    } as NodeJS.ProcessEnv)).toThrow('MCP_TENANT_ALLOWLIST');
  });

  it('não transforma os antigos DB_* e CORE_API_URL globais em configuração do tenant', () => {
    const config = loadEnv({
      ...requiredCentralConfig,
      DB_HOST: 'legacy.example.invalid',
      DB_USER: 'legacy-user',
      CORE_API_URL: 'http://legacy.example.invalid'
    } as NodeJS.ProcessEnv);

    expect(config).not.toHaveProperty('db');
    expect(config).not.toHaveProperty('coreApiUrl');
  });
});
