import { McpServer } from '@modelcontextprotocol/server';

import type { ChatRepositoryContract } from '../database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../database/repositories/flowRepository.js';
import { consoleMcpLogger, type McpLogger } from './logger.js';
import { registerGetChatHistoryTool } from './tools/getChatHistory.js';
import { registerGetProcessLineFlowStateTool } from './tools/getProcessLineFlowState.js';

export interface McpServerDependencies {
  chatRepository: ChatRepositoryContract;
  flowRepository: FlowRepositoryContract;
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

  return server;
}
