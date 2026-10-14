import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { getExecutionValue, getResolvedValue, type CAMeta } from './caMeta.js';
import type { TenantContextProvider, TenantInvocationContext } from '../../tenancy/contracts.js';

export interface FlowExecutionContext {
  ExecutionUUID: string;
  TurnUUID?: string;
  IdCompany: number;
  IdProcessLine: number;
}

export interface AgentExecutionContext {
  ExecutionUUID: string;
  TurnUUID: string;
  IdCompany: number;
  IdProcessLine: number;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    throw new McpToolError(
      ERROR_CODES.MISSING_CONTEXT,
      `Contexto obrigatório ausente: ${path}`,
      path
    );
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new McpToolError(ERROR_CODES.INVALID_CONTEXT, `Contexto inválido: ${path}`, path);
  }

  return value;
}

export function requireExecutionId(meta: CAMeta, key: string): number {
  return requirePositiveInteger(getExecutionValue(meta, key), `Execution.${key}`);
}

export function requireResolvedId(meta: CAMeta, key: string): number {
  return requirePositiveInteger(getResolvedValue(meta, key), `Resolved.${key}`);
}

export function requireExecutionString(meta: CAMeta, key: string): string {
  const value = getExecutionValue(meta, key);
  if (value === undefined || value === null) {
    throw new McpToolError(
      ERROR_CODES.MISSING_CONTEXT,
      `Contexto obrigatório ausente: Execution.${key}`,
      `Execution.${key}`
    );
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpToolError(
      ERROR_CODES.INVALID_CONTEXT,
      `Contexto inválido: Execution.${key}`,
      `Execution.${key}`
    );
  }

  return value;
}

/** Requires a canonical UUID and returns its lowercase normalized representation. */
export function requireCompanyUUID(meta: CAMeta): string {
  const value = getExecutionValue(meta, 'CompanyUUID');
  const path = 'Execution.CompanyUUID';
  if (value === undefined || value === null) {
    throw new McpToolError(
      ERROR_CODES.MISSING_CONTEXT,
      `Contexto obrigatório ausente: ${path}`,
      path
    );
  }

  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  ) {
    throw new McpToolError(ERROR_CODES.INVALID_CONTEXT, `Contexto inválido: ${path}`, path);
  }

  return value.trim().toLowerCase();
}

function optionalExecutionId(meta: CAMeta, key: 'IdCompany' | 'IdDatabase'): number | undefined {
  const value = getExecutionValue(meta, key);
  if (value === undefined || value === null) return undefined;
  return requirePositiveInteger(value, `Execution.${key}`);
}

/** Validates the routing identity before delegating each call to the leased tenant facade. */
export function withRequiredTenantContext<T>(
  provider: TenantContextProvider,
  meta: CAMeta,
  operation: (context: TenantInvocationContext) => Promise<T>
): Promise<T> {
  const companyUUID = requireCompanyUUID(meta);
  const normalizedMeta: CAMeta = {
    ...meta,
    Execution: {
      ...meta.Execution,
      CompanyUUID: companyUUID
    }
  };

  return provider.withTenantContext(normalizedMeta, async (context) => {
    const requestedIdCompany = optionalExecutionId(normalizedMeta, 'IdCompany');
    const requestedIdDatabase = optionalExecutionId(normalizedMeta, 'IdDatabase');
    if (requestedIdCompany !== undefined && requestedIdCompany !== context.identity.idCompany) {
      throw new McpToolError(
        'TENANT_IDENTITY_MISMATCH',
        'IdCompany diverge do tenant resolvido.',
        'Execution.IdCompany'
      );
    }
    if (requestedIdDatabase !== undefined && requestedIdDatabase !== context.identity.idDatabase) {
      throw new McpToolError(
        'TENANT_IDENTITY_MISMATCH',
        'IdDatabase diverge do tenant resolvido.',
        'Execution.IdDatabase'
      );
    }
    return operation(context);
  });
}

export function optionalExecutionString(meta: CAMeta, key: string): string | undefined {
  const value = getExecutionValue(meta, key);
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpToolError(
      ERROR_CODES.INVALID_CONTEXT,
      `Contexto inválido: Execution.${key}`,
      `Execution.${key}`
    );
  }

  return value;
}

export function requireFlowExecutionContext(meta: CAMeta, resolvedIdCompany: number): FlowExecutionContext {
  const requestedIdCompany = requireExecutionId(meta, 'IdCompany');
  const tenantIdCompany = requirePositiveInteger(resolvedIdCompany, 'Tenant.IdCompany');
  if (requestedIdCompany !== tenantIdCompany) {
    throw new McpToolError('TENANT_IDENTITY_MISMATCH', 'IdCompany diverge do tenant resolvido.', 'Execution.IdCompany');
  }
  const context = {
    ExecutionUUID: requireExecutionString(meta, 'ExecutionUUID'),
    IdCompany: tenantIdCompany,
    IdProcessLine: requireExecutionId(meta, 'IdProcessLine')
  };
  const turnUUID = optionalExecutionString(meta, 'TurnUUID');

  return {
    ...context,
    ...(turnUUID === undefined ? {} : { TurnUUID: turnUUID })
  };
}

export function requireAgentExecutionContext(meta: CAMeta, resolvedIdCompany: number): AgentExecutionContext {
  const requestedIdCompany = requireExecutionId(meta, 'IdCompany');
  const tenantIdCompany = requirePositiveInteger(resolvedIdCompany, 'Tenant.IdCompany');
  if (requestedIdCompany !== tenantIdCompany) {
    throw new McpToolError('TENANT_IDENTITY_MISMATCH', 'IdCompany diverge do tenant resolvido.', 'Execution.IdCompany');
  }
  return {
    ExecutionUUID: requireExecutionString(meta, 'ExecutionUUID'),
    TurnUUID: requireExecutionString(meta, 'TurnUUID'),
    IdCompany: tenantIdCompany,
    IdProcessLine: requireExecutionId(meta, 'IdProcessLine')
  };
}

export const requireContextInternals = {
  requirePositiveInteger
};
