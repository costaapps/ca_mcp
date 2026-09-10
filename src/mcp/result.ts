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
  return {
    ...result,
    _meta: {
      ...(result._meta ?? {}),
      ca: {
        ...((result._meta?.ca as Record<string, unknown> | undefined) ?? {}),
        Resolved: patch
      }
    }
  };
}
