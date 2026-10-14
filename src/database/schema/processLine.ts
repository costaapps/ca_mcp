import { int, mysqlTable } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping used to resolve the company owning a ProcessLine. */
export const processLine = mysqlTable('ProcessLine', {
  idProcessLine: int('IdProcessLine').notNull(),
  idCompanyModule: int('IdCompanyModule').notNull()
});

export type ProcessLineRow = typeof processLine.$inferSelect;
