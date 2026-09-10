import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { getExecutionValue, getResolvedValue, type CAMeta } from './caMeta.js';

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

export const requireContextInternals = {
  requirePositiveInteger
};
