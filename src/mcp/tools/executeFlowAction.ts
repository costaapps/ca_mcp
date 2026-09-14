import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';

import type { CoreFlowClientContract, JsonObject } from '../../core/contracts.js';
import { jsonValueSchema } from '../../core/schemas.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireFlowExecutionContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { withCAMeta } from '../result.js';

export const executeFlowActionInputSchema = z.object({
  Action: z.string().trim().min(1),
  Input: z.record(z.string(), jsonValueSchema)
});

const executeFlowActionSuccessSchema = z.object({
  Success: z.literal(true),
  Action: z.string(),
  Output: jsonValueSchema
});

const executeFlowActionFailureSchema = z.object({
  Success: z.literal(false),
  Action: z.string(),
  Output: z.null(),
  Error: z.object({
    Code: z.string(),
    Message: z.string()
  })
});

export const executeFlowActionOutputSchema = z.union([
  executeFlowActionSuccessSchema,
  executeFlowActionFailureSchema
]);

const TOOL_NAME = 'execute_flow_action';

export interface ExecuteFlowActionToolDependencies {
  coreFlowClient: CoreFlowClientContract;
  logger: McpLogger;
  requestUUID?: () => string;
}

function actionFromArguments(arguments_: unknown): string {
  if (typeof arguments_ !== 'object' || arguments_ === null || Array.isArray(arguments_)) return '';
  const action = (arguments_ as Record<string, unknown>).Action;
  return typeof action === 'string' ? action.trim() : '';
}

function executeFailureResult(error: McpToolError, action: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }],
    structuredContent: {
      Success: false,
      Action: action,
      Output: null,
      Error: {
        Code: error.code,
        Message: error.message
      }
    }
  };
}

export function registerExecuteFlowActionTool(
  server: McpServer,
  dependencies: ExecuteFlowActionToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Executa uma capability do AIDocument atual. Use apenas uma Action descoberta e descrita. O Core revalida disponibilidade e lifecycle no momento da execução.',
      inputSchema: executeFlowActionInputSchema,
      outputSchema: executeFlowActionOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      const action = actionFromArguments(arguments_);
      let executionUUID: string | undefined;
      let turnUUID: string | undefined;
      let requestUUIDForLog: string | undefined;
      let invocationUUID: string | undefined;

      try {
        const parsedArguments = executeFlowActionInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para executar a capability de Flow.');
        }

        const meta = extractCAMeta(ctx);
        const requestContext = requireFlowExecutionContext(meta);
        executionUUID = requestContext.ExecutionUUID;
        turnUUID = requestContext.TurnUUID;
        const { TurnUUID: _turnUUID, ...coreRequest } = requestContext;
        const requestUUID = dependencies.requestUUID?.() ?? randomUUID();
        requestUUIDForLog = requestUUID;
        const response = await dependencies.coreFlowClient.executeFlowAction({
          ...coreRequest,
          RequestUUID: requestUUID,
          Action: parsedArguments.data.Action,
          Input: parsedArguments.data.Input as JsonObject
        });

        if (!response.Success) {
          const error = new McpToolError(response.Error.Code, response.Error.Message);
          dependencies.logger.toolCompleted({
            tool: TOOL_NAME,
            durationMs: Date.now() - startedAt,
            success: false,
            errorCode: error.code,
            ExecutionUUID: executionUUID,
            TurnUUID: turnUUID,
            RequestUUID: requestUUIDForLog
          });
          return executeFailureResult(error, parsedArguments.data.Action);
        }

        const result: CallToolResult = {
          content: [{ type: 'text', text: 'Capability de Flow executada com sucesso.' }],
          structuredContent: {
            Success: true,
            Action: response.Data.Action,
            Output: response.Data.Output
          }
        };
        invocationUUID = response.Data.Invocation.InvocationUUID;

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID,
          RequestUUID: requestUUIDForLog,
          InvocationUUID: invocationUUID
        });

        return withCAMeta(result, { FlowInvocation: response.Data.Invocation });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.TOOL_EXECUTION_ERROR, 'Não foi possível executar a capability de Flow.');

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID,
          RequestUUID: requestUUIDForLog,
          InvocationUUID: invocationUUID
        });

        return executeFailureResult(normalizedError, action);
      }
    }
  );
}

export const executeFlowActionToolInternals = {
  actionFromArguments,
  executeFailureResult
};
