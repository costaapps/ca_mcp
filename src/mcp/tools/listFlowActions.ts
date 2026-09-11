import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CoreFlowClientContract } from '../../core/contracts.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireFlowExecutionContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const listFlowActionsInputSchema = z.object({});

export const listFlowActionsOutputSchema = z.object({
  Actions: z.array(z.object({
    Action: z.string(),
    Description: z.string()
  }).passthrough())
}).passthrough();

const TOOL_NAME = 'list_flow_actions';

export interface ListFlowActionsToolDependencies {
  coreFlowClient: CoreFlowClientContract;
  logger: McpLogger;
}

export function registerListFlowActionsTool(
  server: McpServer,
  dependencies: ListFlowActionsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Lista as capacidades de Flow atualmente disponíveis no AIDocument. Use antes de selecionar uma capability e não invente nomes de Action.',
      inputSchema: listFlowActionsInputSchema,
      outputSchema: listFlowActionsOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();

      try {
        if (!listFlowActionsInputSchema.safeParse(arguments_).success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para listar as capabilities de Flow.');
        }

        const meta = extractCAMeta(ctx);
        const request = requireFlowExecutionContext(meta);
        const response = await dependencies.coreFlowClient.listFlowActions(request);

        if (!response.Success) {
          throw new McpToolError(response.Error.Code, response.Error.Message);
        }

        const structuredContent = listFlowActionsOutputSchema.parse(response.Data);
        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true
        });

        return {
          content: [{ type: 'text' as const, text: 'Capabilities de Flow listadas com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.TOOL_EXECUTION_ERROR, 'Não foi possível listar as capabilities de Flow.');

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
