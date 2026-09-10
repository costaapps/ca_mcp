import { decimal, int, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** Minimal read-only mapping of the existing ERP_Item table. */
export const erpItem = mysqlTable('ERP_Item', {
  idItem: int('IdItem').notNull(),
  idCompany: int('IdCompany'),
  itemCode: varchar('ItemCode', { length: 100 }),
  itemName: varchar('ItemName', { length: 250 }),
  longDescription: mediumtext('LongDescription'),
  price: decimal('Price', { precision: 11, scale: 2, mode: 'number' }),
  active: varchar('Active', { length: 1 }),
  status: varchar('Status', { length: 50 })
});

export type ErpItemRow = typeof erpItem.$inferSelect;
