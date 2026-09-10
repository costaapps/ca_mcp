import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { ProductRepositoryContract } from '../../database/repositories/productRepository.js';
import { ERROR_CODES } from '../../errors/errorCodes.js';
import { McpToolError } from '../../errors/McpToolError.js';
import { extractCAMeta } from '../context/caMeta.js';
import { requireExecutionId } from '../context/requireContext.js';
import type { McpLogger } from '../logger.js';
import { toToolErrorResult, withResolvedMeta } from '../result.js';
import { productOutputSchema } from './getProducts.js';

export const resolveProductInputSchema = z.object({
  IdItem: z.number().int().positive()
});

export const resolveProductOutputSchema = z.object({
  Product: productOutputSchema
});

const TOOL_NAME = 'resolve_product';

export interface ResolveProductToolDependencies {
  productRepository: ProductRepositoryContract;
  logger: McpLogger;
}

export function registerResolveProductTool(
  server: McpServer,
  dependencies: ResolveProductToolDependencies
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: 'Confirma um produto específico da empresa atual a partir do IdItem selecionado e disponibiliza esse identificador no contexto resolvido para consultas dependentes.',
      inputSchema: resolveProductInputSchema,
      outputSchema: resolveProductOutputSchema
    },
    async (arguments_, ctx) => {
      const startedAt = Date.now();

      try {
        const parsedArguments = resolveProductInputSchema.safeParse(arguments_);
        if (!parsedArguments.success) {
          throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para confirmação do produto.');
        }

        const meta = extractCAMeta(ctx);
        const idCompany = requireExecutionId(meta, 'IdCompany');
        const product = await dependencies.productRepository.getProductById({
          idCompany,
          idItem: parsedArguments.data.IdItem
        });

        if (product === null) {
          throw new McpToolError(
            ERROR_CODES.PRODUCT_NOT_FOUND,
            'Produto não encontrado para a empresa atual.'
          );
        }

        const structuredContent = resolveProductOutputSchema.parse({ Product: product });
        const result = {
          content: [{ type: 'text' as const, text: 'Produto confirmado com sucesso.' }],
          structuredContent
        };

        dependencies.logger.toolCompleted({
          tool: TOOL_NAME,
          durationMs: Date.now() - startedAt,
          success: true
        });

        return withResolvedMeta(result, { IdItem: product.IdItem });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível confirmar o produto.');

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
