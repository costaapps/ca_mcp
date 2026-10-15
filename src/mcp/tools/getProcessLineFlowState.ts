import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import type { TenantContextProvider, TenantIdentity } from '../../tenancy/contracts.js';
import type { CAMeta } from '../context/caMeta.js';
import { getToolLogContext } from '../context/toolLogContext.js';
import type { McpLogger } from '../logger.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId, withRequiredTenantContext } from '../context/requireContext.js';
import { toToolErrorResult } from '../result.js';

export const processLineFlowStateOutputSchema = z.object({
  Steps: z.array(z.object({
    IdProcessLineFlow: z.number(),
    IdFlow: z.number().nullable(),
    IdProcessLine: z.number().nullable(),
    IdChat: z.number().nullable(),
    IdCompanyModule: z.number().nullable(),
    DataType: z.string().nullable(),
    Level: z.number().nullable(),
    LevelOrder: z.number().nullable(),
    FatherIdFlow: z.string().nullable(),
    Description: z.string().nullable(),
    ObjectDescription: z.string().nullable(),
    ObjectType: z.string().nullable(),
    Param: z.string().nullable(),
    HasResponse: z.boolean(),
    Value: z.unknown().nullable(),
    IdMessage: z.number().nullable(),
    ResponseIdMessage: z.number().nullable()
  }))
});

const emptyInputSchema = z.object({});

const TOOL_NAME = 'get_process_line_flow_state';

export interface ProcessLineFlowStateToolDependencies {
  tenantContextProvider: TenantContextProvider;
  logger: McpLogger;
}

export function registerGetProcessLineFlowStateTool(
  server: McpServer,
  dependencies: ProcessLineFlowStateToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Obtém o estado das etapas da Flow da execução de módulo atual, incluindo as principais informações de cada passo e se ele já possui resposta. Use quando precisar entender o contexto do processo/fluxo atual.',
      inputSchema: emptyInputSchema,
      outputSchema: processLineFlowStateOutputSchema
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
          const idProcessLine = requireExecutionId(operationMeta, 'IdProcessLine');
          const steps = await tenant.flowRepository.getProcessLineFlowState(
            idProcessLine,
            tenant.identity.idCompany
          );
          let structuredContent: z.infer<typeof processLineFlowStateOutputSchema>;
          try {
            structuredContent = processLineFlowStateOutputSchema.parse({ Steps: steps });
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
            ...getToolLogContext(operationMeta, tenant.identity)
          });

          return {
            content: [{ type: 'text' as const, text: 'Estado do fluxo obtido com sucesso.' }],
            structuredContent
          };
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar o estado do fluxo.');

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

export const getProcessLineFlowStateToolInternals = {
  emptyInputSchema
};
