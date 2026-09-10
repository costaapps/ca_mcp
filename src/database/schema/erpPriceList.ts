import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping of the existing ERP_PriceList table. */
export const erpPriceList = mysqlTable('ERP_PriceList', {
  idPriceList: int('IdPriceList').notNull(),
  idCompany: int('IdCompany'),
  code: varchar('Code', { length: 50 }),
  description: varchar('Description', { length: 250 })
});

export type ErpPriceListRow = typeof erpPriceList.$inferSelect;
