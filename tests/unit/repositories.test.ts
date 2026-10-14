import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpDatabase } from '../../src/database/connection.js';
import { CHAT_HISTORY_LIMIT, ChatRepository, chatRepositoryInternals } from '../../src/database/repositories/chatRepository.js';
import { FlowRepository, flowRepositoryInternals } from '../../src/database/repositories/flowRepository.js';

interface FakeQuery<T> {
  db: McpDatabase;
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  rows: T[];
}

function fakeDatabase<T>(
  rows: T[],
  sortRows?: (input: T[]) => T[],
  withLimit = false
): FakeQuery<T> {
  const limit = vi.fn().mockResolvedValue(sortRows?.([...rows]) ?? rows);
  const orderBy = vi.fn().mockImplementation(() => {
    if (withLimit) return { limit };
    return Promise.resolve(sortRows?.([...rows]) ?? rows);
  });
  const where = vi.fn().mockReturnValue({ orderBy });
  const query = { where } as { where: ReturnType<typeof vi.fn>; innerJoin: ReturnType<typeof vi.fn> };
  const innerJoin = vi.fn().mockImplementation(() => query);
  query.innerJoin = innerJoin;
  const from = vi.fn().mockReturnValue(query);
  const select = vi.fn().mockReturnValue({ from });

  return {
    db: { select } as unknown as McpDatabase,
    select,
    from,
    innerJoin,
    where,
    orderBy,
    limit,
    rows
  };
}

function sqlEvidence(value: unknown, evidence = { columns: [] as string[], params: [] as unknown[] }): typeof evidence {
  if (Array.isArray(value)) {
    for (const item of value) sqlEvidence(item, evidence);
    return evidence;
  }
  if (typeof value !== 'object' || value === null) return evidence;

  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string' && 'table' in record) evidence.columns.push(record.name);
  if ('encoder' in record && 'value' in record) evidence.params.push(record.value);
  if ('queryChunks' in record) sqlEvidence(record.queryChunks, evidence);
  return evidence;
}

