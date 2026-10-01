import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CoreFlowClientContract } from '../../core/contracts.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireFlowExecutionContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const describeFlowActionInputSchema = z.object({
  Action: z.string().trim().min(1)
});

export const describeFlowActionOutputSchema = z.object({
  Action: z.string(),
  Description: z.string(),
  ObjectDescription: z.string().nullable().optional(),
  Repeatable: z.boolean(),
  Effect: z.enum(['READ', 'WRITE', 'EXTERNAL_READ', 'EXTERNAL_WRITE', 'OUTPUT', 'CONTROL']),
  Available: z.boolean(),
  ExecutionCount: z.number().int().nonnegative(),
  UnavailableReason: z.string().nullable(),
  RequiredInputs: z.array(z.string())
});

const TOOL_NAME = 'describe_flow_action';

export interface DescribeFlowActionToolDependencies {
  coreFlowClient: CoreFlowClientContract;
  logger: McpLogger;
}

export function registerDescribeFlowActionTool(
  server: McpServer,
  dependencies: DescribeFlowActionToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Descreve uma capability descoberta, incluindo Effect, disponibilidade e RequiredInputs. Consulte antes de execute_flow_action.',
      inputSchema: describeFlowActionInputSchema,
      outputSchema: describeFlowActionOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      let executionUUID: string | undefined;
      let turnUUID: string | undefined;

      try {
        const parsedArguments = describeFlowActionInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para descrever a capability de Flow.');
        }

        const meta = extractCAMeta(ctx);
        const flowContext = requireFlowExecutionContext(meta);
        executionUUID = flowContext.ExecutionUUID;
        turnUUID = flowContext.TurnUUID;
        const { TurnUUID: _turnUUID, ...coreRequest } = flowContext;
        const request = {
          ...coreRequest,
          Action: parsedArguments.data.Action
        };
        const response = await dependencies.coreFlowClient.describeFlowAction(request);

        if (!response.Success) {
          throw new McpToolError(response.Error.Code, response.Error.Message);
        }

        const structuredContent = describeFlowActionOutputSchema.parse(response.Data);
        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID
        });

        return {
          content: [{ type: 'text' as const, text: 'Detalhes da capability de Flow obtidos com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.TOOL_EXECUTION_ERROR, 'Não foi possível descrever a capability de Flow.');

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
