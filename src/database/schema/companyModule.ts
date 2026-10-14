import { int, mysqlTable } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping used to scope ProcessLine state to its company. */
export const companyModule = mysqlTable('CompanyModule', {
  idCompanyModule: int('IdCompanyModule').notNull(),
  idCompany: int('IdCompany').notNull()
});

export type CompanyModuleRow = typeof companyModule.$inferSelect;
