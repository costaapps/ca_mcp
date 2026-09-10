import { datetime, int, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/**
 * Minimal read-only mapping of the existing Msg4 Message table.
 * The physical text column is `Text` in the Msg4 schema.
 */
export const message = mysqlTable('Message', {
  idMessage: int('IdMessage').notNull(),
  idChat: int('IdChat').notNull(),
  messageText: mediumtext('Text'),
  senderType: varchar('SenderType', { length: 100 }),
  dateTimeMessage: datetime('DateTimeMessage', { mode: 'date' })
});

export type MessageRow = typeof message.$inferSelect;
