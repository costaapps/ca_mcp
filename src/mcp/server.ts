import { McpServer } from '@modelcontextprotocol/server';

import type { TenantContextProvider } from '../tenancy/contracts.js';
import { consoleMcpLogger, type McpLogger } from './logger.js';
import { registerGetChatHistoryTool } from './tools/getChatHistory.js';
import { registerGetProcessLineFlowStateTool } from './tools/getProcessLineFlowState.js';
import { registerGetProductsTool } from './tools/getProducts.js';
import { registerGetPriceListsTool } from './tools/getPriceLists.js';
import { registerGetProductsPriceListsTool } from './tools/getProductsPriceLists.js';
import { registerResolveProductTool } from './tools/resolveProduct.js';
import { registerListFlowActionsTool } from './tools/listFlowActions.js';
import { registerDescribeFlowActionTool } from './tools/describeFlowAction.js';
import { registerExecuteFlowActionTool } from './tools/executeFlowAction.js';
import { registerListNavigationDestinationsTool } from './tools/listNavigationDestinations.js';
import { registerRequestHandoffTool } from './tools/requestHandoff.js';

export interface McpServerDependencies {
  tenantContextProvider: TenantContextProvider;
  logger?: McpLogger;
}

/**
 * Creates a fresh protocol server instance. The HTTP handler calls this
 * factory per request, so no business context is kept between MCP calls.
 */
export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const logger = dependencies.logger ?? consoleMcpLogger;
  const server = new McpServer({ name: 'costaapps-ca-mcp', version: '0.2.2' });

  registerGetChatHistoryTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerGetProcessLineFlowStateTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerGetProductsTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerGetPriceListsTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerGetProductsPriceListsTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerResolveProductTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerListFlowActionsTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerDescribeFlowActionTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerExecuteFlowActionTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerListNavigationDestinationsTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });
  registerRequestHandoffTool(server, {
    tenantContextProvider: dependencies.tenantContextProvider,
    logger
  });

  return server;
}
