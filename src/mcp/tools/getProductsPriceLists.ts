import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { ItemPriceRepositoryContract } from '../../database/repositories/itemPriceRepository.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId, requireResolvedId } from '../context/requireContext.js';
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
  itemPriceRepository: ItemPriceRepositoryContract;
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

      try {
        const parsedArguments = getProductsPriceListsInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para consulta de preços do produto.');
        }

        const meta = extractCAMeta(ctx);
        const idCompany = requireExecutionId(meta, 'IdCompany');
        const idItem = requireResolvedId(meta, 'IdItem');
        const prices = await dependencies.itemPriceRepository.getProductsPriceLists({
          idCompany,
          idItem
        });
        const structuredContent = productsPriceListsOutputSchema.parse({
          ProductsPriceLists: prices
        });

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true
        });

        return {
          content: [{ type: 'text' as const, text: 'Preços do produto consultados com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar os preços do produto.');

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
