import { decimal, int, mysqlTable } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping of the existing ERP_ItemPrice table. */
export const erpItemPrice = mysqlTable('ERP_ItemPrice', {
  idItemPrice: int('IdItemPrice').notNull(),
  idCompany: int('IdCompany'),
  idItem: int('IdItem'),
  idPriceList: int('IdPriceList'),
  price: decimal('Price', { precision: 11, scale: 4, mode: 'number' })
});

export type ErpItemPriceRow = typeof erpItemPrice.$inferSelect;
