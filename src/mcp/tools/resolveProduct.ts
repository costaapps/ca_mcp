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
  tenantContextProvider: TenantContextProvider;
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
      let meta: CAMeta | undefined;
      let tenantIdentity: TenantIdentity | undefined;

      try {
        const operationMeta = extractCAMeta(ctx);
        meta = operationMeta;
        return await withRequiredTenantContext(dependencies.tenantContextProvider, operationMeta, async (tenant) => {
          tenantIdentity = tenant.identity;
          const parsedArguments = resolveProductInputSchema.safeParse(arguments_);
          if (!parsedArguments.success) {
            throw new McpToolError(ERROR_CODES.INVALID_ARGUMENTS, 'Argumentos inválidos para confirmação do produto.');
          }

          const product = await tenant.productRepository.getProductById({
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
            success: true,
            ...getToolLogContext(operationMeta, tenant.identity)
          });

          return withResolvedMeta(result, { IdItem: product.IdItem });
        });
      } catch (error) {
        const normalizedError = error instanceof McpToolError
          ? error
          : new McpToolError(ERROR_CODES.DATABASE_ERROR, 'Não foi possível confirmar o produto.');

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
