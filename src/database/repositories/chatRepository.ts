import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { channel, chat } from '../schema/chat.js';
import { message } from '../schema/message.js';

export interface ChatHistoryMessage {
  Sender: string;
  Text: string;
}

export interface ChatRepositoryContract {
  getChatHistory(idChat: number, idCompany: number): Promise<ChatHistoryMessage[]>;
}

export const CHAT_HISTORY_LIMIT = 15;

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
  public constructor(
    private readonly db: McpDatabase,
    private readonly boundCompanyId?: number
  ) {}

  public async getChatHistory(idChat: number, idCompany: number): Promise<ChatHistoryMessage[]> {
    if (this.boundCompanyId !== undefined && this.boundCompanyId !== idCompany) {
      throw new Error('Chat repository company scope mismatch.');
    }

    const rows = await this.db
      .select({
        idMessage: message.idMessage,
        senderType: message.senderType,
        text: message.messageText,
        dateTimeMessage: message.dateTimeMessage
      })
      .from(message)
      .innerJoin(chat, eq(message.idChat, chat.idChat))
      .innerJoin(channel, eq(chat.idChannel, channel.idChannel))
      .where(
        and(
          eq(message.idChat, idChat),
          eq(channel.idCompany, idCompany),
          isNotNull(message.messageText),
          ne(message.messageText, '')
        )
      )
      .orderBy(desc(message.dateTimeMessage), desc(message.idMessage))
      .limit(CHAT_HISTORY_LIMIT);

    return [...rows].reverse().flatMap((row) => {
      const text = toText(row.text);
      return text === null ? [] : [{ Sender: toSender(row.senderType), Text: text }];
    });
  }
}

export const chatRepositoryInternals = {
  toSender,
  toText
};
