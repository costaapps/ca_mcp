import mysql, { type Pool } from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';

import type { EnvConfig } from '../config/env.js';
import * as schema from './schema/index.js';

export type McpDatabase = MySql2Database<typeof schema>;

export interface DatabaseConnection {
  db: McpDatabase;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDatabase(config: EnvConfig['db']): DatabaseConnection {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    namedPlaceholders: false
  });

  const db = drizzle(pool, { mode: 'default', schema });

  return {
    db,
    pool,
    close: () => pool.end()
  };
}
