import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { TenantContextProvider, TenantIdentity } from '../../tenancy/contracts.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import type { CAMeta } from '../context/caMeta.js';
import { getToolLogContext } from '../context/toolLogContext.js';
import { requireExecutionId, requireResolvedId, withRequiredTenantContext } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const getProductsPriceListsInputSchema = z.object({});

export const productsPriceListsOutputSchema = z.object({
  ProductsPriceLists: z.array(z.object({
    IdItemPrice: z.number(),
    IdItem: z.number().nullable(),
    IdPriceList: z.number().nullable(),
    Price: z.number().nullable()
  }))
});

const TOOL_NAME = 'get_products_pricelists';

export interface GetProductsPriceListsToolDependencies {
  tenantContextProvider: TenantContextProvider;
  logger: McpLogger;
}

export function registerGetProductsPriceListsTool(
  server: McpServer,
  dependencies: GetProductsPriceListsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Consulta todos os preços do produto atualmente resolvido nas diferentes listas de preços da empresa. Use quando precisar comparar os preços do item.',
      inputSchema: getProductsPriceListsInputSchema,
      outputSchema: productsPriceListsOutputSchema
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
          const parsedArguments = getProductsPriceListsInputSchema.safeParse(arguments_);
          if (!parsedArguments.success) {
            throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para consulta de preços do produto.');
          }

          requireExecutionId(operationMeta, 'IdCompany');
          const idItem = requireResolvedId(operationMeta, 'IdItem');
          const prices = await tenant.itemPriceRepository.getProductsPriceLists({
            idItem
          });
          const structuredContent = productsPriceListsOutputSchema.parse({
            ProductsPriceLists: prices
          });

          dependencies.logger.toolCompleted({
            tool: TOOL_NAME,
            durationMs: Date.now() - startedAt,
            success: true,
            ...getToolLogContext(operationMeta, tenant.identity)
          });

          return {
            content: [{ type: 'text' as const, text: 'Preços do produto consultados com sucesso.' }],
            structuredContent
          };
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar os preços do produto.');

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
