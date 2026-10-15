import { z } from 'zod';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3102),
  NODE_ENV: z.string().default('development'),
  CENTRAL_DB_HOST: z.string().trim().min(1, 'CENTRAL_DB_HOST é obrigatório'),
  CENTRAL_DB_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  CENTRAL_DB_NAME: z.string().trim().min(1, 'CENTRAL_DB_NAME é obrigatório'),
  CENTRAL_DB_USER: z.string().trim().min(1, 'CENTRAL_DB_USER é obrigatório'),
  CENTRAL_DB_PASS: z.string().min(1, 'CENTRAL_DB_PASS é obrigatório'),
  CENTRAL_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(4),
  CENTRAL_REGISTRY_CACHE_MS: z.coerce.number().int().positive().default(60000),
  TENANT_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(8),
  TENANT_DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  TENANT_DB_MAX_POOLS: z.coerce.number().int().positive().default(32),
  TENANT_DB_IDLE_TTL_MS: z.coerce.number().int().positive().default(300000),
  MCP_CORE_SETTINGS_CACHE_MS: z.coerce.number().int().positive().default(60000),
  CORE_API_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  MCP_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(75000),
  MCP_TENANT_ALLOWLIST: z.string().optional()
}).superRefine((value, context) => {
  const raw = value.MCP_TENANT_ALLOWLIST?.trim() ?? '';
  if (value.NODE_ENV === 'production' && raw.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['MCP_TENANT_ALLOWLIST'],
      message: 'MCP_TENANT_ALLOWLIST é obrigatório em produção.'
    });
  }

  if (raw.length === 0) return;
  const seen = new Set<string>();
  for (const item of raw.split(',')) {
    const uuid = item.trim().toLowerCase();
    if (!uuidPattern.test(uuid)) {
      context.addIssue({
        code: 'custom',
        path: ['MCP_TENANT_ALLOWLIST'],
        message: 'MCP_TENANT_ALLOWLIST deve conter UUIDs válidos separados por vírgula.'
      });
      return;
    }
    if (seen.has(uuid)) {
      context.addIssue({
        code: 'custom',
        path: ['MCP_TENANT_ALLOWLIST'],
        message: 'MCP_TENANT_ALLOWLIST contém UUID duplicado após normalização.'
      });
      return;
    }
    seen.add(uuid);
  }
});

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface EnvConfig {
  port: number;
  nodeEnv: string;
  centralDb: DatabaseConfig & {
    connectionLimit: number;
  };
  centralRegistryCacheMs: number;
  tenantDb: {
    connectionLimit: number;
    connectTimeoutMs: number;
    maxPools: number;
    idleTtlMs: number;
  };
  mcpCoreSettingsCacheMs: number;
  coreApiTimeoutMs: number;
  mcpShutdownTimeoutMs: number;
  /** null means no development allowlist was configured; production always has a set. */
  mcpTenantAllowlist: ReadonlySet<string> | null;
}

export function loadEnv(environment: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = environmentSchema.parse(environment);
  const allowlist = parsed.MCP_TENANT_ALLOWLIST?.trim();

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    centralDb: {
      host: parsed.CENTRAL_DB_HOST,
      port: parsed.CENTRAL_DB_PORT,
      user: parsed.CENTRAL_DB_USER,
      password: parsed.CENTRAL_DB_PASS,
      database: parsed.CENTRAL_DB_NAME,
      connectionLimit: parsed.CENTRAL_DB_CONNECTION_LIMIT
    },
    centralRegistryCacheMs: parsed.CENTRAL_REGISTRY_CACHE_MS,
    tenantDb: {
      connectionLimit: parsed.TENANT_DB_CONNECTION_LIMIT,
      connectTimeoutMs: parsed.TENANT_DB_CONNECT_TIMEOUT_MS,
      maxPools: parsed.TENANT_DB_MAX_POOLS,
      idleTtlMs: parsed.TENANT_DB_IDLE_TTL_MS
    },
    mcpCoreSettingsCacheMs: parsed.MCP_CORE_SETTINGS_CACHE_MS,
    coreApiTimeoutMs: parsed.CORE_API_TIMEOUT_MS,
    mcpShutdownTimeoutMs: parsed.MCP_SHUTDOWN_TIMEOUT_MS,
    mcpTenantAllowlist: allowlist ? new Set(allowlist.split(',').map((value) => value.trim().toLowerCase())) : null
  };
}
