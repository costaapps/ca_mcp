import { McpToolError } from '../errors/McpToolError.js';

export const TENANT_ERROR_CODES = {
  notFound: 'TENANT_NOT_FOUND',
  notAllowed: 'TENANT_NOT_ALLOWED',
  registryInvalid: 'TENANT_REGISTRY_INVALID',
  registryUnavailable: 'REGISTRY_UNAVAILABLE',
  databaseUnavailable: 'TENANT_DATABASE_UNAVAILABLE',
  poolCapacity: 'TENANT_POOL_CAPACITY',
  identityMismatch: 'TENANT_IDENTITY_MISMATCH',
  draining: 'TENANT_RUNTIME_DRAINING'
} as const;

export function tenantError(code: string, message: string): McpToolError {
  return new McpToolError(code, message);
}
