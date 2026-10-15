import { int, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping used to resolve the tenant's Core API setting. */
export const generalSettings = mysqlTable('GeneralSettings', {
  idCompany: int('IdCompany').notNull(),
  param: varchar('Param', { length: 250 }).notNull(),
  value: mediumtext('Value')
});

export type GeneralSettingsRow = typeof generalSettings.$inferSelect;
