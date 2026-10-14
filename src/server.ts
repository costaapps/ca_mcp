import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createTenantRuntime } from './tenancy/tenantRuntime.js';

const config = loadEnv();
const runtime = createTenantRuntime(config);
const app = createApp({
  tenantContextProvider: runtime.provider,
  isReady: runtime.isReady
});
const server = createServer(app);

server.listen(config.port, '0.0.0.0', () => {
  console.info(JSON.stringify({
    type: 'server_started',
    port: config.port,
    nodeEnv: config.nodeEnv
  }));
});

let shuttingDown = false;

async function closeHttpServer(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, timeoutMs);
    timeout.unref();

    server.close(() => finish());
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = Date.now() + config.mcpShutdownTimeoutMs;
  runtime.beginDrain();
  console.info(JSON.stringify({ type: 'server_shutdown', signal }));

  await Promise.all([
    closeHttpServer(Math.max(0, deadline - Date.now())),
    runtime.close(Math.max(0, deadline - Date.now()))
  ]);
}

function handleSignal(signal: string): void {
  void shutdown(signal).then(
    () => process.exit(0),
    () => {
      console.error(JSON.stringify({ type: 'server_shutdown_failed', signal }));
      process.exit(1);
    }
  );
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
