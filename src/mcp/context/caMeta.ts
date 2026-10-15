import { z } from 'zod';

import type { ServerContext } from '@modelcontextprotocol/server';

import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';

const caMetaSchema = z.object({
  Execution: z.record(z.string(), z.unknown()).optional(),
  Resolved: z.record(z.string(), z.unknown()).optional()
});

export type CAMeta = z.infer<typeof caMetaSchema>;
export type ToolServerContext = Pick<ServerContext, 'mcpReq'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractCAMeta(ctx: ToolServerContext): CAMeta {
  const requestMeta = ctx.mcpReq?._meta;
  if (requestMeta === undefined || requestMeta === null) return {};

  if (!isRecord(requestMeta) || ('ca' in requestMeta && !isRecord(requestMeta.ca))) {
    throw new McpToolError(ERROR_CODES.INVALID_CONTEXT, 'Metadata MCP inválida.');
  }

  const rawCa = requestMeta.ca;
  if (rawCa === undefined) return {};

  const parsed = caMetaSchema.safeParse(rawCa);
  if (!parsed.success) {
    throw new McpToolError(ERROR_CODES.INVALID_CONTEXT, 'Contexto técnico _meta.ca inválido.');
  }

  return parsed.data;
}

export function getExecutionValue(meta: CAMeta, key: string): unknown {
  return meta.Execution?.[key];
}

export function getResolvedValue(meta: CAMeta, key: string): unknown {
  return meta.Resolved?.[key];
}

export const caMetaInternals = {
  isRecord,
  caMetaSchema
};
