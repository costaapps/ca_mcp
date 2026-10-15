import type { CallToolResult } from '@modelcontextprotocol/server';

import type { ErrorCode } from '../errors/errorCodes.js';
import { McpToolError } from '../errors/McpToolError.js';

export interface ErrorStructuredContent {
  Code: ErrorCode;
  Required?: string;
}

export function toToolErrorResult(error: unknown): CallToolResult {
  const toolError = error instanceof McpToolError
    ? error
    : new McpToolError('TOOL_EXECUTION_ERROR', 'Não foi possível concluir a execução da ferramenta.');

  const structuredContent: ErrorStructuredContent = {
    Code: toolError.code,
    ...(toolError.required === undefined ? {} : { Required: toolError.required })
  };

  return {
    isError: true,
    content: [{ type: 'text', text: toolError.message }],
    structuredContent
  };
}

export function withResolvedMeta(
  result: CallToolResult,
  patch: Record<string, unknown>
): CallToolResult {
  const currentResolved = getCAMetaRecord(result)?.Resolved;

  return withCAMeta(result, {
    Resolved: {
      ...(typeof currentResolved === 'object' && currentResolved !== null && !Array.isArray(currentResolved)
        ? currentResolved
        : {}),
      ...patch
    }
  });
}

export function withCAMeta(
  result: CallToolResult,
  patch: Record<string, unknown>
): CallToolResult {
  const currentCa = getCAMetaRecord(result) ?? {};

  return {
    ...result,
    _meta: {
      ...(result._meta ?? {}),
      ca: {
        ...currentCa,
        ...patch
      }
    }
  };
}

function getCAMetaRecord(result: CallToolResult): Record<string, unknown> | undefined {
  if (result._meta === undefined || typeof result._meta !== 'object' || result._meta === null) {
    return undefined;
  }

  const ca = result._meta.ca;
  if (typeof ca !== 'object' || ca === null || Array.isArray(ca)) return undefined;
  return ca as Record<string, unknown>;
}
