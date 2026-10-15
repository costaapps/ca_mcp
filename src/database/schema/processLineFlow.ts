import { int, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/**
 * Minimal read-only mapping of the existing Msg4 ProcessLineFlow table.
 * Deliberately excludes large query/request/configuration columns.
 */
export const processLineFlow = mysqlTable('ProcessLineFlow', {
  idProcessLineFlow: int('IdProcessLineFlow').notNull(),
  idFlow: int('IdFlow'),
  idProcessLine: int('IdProcessLine'),
  idChat: int('IdChat'),
  idCompanyModule: int('IdCompanyModule'),
  description: varchar('Description', { length: 1000 }),
  objectDescription: varchar('ObjectDescription', { length: 250 }),
  objectType: varchar('ObjectType', { length: 250 }),
  dataType: varchar('DataType', { length: 50 }),
  level: varchar('Level', { length: 250 }),
  levelOrder: int('LevelOrder'),
  fatherIdFlow: varchar('FatherIdFlow', { length: 250 }),
  param: mediumtext('Param'),
  value: mediumtext('Value'),
  idMessage: int('IdMessage'),
  responseIdMessage: int('ResponseIdMessage')
});

export type ProcessLineFlowRow = typeof processLineFlow.$inferSelect;
