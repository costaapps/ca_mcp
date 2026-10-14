import type { TenantIdentity } from '../../tenancy/contracts.js';
import type { CAMeta } from './caMeta.js';

export interface ToolLogContext {
  ExecutionUUID?: string;
  TurnUUID?: string;
  CompanyUUID?: string;
  IdCompany?: number;
  IdDatabase?: number;
}

function optionalString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function getToolLogContext(
  meta?: CAMeta,
  identity?: TenantIdentity
): ToolLogContext {
  const executionUUID = optionalString(meta?.Execution, 'ExecutionUUID');
  const turnUUID = optionalString(meta?.Execution, 'TurnUUID');

  return {
    ...(executionUUID === undefined ? {} : { ExecutionUUID: executionUUID }),
    ...(turnUUID === undefined ? {} : { TurnUUID: turnUUID }),
    ...(identity === undefined ? {} : {
      CompanyUUID: identity.companyUUID,
      IdCompany: identity.idCompany,
      IdDatabase: identity.idDatabase
    })
  };
}
