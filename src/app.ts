import { type Express, type NextFunction, type Request, type Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { healthHandler } from './http/health.js';
import type { McpServerDependencies } from './mcp/server.js';
import { createMcpServer } from './mcp/server.js';

export function createApp(dependencies: McpServerDependencies): Express {
  const app = createMcpExpressApp();
  const mcpHandler = createMcpHandler(
    () => createMcpServer(dependencies),
    {
      legacy: 'stateless',
      onerror: (error) => console.error('[MCP] erro no handler HTTP', error)
    }
  );
  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[MCP] erro no adapter HTTP', error)
  });

  app.get('/health', healthHandler);
  app.all('/mcp', (request, response, next) => {
    void nodeMcpHandler(request, response, request.body).catch(next);
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error('[MCP] erro HTTP não tratado', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
