import { z } from 'zod';

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3102),
  NODE_ENV: z.string().default('development'),
  DB_HOST: z.string().trim().min(1, 'DB_HOST é obrigatório'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().trim().min(1, 'DB_USER é obrigatório'),
  DB_PASSWORD: z.string().default(''),
  DB_DATABASE: z.string().trim().min(1, 'DB_DATABASE é obrigatório'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10)
});

export interface EnvConfig {
  port: number;
  nodeEnv: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  };
}

export function loadEnv(environment: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    db: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
      database: parsed.DB_DATABASE,
      connectionLimit: parsed.DB_CONNECTION_LIMIT
    }
  };
}
