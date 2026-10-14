import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'mysql2/promise';

import { CoreFlowClient } from '../core/CoreFlowClient.js';
import { CoreNavigationClient } from '../core/CoreNavigationClient.js';
import type { EnvConfig } from '../config/env.js';
import {
  createDatabasePool,
  type DatabaseCredentials,
  type DatabasePoolOptions,
  type McpDatabase
} from '../database/connection.js';
import { ChatRepository } from '../database/repositories/chatRepository.js';
import { FlowRepository } from '../database/repositories/flowRepository.js';
import { ItemPriceRepository } from '../database/repositories/itemPriceRepository.js';
import { PriceListRepository } from '../database/repositories/priceListRepository.js';
import { ProductRepository } from '../database/repositories/productRepository.js';
import { company } from '../database/schema/company.js';
import { generalSettings } from '../database/schema/generalSettings.js';
import { McpToolError } from '../errors/McpToolError.js';
import type { CAMeta } from '../mcp/context/caMeta.js';
import type { CoreFlowClientContract, CoreNavigationClientContract } from '../core/contracts.js';
import { CentralRegistry } from './centralRegistry.js';
import { ConnectionManager } from './connectionManager.js';
import type { TenantDescriptor } from './descriptor.js';
import { normalizeCompanyUUID } from './descriptor.js';
import { TENANT_ERROR_CODES, tenantError } from './errors.js';
import type { TenantContextProvider, TenantIdentity, TenantInvocationContext } from './contracts.js';

export interface TenantRuntimeDependencies {
  readonly createPool?: (credentials: DatabaseCredentials, options: DatabasePoolOptions) => Pool;
  readonly centralPool?: Pool;
  readonly now?: () => number;
}

export interface TenantRuntime {
  readonly provider: TenantContextProvider;
  isReady(): Promise<boolean>;
  beginDrain(): void;
  close(timeoutMs?: number): Promise<void>;
}

interface CachedValue<T> {
  readonly value: T;
  readonly expiresAt: number;
}

interface CoreClientCacheEntry {
  readonly promise: Promise<CoreFlowClientContract | CoreNavigationClientContract>;
  readonly expiresAt: number;
}

function optionalIdentityNumber(meta: CAMeta, key: 'IdCompany' | 'IdDatabase'): number | undefined {
  const values = [meta.Execution?.[key], meta.Resolved?.[key]]
    .filter((value) => value !== undefined && value !== null);
  if (values.length === 0) return undefined;

  let parsed: number | undefined;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw tenantError(TENANT_ERROR_CODES.identityMismatch, `Contexto ${key} inválido.`);
    }
    if (parsed !== undefined && parsed !== value) {
      throw tenantError(TENANT_ERROR_CODES.identityMismatch, `Contextos ${key} divergentes.`);
    }
    parsed = value;
  }
  return parsed;
}

function getCompanyUUID(meta: CAMeta): string {
  const companyUUID = normalizeCompanyUUID(meta.Execution?.CompanyUUID);
  if (!companyUUID) {
    throw tenantError(TENANT_ERROR_CODES.notFound, 'CompanyUUID ausente ou inválido no metadata da invocação.');
  }
  return companyUUID;
}

function toIdentity(descriptor: TenantDescriptor): TenantIdentity {
  return Object.freeze({
    companyUUID: descriptor.companyUUID,
    idCompany: descriptor.idCompany,
    idDatabase: descriptor.idDatabase,
    companyName: descriptor.companyName
  });
}

function validateCoreUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI não está configurada para esta empresa.');
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('invalid URL');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI possui configuração inválida para esta empresa.');
  }
}

function identityMismatch(): McpToolError {
  return tenantError(TENANT_ERROR_CODES.identityMismatch, 'Empresa não corresponde ao tenant resolvido.');
}

