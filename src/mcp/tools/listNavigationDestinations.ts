import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CoreNavigationClientContract } from '../../core/contracts.js';
import { coreListNavigationDestinationsDataSchema } from '../../core/schemas.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireAgentExecutionContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const listNavigationDestinationsInputSchema = z.object({}).strict();
export const listNavigationDestinationsOutputSchema = coreListNavigationDestinationsDataSchema;

const TOOL_NAME = 'list_navigation_destinations';

export interface ListNavigationDestinationsToolDependencies {
  coreNavigationClient: CoreNavigationClientContract;
  logger: McpLogger;
}

export function registerListNavigationDestinationsTool(
  server: McpServer,
  dependencies: ListNavigationDestinationsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Lista os destinos de navegação autorizados para o contexto atual. Use antes de solicitar um handoff e trate DestinationRef como uma string opaca.',
      inputSchema: listNavigationDestinationsInputSchema,
      outputSchema: listNavigationDestinationsOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      let executionUUID: string | undefined;
      let turnUUID: string | undefined;

      try {
        if (!listNavigationDestinationsInputSchema.safeParse(arguments_).success) {
          throw new McpToolError(
            ERROR_CODES.INVALID_ARGUMENTS,
            'Argumentos inválidos para listar os destinos de navegação.'
          );
        }

        const meta = extractCAMeta(ctx);
        const context = requireAgentExecutionContext(meta);
        executionUUID = context.ExecutionUUID;
        turnUUID = context.TurnUUID;
        const { TurnUUID: _turnUUID, ...request } = context;
        const response = await dependencies.coreNavigationClient.listNavigationDestinations(request);

        if (!response.Success) {
          throw new McpToolError(response.Error.Code, response.Error.Message);
        }

        const parsedData = listNavigationDestinationsOutputSchema.safeParse(response.Data);
        if (!parsedData.success) {
          throw new McpToolError(
            ERROR_CODES.CORE_CONTRACT_ERROR,
            'O Core retornou dados incompatíveis com o contrato de destinos de navegação.'
          );
        }

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID
        });

        return {
          content: [{
            type: 'text' as const,
            text: 'Destinos de navegação listados com sucesso.'
          }],
          structuredContent: parsedData.data
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(
            ERROR_CODES.TOOL_EXECUTION_ERROR,
            'Não foi possível listar os destinos de navegação.'
          );

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}