describe('ChatRepository', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('filtra por IdChat, projeta somente campos mínimos e respeita ordenação cronológica', async () => {
    const fake = fakeDatabase([
      { idMessage: 2, senderType: 'Customer', text: 'segunda', dateTimeMessage: new Date('2026-01-01T10:01:00Z') },
      { idMessage: 1, senderType: 'System', text: 'primeira', dateTimeMessage: new Date('2026-01-01T10:00:00Z') },
      { idMessage: 3, senderType: 'Customer', text: '   ', dateTimeMessage: new Date('2026-01-01T10:02:00Z') },
      { idMessage: 4, senderType: 'Customer', text: null, dateTimeMessage: new Date('2026-01-01T10:03:00Z') }
    ], (rows) => rows.sort((a, b) => {
      const left = a as { dateTimeMessage: Date; idMessage: number };
      const right = b as { dateTimeMessage: Date; idMessage: number };
      return right.dateTimeMessage.getTime() - left.dateTimeMessage.getTime() || right.idMessage - left.idMessage;
    }), true);

    const repository = new ChatRepository(fake.db);
    const result = await repository.getChatHistory(123, 7);

    expect(result).toEqual([
      { Sender: 'System', Text: 'primeira' },
      { Sender: 'Customer', Text: 'segunda' }
    ]);
    expect(fake.select).toHaveBeenCalledWith(expect.objectContaining({
      idMessage: expect.anything(),
      senderType: expect.anything(),
      text: expect.anything(),
      dateTimeMessage: expect.anything()
    }));
    expect(Object.keys(fake.select.mock.calls[0][0])).toEqual([
      'idMessage',
      'senderType',
      'text',
      'dateTimeMessage'
    ]);
    expect(fake.where).toHaveBeenCalledTimes(1);
    expect(fake.innerJoin).toHaveBeenCalledTimes(2);
    expect(fake.innerJoin.mock.calls[0]?.[0]).toMatchObject({ idChat: expect.anything() });
    expect(fake.innerJoin.mock.calls[1]?.[0]).toMatchObject({ idChannel: expect.anything() });
    expect(sqlEvidence(fake.where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
    expect(fake.orderBy).toHaveBeenCalledTimes(1);
    expect(fake.orderBy.mock.calls[0]).toHaveLength(2);
    expect(fake.limit).toHaveBeenCalledWith(CHAT_HISTORY_LIMIT);
  });

  it('preserva SenderType real e usa UNKNOWN somente quando não há valor', () => {
    expect(chatRepositoryInternals.toSender('  Operator  ')).toBe('Operator');
    expect(chatRepositoryInternals.toSender(null)).toBe('UNKNOWN');
    expect(chatRepositoryInternals.toSender('')).toBe('UNKNOWN');
  });

  it('propaga erro de banco para a camada da tool', async () => {
    const fake = fakeDatabase([], undefined, true);
    fake.limit.mockRejectedValueOnce(new Error('db down'));
    const repository = new ChatRepository(fake.db);

    await expect(repository.getChatHistory(123, 7)).rejects.toThrow('db down');
  });
});

describe('FlowRepository', () => {
  it('filtra por IdProcessLine, ordena e reduz o DTO sem payloads extensos', async () => {
    const fake = fakeDatabase([
      {
        idProcessLineFlow: 1002,
        idFlow: 222,
        idProcessLine: 456,
        idChat: 123,
        idCompanyModule: 9,
        dataType: 'string',
        level: '2',
        levelOrder: 1,
        fatherIdFlow: null,
        description: 'Resposta',
        objectDescription: 'Campo',
        objectType: 'PROMPT',
        param: 'Response',
        value: '{"answer":"ok"}',
        idMessage: 70,
        responseIdMessage: 71
      },
      {
        idProcessLineFlow: 1001,
        idFlow: 111,
        idProcessLine: 456,
        idChat: 123,
        idCompanyModule: 9,
        dataType: 'string',
        level: '1',
        levelOrder: 1,
        fatherIdFlow: null,
        description: 'Pergunta',
        objectDescription: 'Pergunta inicial',
        objectType: 'PROMPT',
        param: 'Question',
        value: 'Quero comprar',
        idMessage: 69,
        responseIdMessage: null
      }
    ], (rows) => rows.sort((a, b) => {
      const left = a as { level: string; levelOrder: number; idProcessLineFlow: number };
      const right = b as { level: string; levelOrder: number; idProcessLineFlow: number };
      return Number(left.level) - Number(right.level) || left.levelOrder - right.levelOrder || left.idProcessLineFlow - right.idProcessLineFlow;
    }));

    const repository = new FlowRepository(fake.db);
    const result = await repository.getProcessLineFlowState(456, 7);

    expect(result).toEqual([
      {
        IdProcessLineFlow: 1001,
        IdFlow: 111,
        IdProcessLine: 456,
        IdChat: 123,
        IdCompanyModule: 9,
        DataType: 'string',
        Level: 1,
        LevelOrder: 1,
        FatherIdFlow: null,
        Description: 'Pergunta',
        ObjectDescription: 'Pergunta inicial',
        ObjectType: 'PROMPT',
        Param: 'Question',
        HasResponse: false,
        Value: 'Quero comprar',
        IdMessage: 69,
        ResponseIdMessage: null
      },
      {
        IdProcessLineFlow: 1002,
        IdFlow: 222,
        IdProcessLine: 456,
        IdChat: 123,
        IdCompanyModule: 9,
        DataType: 'string',
        Level: 2,
        LevelOrder: 1,
        FatherIdFlow: null,
        Description: 'Resposta',
        ObjectDescription: 'Campo',
        ObjectType: 'PROMPT',
        Param: 'Response',
        HasResponse: true,
        Value: { answer: 'ok' },
        IdMessage: 70,
        ResponseIdMessage: 71
      }
    ]);
    expect(Object.keys(fake.select.mock.calls[0][0])).toEqual([
      'idProcessLineFlow',
      'idFlow',
      'idProcessLine',
      'idChat',
      'idCompanyModule',
      'dataType',
      'level',
      'levelOrder',
      'fatherIdFlow',
      'description',
      'objectDescription',
      'objectType',
      'param',
      'value',
      'idMessage',
      'responseIdMessage'
    ]);
    expect(fake.where).toHaveBeenCalledTimes(1);
    expect(fake.innerJoin).toHaveBeenCalledTimes(2);
    expect(fake.innerJoin.mock.calls[0]?.[0]).toMatchObject({ idProcessLine: expect.anything() });
    expect(fake.innerJoin.mock.calls[1]?.[0]).toMatchObject({ idCompanyModule: expect.anything() });
    expect(sqlEvidence(fake.where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
    expect(fake.orderBy.mock.calls[0]).toHaveLength(3);
  });

  it('mantém texto comum e trata Value vazio como sem resposta', () => {
    expect(flowRepositoryInternals.parseValue('texto comum')).toBe('texto comum');
    expect(flowRepositoryInternals.parseValue(null)).toBeNull();
    expect(flowRepositoryInternals.hasResponse('Response', '  ')).toBe(false);
    expect(flowRepositoryInternals.hasResponse('Response', '0')).toBe(true);
  });

  it('retorna lista vazia quando não há registros', async () => {
    const fake = fakeDatabase([]);
    const repository = new FlowRepository(fake.db);
    await expect(repository.getProcessLineFlowState(999, 7)).resolves.toEqual([]);
  });
});
