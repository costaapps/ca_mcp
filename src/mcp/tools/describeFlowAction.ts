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
  Repeatable: z.boolean(),
  Available: z.boolean(),
  ExecutionCount: z.number().int().nonnegative(),
  UnavailableReason: z.string().nullable(),
  RequiredInputs: z.array(z.string())
}).passthrough();

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
      description: 'Obtém detalhes, disponibilidade e inputs necessários de uma Action. Consulte antes de executar qualquer capability.',
      inputSchema: describeFlowActionInputSchema,
      outputSchema: describeFlowActionOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();

      try {
        const parsedArguments = describeFlowActionInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para descrever a capability de Flow.');
        }

        const meta = extractCAMeta(ctx);
        const request = {
          ...requireFlowExecutionContext(meta),
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
          success: true
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
          errorCode: normalizedError.code
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}
