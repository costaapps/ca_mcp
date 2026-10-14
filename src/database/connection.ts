import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';

import * as schema from './schema/index.js';

export type McpDatabase = MySql2Database<typeof schema>;

export interface DatabaseCredentials {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface DatabasePoolOptions {
  readonly connectionLimit: number;
  readonly connectTimeoutMs: number;
}

export function createDatabasePool(
  config: DatabaseCredentials,
  options: DatabasePoolOptions
): Pool {
  const poolOptions: PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: options.connectionLimit,
    connectTimeout: options.connectTimeoutMs,
    waitForConnections: true,
    queueLimit: 0,
    namedPlaceholders: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4_unicode_ci'
  };

  return mysql.createPool(poolOptions);
}

export function createDrizzleDatabase(pool: Pool): McpDatabase {
  return drizzle(pool, { mode: 'default', schema });
}
