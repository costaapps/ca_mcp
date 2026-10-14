import { describe, expect, it, vi } from 'vitest';

import type { McpDatabase } from '../../src/database/connection.js';
import { ItemPriceRepository } from '../../src/database/repositories/itemPriceRepository.js';
import { PriceListRepository } from '../../src/database/repositories/priceListRepository.js';
import { ProductRepository } from '../../src/database/repositories/productRepository.js';

interface LimitedFakeQuery<T> {
  db: McpDatabase;
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  rows: T[];
}

function limitedFakeDatabase<T>(rows: T[]): LimitedFakeQuery<T> {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return {
    db: { select } as unknown as McpDatabase,
    select,
    from,
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

describe('ERP repositories', () => {
  it('getProducts aplica projeção, limit e mapeia somente os campos contratados', async () => {
    const fake = limitedFakeDatabase([
      {
        idItem: 10,
        itemCode: 'CAR-10',
        itemName: 'Carro',
        longDescription: 'Descrição',
        price: 100
      }
    ]);

    const result = await new ProductRepository(fake.db, 7).getProducts({
      itemCode: 'car',
      itemName: 'ro',
      limit: 50
    });

    expect(result).toEqual([{
      IdItem: 10,
      ItemCode: 'CAR-10',
      ItemName: 'Carro',
      LongDescription: 'Descrição',
      Price: 100
    }]);
    expect(Object.keys(fake.select.mock.calls[0][0])).toEqual([
      'idItem',
      'itemCode',
      'itemName',
      'longDescription',
      'price'
    ]);
    expect(fake.limit).toHaveBeenCalledWith(50);
    expect(sqlEvidence(fake.where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
  });

  it('getPriceLists filtra por empresa, limita e reduz a projeção', async () => {
    const fake = limitedFakeDatabase([
      { idPriceList: 2, code: 'STANDARD', description: 'Tabela padrão' }
    ]);

    const result = await new PriceListRepository(fake.db, 7).getPriceLists({
      limit: 100
    });

    expect(result).toEqual([
      { IdPriceList: 2, Code: 'STANDARD', Description: 'Tabela padrão' }
    ]);
    expect(Object.keys(fake.select.mock.calls[0][0])).toEqual([
      'idPriceList',
      'code',
      'description'
    ]);
    expect(fake.limit).toHaveBeenCalledWith(100);
    expect(sqlEvidence(fake.where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
  });

  it('getProductById retorna somente produto ativo da empresa e limita a um registro', async () => {
    const rows = [{
      idItem: 10,
      itemCode: 'CAR-10',
      itemName: 'Carro',
      longDescription: 'Descrição',
      price: 100
    }];
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as McpDatabase;

    const result = await new ProductRepository(db, 7).getProductById({
      idItem: 10
    });

    expect(result).toEqual({
      IdItem: 10,
      ItemCode: 'CAR-10',
      ItemName: 'Carro',
      LongDescription: 'Descrição',
      Price: 100
    });
    expect(limit).toHaveBeenCalledWith(1);
    expect(sqlEvidence(where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
  });

  it('getProductsPriceLists filtra por empresa e item, sem truncar relações', async () => {
    const limit = vi.fn();
    const orderBy = vi.fn().mockResolvedValue([
      { idItemPrice: 3, idItem: 10, idPriceList: 2, price: 95 }
    ]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as McpDatabase;

    const result = await new ItemPriceRepository(db, 7).getProductsPriceLists({
      idItem: 10
    });

    expect(result).toEqual([
      { IdItemPrice: 3, IdItem: 10, IdPriceList: 2, Price: 95 }
    ]);
    expect(Object.keys(select.mock.calls[0][0])).toEqual([
      'idItemPrice',
      'idItem',
      'idPriceList',
      'price'
    ]);
    expect(limit).not.toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(orderBy.mock.calls[0]).toHaveLength(2);
    expect(sqlEvidence(where.mock.calls[0]?.[0])).toMatchObject({
      columns: expect.arrayContaining(['IdCompany']),
      params: expect.arrayContaining([7])
    });
  });

  it('propaga erros de banco', async () => {
    const fake = limitedFakeDatabase([]);
    fake.limit.mockRejectedValueOnce(new Error('ERP indisponível'));

    await expect(new ProductRepository(fake.db, 7).getProducts({
      limit: 50
    })).rejects.toThrow('ERP indisponível');
  });
});
