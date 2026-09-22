import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CoreNavigationClientContract } from '../../core/contracts.js';
import { coreRequestHandoffDataSchema } from '../../core/schemas.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireAgentExecutionContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const requestHandoffInputSchema = z.object({
  DestinationRef: z.string().min(1),
  Reason: z.string().trim().min(1),
  Summary: z.string().trim().min(1)
}).strict();

export const requestHandoffOutputSchema = z.object({
  Accepted: z.boolean(),
  Destination: z.string().trim().min(1),
  Status: z.literal('REQUESTED')
}).strict();

const TOOL_NAME = 'request_handoff';

export interface RequestHandoffToolDependencies {
  coreNavigationClient: CoreNavigationClientContract;
  logger: McpLogger;
  requestUUID?: () => string;
}

export function registerRequestHandoffTool(
  server: McpServer,
  dependencies: RequestHandoffToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Solicita ao Core a transferência do atendimento para um DestinationRef retornado pela list_navigation_destinations. Não aplique o handoff nem invente referências.',
      inputSchema: requestHandoffInputSchema,
      outputSchema: requestHandoffOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      let executionUUID: string | undefined;
      let turnUUID: string | undefined;
      let requestUUIDForLog: string | undefined;
      let handoffUUID: string | undefined;

      try {
        const parsedArguments = requestHandoffInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(
            ERROR_CODES.INVALID_ARGUMENTS,
            'Argumentos inválidos para solicitar o handoff.'
          );
        }

        const meta = extractCAMeta(ctx);
        const context = requireAgentExecutionContext(meta);
        executionUUID = context.ExecutionUUID;
        turnUUID = context.TurnUUID;
        const { TurnUUID: _turnUUID, ...coreContext } = context;
        const requestUUID = dependencies.requestUUID?.() ?? randomUUID();
        requestUUIDForLog = requestUUID;
        const response = await dependencies.coreNavigationClient.requestHandoff({
          ...coreContext,
          RequestUUID: requestUUID,
          DestinationRef: parsedArguments.data.DestinationRef,
          Reason: parsedArguments.data.Reason,
          Summary: parsedArguments.data.Summary
        });

        if (!response.Success) {
          throw new McpToolError(response.Error.Code, response.Error.Message);
        }

        const parsedData = coreRequestHandoffDataSchema.safeParse(response.Data);
        if (!parsedData.success) {
          throw new McpToolError(
            ERROR_CODES.CORE_CONTRACT_ERROR,
            'O Core retornou dados incompatíveis com o contrato de handoff.'
          );
        }

        handoffUUID = parsedData.data.HandoffUUID;
        const structuredContent = requestHandoffOutputSchema.parse({
          Accepted: parsedData.data.Accepted,
          Destination: parsedData.data.Destination,
          Status: parsedData.data.Status
        });

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID,
          RequestUUID: requestUUIDForLog,
          ...(handoffUUID === undefined ? {} : { HandoffUUID: handoffUUID })
        });

        return {
          content: [{ type: 'text' as const, text: 'Handoff solicitado com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(
            ERROR_CODES.TOOL_EXECUTION_ERROR,
            'Não foi possível solicitar o handoff.'
          );

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID,
          RequestUUID: requestUUIDForLog,
          ...(handoffUUID === undefined ? {} : { HandoffUUID: handoffUUID })
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}