/** Creates the central registry and per-tenant invocation lifecycle. */
export function createTenantRuntime(
  config: EnvConfig,
  dependencies: TenantRuntimeDependencies = {}
): TenantRuntime {
  const now = dependencies.now ?? Date.now;
  const makePool = dependencies.createPool ?? createDatabasePool;
  const centralPool = dependencies.centralPool ?? makePool(config.centralDb, {
    connectionLimit: config.centralDb.connectionLimit,
    connectTimeoutMs: 10000
  });
  const registry = new CentralRegistry(centralPool, {
    ttlMs: config.centralRegistryCacheMs,
    now
  });
  const connections = new ConnectionManager({
    ...config.tenantDb,
    createPool: makePool,
    now
  });

  let draining = false;
  let initialized = false;
  let activeInvocations = 0;
  let closePromise: Promise<void> | undefined;
  const drainWaiters = new Set<() => void>();
  const settingsCache = new Map<string, CachedValue<string | null>>();
  const pendingSettings = new Map<string, Promise<string | null>>();
  const coreClients = new Map<string, CoreClientCacheEntry>();

  async function assertLocalIdentity(db: McpDatabase, descriptor: TenantDescriptor): Promise<void> {
    let rows: Array<{ id: number; companyUUID: string }>;
    try {
      rows = await db
        .select({ id: company.id, companyUUID: company.companyUUID })
        .from(company)
        .where(eq(company.id, descriptor.idCompany))
        .limit(2);
    } catch {
      throw tenantError(TENANT_ERROR_CODES.databaseUnavailable, 'Não foi possível validar a empresa na base correspondente.');
    }
    if (rows.length !== 1 || normalizeCompanyUUID(rows[0]?.companyUUID) !== descriptor.companyUUID) {
      throw identityMismatch();
    }
  }

  async function resolveCoreBaseUrl(
    db: McpDatabase,
    generationKey: string,
    idCompany: number
  ): Promise<string> {
    const key = `${generationKey}:${idCompany}`;
    const cached = settingsCache.get(key);
    if (cached && cached.expiresAt > now()) {
      if (cached.value === null) {
        throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI não está configurada para esta empresa.');
      }
      return cached.value;
    }

    const waiting = pendingSettings.get(key);
    if (waiting) {
      const value = await waiting;
      if (value === null) {
        throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI não está configurada para esta empresa.');
      }
      return value;
    }

    const request = (async (): Promise<string | null> => {
      let rows: Array<{ value: string | null }>;
      try {
        rows = await db
          .select({ value: generalSettings.value })
          .from(generalSettings)
          .where(and(
            eq(generalSettings.idCompany, idCompany),
            sql`UPPER(TRIM(${generalSettings.param})) = 'MSG4COREAPI'`
          ))
          .limit(2);
      } catch {
        throw tenantError(TENANT_ERROR_CODES.databaseUnavailable, 'Não foi possível consultar a configuração do Core.');
      }
      if (rows.length > 1) {
        throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI está duplicada na configuração da empresa.');
      }
      const value = rows[0]?.value;
      if (value === undefined || value === null || value.trim().length === 0) return null;
      return validateCoreUrl(value);
    })();
    pendingSettings.set(key, request);
    try {
      const value = await request;
      settingsCache.set(key, { value, expiresAt: now() + config.mcpCoreSettingsCacheMs });
      if (value === null) {
        throw new McpToolError('CORE_UNAVAILABLE', 'MSG4COREAPI não está configurada para esta empresa.');
      }
      return value;
    } finally {
      if (pendingSettings.get(key) === request) pendingSettings.delete(key);
    }
  }

  function getCoreClient<T extends CoreFlowClientContract | CoreNavigationClientContract>(
    db: McpDatabase,
    generationKey: string,
    identity: TenantIdentity,
    kind: 'flow' | 'navigation'
  ): Promise<T> {
    const key = `${generationKey}:${identity.idCompany}:${kind}`;
    const cached = coreClients.get(key);
    if (cached && cached.expiresAt > now()) return cached.promise as unknown as Promise<T>;

    const promise = resolveCoreBaseUrl(db, generationKey, identity.idCompany).then((baseUrl) => {
      if (kind === 'flow') {
        return new CoreFlowClient({ baseUrl, timeoutMs: config.coreApiTimeoutMs });
      }
      return new CoreNavigationClient({ baseUrl, timeoutMs: config.coreApiTimeoutMs });
    });
    const entry = { promise, expiresAt: Number.POSITIVE_INFINITY };
    coreClients.set(key, entry);
    void promise.then(
      () => { entry.expiresAt = now() + config.mcpCoreSettingsCacheMs; },
      () => { if (coreClients.get(key) === entry) coreClients.delete(key); }
    );
    return promise as unknown as Promise<T>;
  }

  function notifyWhenIdle(): void {
    if (activeInvocations !== 0) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  async function waitForInvocations(timeoutMs: number): Promise<boolean> {
    if (activeInvocations === 0) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (drained: boolean): void => {
        drainWaiters.delete(onIdle);
        clearTimeout(timer);
        resolve(drained);
      };
      const onIdle = () => finish(true);
      drainWaiters.add(onIdle);
    });
  }

  async function settleBeforeDeadline(operation: Promise<unknown>, deadline: number): Promise<void> {
    const remainingMs = Math.max(0, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      operation.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remainingMs);
      })
    ]);
    if (timer) clearTimeout(timer);
  }

  const provider: TenantContextProvider = {
    async withTenantContext<T>(
      meta: CAMeta,
      operation: (context: TenantInvocationContext) => Promise<T>
    ): Promise<T> {
      if (draining) throw tenantError(TENANT_ERROR_CODES.draining, 'O serviço está encerrando.');
      activeInvocations += 1;
      let lease: Awaited<ReturnType<ConnectionManager['acquire']>> | undefined;
      let leaseActive = false;
      try {
        const companyUUID = getCompanyUUID(meta);
        if (config.mcpTenantAllowlist && !config.mcpTenantAllowlist.has(companyUUID)) {
          throw tenantError(TENANT_ERROR_CODES.notAllowed, 'Empresa fora da allowlist desta instalação.');
        }

        const descriptor = await registry.resolveByCompanyUUID(companyUUID);
        const requestedIdCompany = optionalIdentityNumber(meta, 'IdCompany');
        const requestedIdDatabase = optionalIdentityNumber(meta, 'IdDatabase');
        if (requestedIdCompany !== undefined && requestedIdCompany !== descriptor.idCompany) {
          throw tenantError(TENANT_ERROR_CODES.identityMismatch, 'IdCompany diverge do Registry central.');
        }
        if (requestedIdDatabase !== undefined && requestedIdDatabase !== descriptor.idDatabase) {
          throw tenantError(TENANT_ERROR_CODES.identityMismatch, 'IdDatabase diverge do Registry central.');
        }

        lease = await connections.acquire(descriptor.idDatabase, descriptor.databaseConfig);
        leaseActive = true;
        const db = lease.db;
        await assertLocalIdentity(lease.db, descriptor);

        const identity = toIdentity(descriptor);
        const generationKey = `${descriptor.idDatabase}:${lease.generation}`;
        const context: TenantInvocationContext = Object.freeze({
          identity,
          chatRepository: new ChatRepository(db, identity.idCompany),
          flowRepository: new FlowRepository(db, identity.idCompany),
          productRepository: new ProductRepository(db, identity.idCompany),
          priceListRepository: new PriceListRepository(db, identity.idCompany),
          itemPriceRepository: new ItemPriceRepository(db, identity.idCompany),
          getCoreFlowClient: () => {
            if (!leaseActive) throw tenantError(TENANT_ERROR_CODES.draining, 'Contexto da invocação expirou.');
            return getCoreClient<CoreFlowClientContract>(lease!.db, generationKey, identity, 'flow');
          },
          getCoreNavigationClient: () => {
            if (!leaseActive) throw tenantError(TENANT_ERROR_CODES.draining, 'Contexto da invocação expirou.');
            return getCoreClient<CoreNavigationClientContract>(lease!.db, generationKey, identity, 'navigation');
          }
        });
        return await operation(context);
      } finally {
        leaseActive = false;
        await lease?.release();
        activeInvocations = Math.max(0, activeInvocations - 1);
        notifyWhenIdle();
      }
    }
  };

  const cachePruner = setInterval(() => {
    const timestamp = now();
    for (const [key, item] of settingsCache) {
      if (item.expiresAt <= timestamp) settingsCache.delete(key);
    }
    for (const [key, item] of coreClients) {
      if (item.expiresAt <= timestamp) coreClients.delete(key);
    }
  }, Math.max(1000, Math.min(config.mcpCoreSettingsCacheMs, 60000)));
  cachePruner.unref();

  return {
    provider,
    async isReady(): Promise<boolean> {
      if (draining) return false;
      try {
        await registry.ping();
        initialized = true;
        return initialized && !draining;
      } catch {
        return false;
      }
    },
    beginDrain(): void {
      draining = true;
    },
    close(timeoutMs = config.mcpShutdownTimeoutMs): Promise<void> {
      if (closePromise) return closePromise;
      draining = true;
      closePromise = (async () => {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        await waitForInvocations(Math.max(0, deadline - Date.now()));
        clearInterval(cachePruner);
        const closeTenantPools = connections.closeAll(0);
        const closeCentralRegistry = registry.close();
        await Promise.all([
          settleBeforeDeadline(closeTenantPools, deadline),
          settleBeforeDeadline(closeCentralRegistry, deadline)
        ]);
        settingsCache.clear();
        pendingSettings.clear();
        coreClients.clear();
      })();
      return closePromise;
    }
  };
}
