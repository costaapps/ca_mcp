import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import type { ProductRepositoryContract } from '../../database/repositories/productRepository.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult } from '../result.js';

export const getProductsInputSchema = z.object({
  ItemCode: z.string().trim().min(1).optional(),
  ItemName: z.string().trim().min(1).optional(),
  Limit: z.number().int().min(1).max(100).default(50)
});

export const productsOutputSchema = z.object({
  Products: z.array(z.object({
    IdItem: z.number(),
    ItemCode: z.string().nullable(),
    ItemName: z.string().nullable(),
    LongDescription: z.string().nullable(),
    Price: z.number().nullable()
  }))
});

const TOOL_NAME = 'get_products';

export interface GetProductsToolDependencies {
  productRepository: ProductRepositoryContract;
  logger: McpLogger;
}

export function registerGetProductsTool(
  server: McpServer,
  dependencies: GetProductsToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Consulta produtos ativos da empresa atual, com busca opcional por código ou nome. Use quando precisar localizar itens disponíveis para a empresa.',
      inputSchema: getProductsInputSchema,
      outputSchema: productsOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();

      try {
        const parsedArguments = getProductsInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para consulta de produtos.');
        }

        const meta = extractCAMeta(ctx);
        const idCompany = requireExecutionId(meta, 'IdCompany');
        const products = await dependencies.productRepository.getProducts({
          idCompany,
          itemCode: parsedArguments.data.ItemCode,
          itemName: parsedArguments.data.ItemName,
          limit: parsedArguments.data.Limit
        });
        const structuredContent = productsOutputSchema.parse({ Products: products });

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true
        });

        return {
          content: [{ type: 'text' as const, text: 'Produtos consultados com sucesso.' }],
          structuredContent
        };
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível consultar os produtos.');

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
