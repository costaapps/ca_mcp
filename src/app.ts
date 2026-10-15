import { type Express, type NextFunction, type Request, type Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { healthHandler, liveHealthHandler, readinessHandler } from './http/health.js';
import type { McpServerDependencies } from './mcp/server.js';
import { createMcpServer } from './mcp/server.js';

export interface AppDependencies extends McpServerDependencies {
  isReady(): Promise<boolean>;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = createMcpExpressApp();
  const mcpHandler = createMcpHandler(
    () => createMcpServer({
      tenantContextProvider: dependencies.tenantContextProvider,
      ...(dependencies.logger === undefined ? {} : { logger: dependencies.logger })
    }),
    {
      legacy: 'stateless',
      onerror: () => console.error('[MCP] falha no handler HTTP')
    }
  );
  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: () => console.error('[MCP] falha no adapter HTTP')
  });

  app.get('/health', healthHandler);
  app.get('/health/live', liveHealthHandler);
  app.get('/health/ready', readinessHandler(dependencies));
  app.all('/mcp', (request, response, next) => {
    void nodeMcpHandler(request, response, request.body).catch(next);
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error('[MCP] erro HTTP não tratado');
    if (response.headersSent) return;
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
