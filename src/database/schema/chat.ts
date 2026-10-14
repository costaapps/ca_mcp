import { int, mysqlTable } from 'drizzle-orm/mysql-core';

/** Minimal read-only mappings used to prove ownership of messages. */
export const chat = mysqlTable('Chat', {
  idChat: int('IdChat').notNull(),
  idChannel: int('IdChannel').notNull()
});

export const channel = mysqlTable('Channel', {
  idChannel: int('IdChannel').notNull(),
  idCompany: int('IdCompany').notNull()
});

export type ChatRow = typeof chat.$inferSelect;
export type ChannelRow = typeof channel.$inferSelect;
