import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping of the local Msg4 Company identity columns. */
export const company = mysqlTable('Company', {
  id: int('Id').notNull(),
  companyUUID: varchar('CompanyUUID', { length: 36 }).notNull(),
  name: varchar('Name', { length: 250 })
});

export type CompanyRow = typeof company.$inferSelect;
