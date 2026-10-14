import type { DatabaseConfig } from '../config/env.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantDescriptor {
  readonly companyUUID: string;
  readonly idCompany: number;
  readonly idDatabase: number;
  readonly companyName: string;
  /** Internal only: this object contains database credentials. */
  readonly databaseConfig: Omit<DatabaseConfig, 'connectionLimit'>;
}

export interface CentralRegistryRow {
  IdDatabase: unknown;
  IdCompany: unknown;
  CompanyName: unknown;
  CompanyUUID: unknown;
  Hostname: unknown;
  Port: unknown;
  DBName: unknown;
  Username: unknown;
  Password: unknown;
  DatabaseRecordId: unknown;
  LocalIdentityCount?: unknown;
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} is invalid in the central Registry.`);
  }
  return parsed;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is missing in the central Registry.`);
  }
  return value.trim();
}

function requiredCredential(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is missing in the central Registry.`);
  }
  return value;
}

export function normalizeCompanyUUID(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return uuidPattern.test(normalized) ? normalized : null;
}

export function mapTenantDescriptor(row: CentralRegistryRow): TenantDescriptor {
  const companyUUID = normalizeCompanyUUID(row.CompanyUUID);
  if (!companyUUID) throw new Error('Company.CompanyUUID is invalid in the central Registry.');

  const idDatabase = positiveInteger(row.IdDatabase, 'Company.IdDatabase');
  const databaseRecordId = positiveInteger(row.DatabaseRecordId, 'Databases.IdDatabase');
  if (idDatabase !== databaseRecordId) {
    throw new Error('Company.IdDatabase does not match Databases.IdDatabase.');
  }

  const port = positiveInteger(row.Port, 'Databases.Port');
  if (port > 65535) throw new Error('Databases.Port is invalid in the central Registry.');
  return Object.freeze({
    companyUUID,
    idCompany: positiveInteger(row.IdCompany, 'Company.IdCompany'),
    idDatabase,
    companyName: requiredString(row.CompanyName, 'Company.Name'),
    databaseConfig: Object.freeze({
      host: requiredString(row.Hostname, 'Databases.Hostname'),
      port,
      database: requiredString(row.DBName, 'Databases.DBName'),
      user: requiredString(row.Username, 'Databases.Username'),
      password: requiredCredential(row.Password, 'Databases.Password')
    })
  });
}

export const descriptorInternals = { positiveInteger, requiredString, uuidPattern };
