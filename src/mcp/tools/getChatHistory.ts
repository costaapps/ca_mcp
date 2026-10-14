import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import type { McpLogger } from '../logger.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId, withRequiredTenantContext } from '../context/requireContext.js';
import { toToolErrorResult } from '../result.js';
import type { TenantContextProvider, TenantIdentity } from '../../tenancy/contracts.js';
import type { CAMeta } from '../context/caMeta.js';
import { getToolLogContext } from '../context/toolLogContext.js';

export const chatHistoryOutputSchema = z.object({
  Messages: z.array(z.object({
    Sender: z.string(),
    Text: z.string()
  }))
});

const emptyInputSchema = z.object({});

const TOOL_NAME = 'get_chat_history';

export interface ChatHistoryToolDependencies {
  tenantContextProvider: TenantContextProvider;
  logger: McpLogger;
}

export function registerGetChatHistoryTool(
  server: McpServer,
  dependencies: ChatHistoryToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Obtém o histórico textual da conversa atual, informando quem enviou cada mensagem e o texto. Use quando precisar recuperar contexto anterior da conversa.',
      inputSchema: emptyInputSchema,
      outputSchema: chatHistoryOutputSchema
    },
    async (_arguments, ctx) => {
      const startedAt = Date.now();
      let meta: CAMeta | undefined;
      let tenantIdentity: TenantIdentity | undefined;

      try {
        const operationMeta = extractCAMeta(ctx);
        meta = operationMeta;
        return await withRequiredTenantContext(dependencies.tenantContextProvider, operationMeta, async (tenant) => {
          tenantIdentity = tenant.identity;
          const idChat = requireExecutionId(operationMeta, 'IdChat');
          const messages = await tenant.chatRepository.getChatHistory(idChat, tenant.identity.idCompany);
          let structuredContent: z.infer<typeof chatHistoryOutputSchema>;
          try {
            structuredContent = chatHistoryOutputSchema.parse({ Messages: messages });
          } catch {
            throw new McpToolError(
              ERROR_CODES.TOOL_EXECUTION_ERROR,
              'A ferramenta produziu uma saída inválida.'
            );
          }

          dependencies.logger.toolCompleted({
            tool: TOOL_NAME,
            durationMs: Date.now() - startedAt,
            success: true,
            ...getToolLogContext(meta, tenant.identity)
          });

          return {
            content: [{ type: 'text' as const, text: 'Histórico da conversa obtido com sucesso.' }],
            structuredContent
          };
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar o histórico da conversa.');

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code,
          ...getToolLogContext(meta, tenantIdentity)
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}

export const getChatHistoryToolInternals = {
  emptyInputSchema
};
