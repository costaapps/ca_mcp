import { McpServer } from '@modelcontextprotocol/server';

import type { ChatRepositoryContract } from '../database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../database/repositories/flowRepository.js';
import type { ProductRepositoryContract } from '../database/repositories/productRepository.js';
import type { PriceListRepositoryContract } from '../database/repositories/priceListRepository.js';
import type { ItemPriceRepositoryContract } from '../database/repositories/itemPriceRepository.js';
import { consoleMcpLogger, type McpLogger } from './logger.js';
import { registerGetChatHistoryTool } from './tools/getChatHistory.js';
import { registerGetProcessLineFlowStateTool } from './tools/getProcessLineFlowState.js';
import { registerGetProductsTool } from './tools/getProducts.js';
import { registerGetPriceListsTool } from './tools/getPriceLists.js';
import { registerGetProductsPriceListsTool } from './tools/getProductsPriceLists.js';
import { registerResolveProductTool } from './tools/resolveProduct.js';

export interface McpServerDependencies {
  chatRepository: ChatRepositoryContract;
  flowRepository: FlowRepositoryContract;
  productRepository: ProductRepositoryContract;
  priceListRepository: PriceListRepositoryContract;
  itemPriceRepository: ItemPriceRepositoryContract;
  logger?: McpLogger;
}

/**
 * Creates a fresh protocol server instance. The HTTP handler calls this
 * factory per request, so no business context is kept between MCP calls.
 */
export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const logger = dependencies.logger ?? consoleMcpLogger;
  const server = new McpServer({ name: 'costaapps-ca-mcp', version: '0.1.0' });

  registerGetChatHistoryTool(server, {
    chatRepository: dependencies.chatRepository,
    logger
  });
  registerGetProcessLineFlowStateTool(server, {
    flowRepository: dependencies.flowRepository,
    logger
  });
  registerGetProductsTool(server, {
    productRepository: dependencies.productRepository,
    logger
  });
  registerGetPriceListsTool(server, {
    priceListRepository: dependencies.priceListRepository,
    logger
  });
  registerGetProductsPriceListsTool(server, {
    itemPriceRepository: dependencies.itemPriceRepository,
    logger
  });
  registerResolveProductTool(server, {
    productRepository: dependencies.productRepository,
    logger
  });

  return server;
}
