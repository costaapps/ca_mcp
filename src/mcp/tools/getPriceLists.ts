import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { TenantContextProvider, TenantIdentity } from '../../tenancy/contracts.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import type { CAMeta } from '../context/caMeta.js';
import { getToolLogContext } from '../context/toolLogContext.js';
import { withRequiredTenantContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const getPriceListsInputSchema = z.object({
  Limit: z.number().int().min(1).max(100).default(50)
});

export const priceListsOutputSchema = z.object({
  PriceLists: z.array(z.object({
    IdPriceList: z.number(),
    Code: z.string().nullable(),
    Description: z.string().nullable()
  }))
});

const TOOL_NAME = 'get_pricelists';

export interface GetPriceListsToolDependencies {
  tenantContextProvider: TenantContextProvider;
  logger: McpLogger;
}

export function registerGetPriceListsTool(
  server: McpServer,
  dependencies: GetPriceListsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Consulta as listas de preços disponíveis para a empresa atual. Use quando precisar conhecer as listas comerciais da empresa.',
      inputSchema: getPriceListsInputSchema,
      outputSchema: priceListsOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();
      let meta: CAMeta | undefined;
      let tenantIdentity: TenantIdentity | undefined;

      try {
        const operationMeta = extractCAMeta(ctx);
        meta = operationMeta;
        return await withRequiredTenantContext(dependencies.tenantContextProvider, operationMeta, async (tenant) => {
          tenantIdentity = tenant.identity;
          const parsedArguments = getPriceListsInputSchema.safeParse(arguments_);
          if (!parsedArguments.success) {
            throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para consulta de listas de preços.');
          }

          const priceLists = await tenant.priceListRepository.getPriceLists({
            limit: parsedArguments.data.Limit
          });
          const structuredContent = priceListsOutputSchema.parse({ PriceLists: priceLists });

          dependencies.logger.toolCompleted({
            tool: TOOL_NAME,
            durationMs: Date.now() - startedAt,
            success: true,
            ...getToolLogContext(operationMeta, tenant.identity)
          });

          return {
            content: [{ type: 'text' as const, text: 'Listas de preços consultadas com sucesso.' }],
            structuredContent
          };
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar as listas de preços.');

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
