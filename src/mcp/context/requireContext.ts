import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { getExecutionValue, getResolvedValue, type CAMeta } from './caMeta.js';

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

export function requireFlowExecutionContext(meta: CAMeta): FlowExecutionContext {
  const context = {
    ExecutionUUID: requireExecutionString(meta, 'ExecutionUUID'),
    IdCompany: requireExecutionId(meta, 'IdCompany'),
    IdProcessLine: requireExecutionId(meta, 'IdProcessLine')
  };
  const turnUUID = optionalExecutionString(meta, 'TurnUUID');

  return {
    ...context,
    ...(turnUUID === undefined ? {} : { TurnUUID: turnUUID })
  };
}

export function requireAgentExecutionContext(meta: CAMeta): AgentExecutionContext {
  return {
    ExecutionUUID: requireExecutionString(meta, 'ExecutionUUID'),
    TurnUUID: requireExecutionString(meta, 'TurnUUID'),
    IdCompany: requireExecutionId(meta, 'IdCompany'),
    IdProcessLine: requireExecutionId(meta, 'IdProcessLine')
  };
}

export const requireContextInternals = {
  requirePositiveInteger
};
