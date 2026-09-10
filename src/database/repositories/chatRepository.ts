import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { message } from '../schema/message.js';

export interface ChatHistoryMessage {
  Sender: string;
  Text: string;
}

export interface ChatRepositoryContract {
  getChatHistory(idChat: number): Promise<ChatHistoryMessage[]>;
}

function toSender(senderType: string | null): string {
  const sender = senderType?.trim();
  return sender && sender.length > 0 ? sender : 'UNKNOWN';
}

function toText(value: string | null): string | null {
  if (value === null) return null;
  const text = String(value);
  return text.trim().length > 0 ? text : null;
}

export class ChatRepository implements ChatRepositoryContract {
  public constructor(private readonly db: McpDatabase) {}

  public async getChatHistory(idChat: number): Promise<ChatHistoryMessage[]> {
    const rows = await this.db
      .select({
        idMessage: message.idMessage,
        senderType: message.senderType,
        text: message.messageText,
        dateTimeMessage: message.dateTimeMessage
      })
      .from(message)
      .where(
        and(
          eq(message.idChat, idChat),
          isNotNull(message.messageText),
          ne(message.messageText, '')
        )
      )
      .orderBy(asc(message.dateTimeMessage), asc(message.idMessage));

    return rows.flatMap((row) => {
      const text = toText(row.text);
      return text === null ? [] : [{ Sender: toSender(row.senderType), Text: text }];
    });
  }
}

export const chatRepositoryInternals = {
  toSender,
  toText
};
