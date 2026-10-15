import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { TenantContextProvider, TenantIdentity } from '../../tenancy/contracts.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import type { CAMeta } from '../context/caMeta.js';
import { getToolLogContext } from '../context/toolLogContext.js';
import { requireFlowExecutionContext, withRequiredTenantContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const listFlowActionsInputSchema = z.object({});

export const listFlowActionsOutputSchema = z.object({
  Actions: z.array(z.object({
    Action: z.string(),
    Description: z.string()
  }))
});

const TOOL_NAME = 'list_flow_actions';

export interface ListFlowActionsToolDependencies {
  tenantContextProvider: TenantContextProvider;
  logger: McpLogger;
}

export function registerListFlowActionsTool(
  server: McpServer,
  dependencies: ListFlowActionsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Descobre as capabilities do AIDocument atual, retornando somente Action e Description. Use antes de selecionar uma capability; não invente nomes de Action.',
      inputSchema: listFlowActionsInputSchema,
      outputSchema: listFlowActionsOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      let executionUUID: string | undefined;
      let turnUUID: string | undefined;
      let meta: CAMeta | undefined;
      let tenantIdentity: TenantIdentity | undefined;

      try {
        const operationMeta = extractCAMeta(ctx);
        meta = operationMeta;
        return await withRequiredTenantContext(dependencies.tenantContextProvider, operationMeta, async (tenant) => {
          tenantIdentity = tenant.identity;
          if (!listFlowActionsInputSchema.safeParse(arguments_).success) {
            throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para listar as capabilities de Flow.');
          }

          const flowContext = requireFlowExecutionContext(operationMeta, tenant.identity.idCompany);
          executionUUID = flowContext.ExecutionUUID;
          turnUUID = flowContext.TurnUUID;
          const { TurnUUID: _turnUUID, ...requestContext } = flowContext;
          const request = { ...requestContext, IdCompany: tenant.identity.idCompany };
          const coreFlowClient = await tenant.getCoreFlowClient();
          const response = await coreFlowClient.listFlowActions(request);

          if (!response.Success) {
            throw new McpToolError(response.Error.Code, response.Error.Message);
          }

          const structuredContent = listFlowActionsOutputSchema.parse(response.Data);
          dependencies.logger.toolCompleted({
            tool: TOOL_NAME,
            durationMs: Date.now() - startedAt,
            success: true,
            ExecutionUUID: executionUUID,
            TurnUUID: turnUUID,
            ...getToolLogContext(operationMeta, tenant.identity)
          });

          return {
            content: [{ type: 'text' as const, text: 'Capabilities de Flow listadas com sucesso.' }],
            structuredContent
          };
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.TOOL_EXECUTION_ERROR, 'Não foi possível listar as capabilities de Flow.');

        if (!(error instanceof McpToolError)) dependencies.logger.serverError(error);

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: normalizedError.code,
          ExecutionUUID: executionUUID,
          TurnUUID: turnUUID,
          ...getToolLogContext(meta, tenantIdentity)
        });

        return toToolErrorResult(normalizedError);
      }
    }
  );
}
