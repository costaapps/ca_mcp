import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './database/connection.js';
import { ChatRepository } from './database/repositories/chatRepository.js';
import { FlowRepository } from './database/repositories/flowRepository.js';
import { ProductRepository } from './database/repositories/productRepository.js';
import { PriceListRepository } from './database/repositories/priceListRepository.js';
import { ItemPriceRepository } from './database/repositories/itemPriceRepository.js';
import { CoreFlowClient } from './core/CoreFlowClient.js';

const config = loadEnv();
const database = createDatabase(config.db);
const app = createApp({
  chatRepository: new ChatRepository(database.db),
  flowRepository: new FlowRepository(database.db),
  productRepository: new ProductRepository(database.db),
  priceListRepository: new PriceListRepository(database.db),
  itemPriceRepository: new ItemPriceRepository(database.db),
  coreFlowClient: new CoreFlowClient({
    baseUrl: config.coreApiUrl,
    timeoutMs: config.coreApiTimeoutMs
  })
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

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ type: 'server_shutdown', signal }));

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});
