import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import type { McpLogger } from '../logger.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId } from '../context/requireContext.js';
import { toToolErrorResult } from '../result.js';
import type { ChatRepositoryContract } from '../../database/repositories/chatRepository.js';

export const chatHistoryOutputSchema = z.object({
  Messages: z.array(z.object({
    Sender: z.string(),
    Text: z.string()
  }))
});

const emptyInputSchema = z.object({});

const TOOL_NAME = 'get_chat_history';

export interface ChatHistoryToolDependencies {
  chatRepository: ChatRepositoryContract;
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

      try {
        const meta = extractCAMeta(ctx);
        const idChat = requireExecutionId(meta, 'IdChat');
        const messages = await dependencies.chatRepository.getChatHistory(idChat);
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
          success: true
        });

        return {
          content: [{ type: 'text' as const, text: 'Histórico da conversa obtido com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar o histórico da conversa.');

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}

export const getChatHistoryToolInternals = {
  emptyInputSchema
};
