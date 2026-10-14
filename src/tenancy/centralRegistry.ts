import type { Pool, RowDataPacket } from 'mysql2/promise';

import { McpToolError } from '../errors/McpToolError.js';
import {
  mapTenantDescriptor,
  normalizeCompanyUUID,
  type CentralRegistryRow,
  type TenantDescriptor
} from './descriptor.js';

const SELECT_TENANT = [
  'SELECT C.IdDatabase, C.IdCompany, C.Name AS CompanyName, C.CompanyUUID,',
  'D.Hostname, D.Port, D.DBName, D.Username, D.Password,',
  'D.IdDatabase AS DatabaseRecordId,',
  '(SELECT COUNT(*) FROM Company C2 WHERE C2.IdDatabase = C.IdDatabase',
  'AND C2.IdCompany = C.IdCompany) AS LocalIdentityCount',
  'FROM Company C LEFT JOIN `Databases` D ON D.IdDatabase = C.IdDatabase',
  'WHERE LOWER(C.CompanyUUID) = ? LIMIT 2'
].join(' ');

interface RegistryCacheEntry {
  readonly expiresAt: number;
  readonly descriptor: TenantDescriptor | null;
  readonly invalid: boolean;
}

export type TenantDatabaseDescriptor = TenantDescriptor;

export interface CentralRegistryOptions {
  readonly ttlMs: number;
  readonly now?: () => number;
  readonly logger?: (event: Readonly<Record<string, string>>) => void;
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return /^[A-Z0-9_]{1,80}$/i.test(code) ? code : undefined;
}

function registryUnavailable(error: unknown): McpToolError {
  const code = safeCode((error as { code?: unknown } | null)?.code);
  const message = code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code)
    ? 'O Registry central está indisponível.'
    : 'Não foi possível consultar o Registry central.';
  return new McpToolError('REGISTRY_UNAVAILABLE', message);
}

export class CentralRegistry {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly logger: (event: Readonly<Record<string, string>>) => void;
  private readonly cache = new Map<string, RegistryCacheEntry>();
  private readonly pending = new Map<string, Promise<TenantDescriptor>>();

  public constructor(
    private readonly pool: Pool,
    options: CentralRegistryOptions
  ) {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 0) {
      throw new TypeError('CENTRAL_REGISTRY_CACHE_MS deve ser um inteiro não negativo.');
    }
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? ((event) => console.error(JSON.stringify(event)));
  }

  public async resolveByCompanyUUID(input: string): Promise<TenantDescriptor> {
    const companyUUID = normalizeCompanyUUID(input);
    if (!companyUUID) {
      throw new McpToolError('TENANT_CONTEXT_INVALID', 'CompanyUUID inválido.');
    }

    const cached = this.cache.get(companyUUID);
    if (cached && cached.expiresAt > this.now()) return this.readCacheEntry(cached);
    const pending = this.pending.get(companyUUID);
    if (pending) return pending;

    const request = this.resolveUncached(companyUUID);
    this.pending.set(companyUUID, request);
    try {
      const descriptor = await request;
      this.cache.set(companyUUID, {
        descriptor,
        invalid: false,
        expiresAt: this.now() + this.ttlMs
      });
      return descriptor;
    } catch (error) {
      if (error instanceof McpToolError && error.code === 'TENANT_REGISTRY_INVALID') {
        this.cache.set(companyUUID, {
          descriptor: null,
          invalid: true,
          expiresAt: this.now() + this.ttlMs
        });
      }
      throw error;
    } finally {
      if (this.pending.get(companyUUID) === request) this.pending.delete(companyUUID);
    }
  }

  public async ping(): Promise<void> {
    try {
      await this.pool.execute('SELECT 1');
    } catch (error) {
      this.logFailure('central_registry_ping_failed', error);
      throw registryUnavailable(error);
    }
  }

  public invalidate(companyUUID?: string): void {
    if (companyUUID === undefined) {
      this.cache.clear();
      return;
    }
    const normalized = normalizeCompanyUUID(companyUUID);
    if (normalized) this.cache.delete(normalized);
  }

  public async close(): Promise<void> {
    this.cache.clear();
    this.pending.clear();
    await this.pool.end();
  }

  private readCacheEntry(entry: RegistryCacheEntry): TenantDescriptor {
    if (entry.invalid) {
      throw new McpToolError(
        'TENANT_REGISTRY_INVALID',
        'O cadastro da empresa está inválido no Registry central.'
      );
    }
    if (!entry.descriptor) {
      throw new McpToolError('TENANT_NOT_FOUND', 'CompanyUUID não encontrado no Registry central.');
    }
    return entry.descriptor;
  }

  private async resolveUncached(companyUUID: string): Promise<TenantDescriptor> {
    let rows: CentralRegistryRow[];
    try {
      const [result] = await this.pool.execute(SELECT_TENANT, [companyUUID]);
      rows = result as RowDataPacket[] as CentralRegistryRow[];
    } catch (error) {
      this.logFailure('central_registry_query_failed', error);
      throw registryUnavailable(error);
    }

    if (rows.length === 0) {
      this.cache.set(companyUUID, {
        descriptor: null,
        invalid: false,
        expiresAt: this.now() + this.ttlMs
      });
      throw new McpToolError('TENANT_NOT_FOUND', 'CompanyUUID não encontrado no Registry central.');
    }
    if (rows.length !== 1 || Number(rows[0]?.LocalIdentityCount) !== 1) {
      throw new McpToolError(
        'TENANT_REGISTRY_INVALID',
        'O cadastro da empresa está duplicado no Registry central.'
      );
    }

    try {
      const descriptor = mapTenantDescriptor(rows[0] as CentralRegistryRow);
      if (descriptor.companyUUID !== companyUUID) {
        throw new Error('Registry identity did not match the requested UUID.');
      }
      return descriptor;
    } catch {
      throw new McpToolError(
        'TENANT_REGISTRY_INVALID',
        'O cadastro da empresa está inválido no Registry central.'
      );
    }
  }

  private logFailure(event: string, error: unknown): void {
    const code = safeCode((error as { code?: unknown } | null)?.code);
    this.logger(Object.freeze({ event, ...(code ? { errorCode: code } : {}) }));
  }
}

export const centralRegistryInternals = { SELECT_TENANT, safeCode, registryUnavailable };
