import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { installShutdownHandlers } from './serverLifecycle.js';
import { createTenantRuntime } from './tenancy/tenantRuntime.js';

async function startServer(): Promise<void> {
  const config = loadEnv();
  const runtime = createTenantRuntime(config);

  if (!await runtime.isReady()) {
    console.error(JSON.stringify({
      type: 'server_startup_failed',
      dependency: 'central_registry'
    }));
    process.exitCode = 1;
    await runtime.close();
    return;
  }

  const app = createApp({
    tenantContextProvider: runtime.provider,
    isReady: runtime.isReady
  });
  const server = createServer(app);

  installShutdownHandlers({
    server,
    runtime,
    timeoutMs: config.mcpShutdownTimeoutMs
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.info(JSON.stringify({
      type: 'server_started',
      port: config.port,
      nodeEnv: config.nodeEnv
    }));
  });
}

void startServer().catch(() => {
  console.error(JSON.stringify({ type: 'server_startup_failed' }));
  process.exitCode = 1;
});
