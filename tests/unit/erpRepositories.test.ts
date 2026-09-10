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

    const result = await new ProductRepository(fake.db).getProducts({
      idCompany: 7,
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
  });

  it('getPriceLists filtra por empresa, limita e reduz a projeção', async () => {
    const fake = limitedFakeDatabase([
      { idPriceList: 2, code: 'STANDARD', description: 'Tabela padrão' }
    ]);

    const result = await new PriceListRepository(fake.db).getPriceLists({
      idCompany: 7,
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

    const result = await new ItemPriceRepository(db).getProductsPriceLists({
      idCompany: 7,
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
  });

  it('propaga erros de banco', async () => {
    const fake = limitedFakeDatabase([]);
    fake.limit.mockRejectedValueOnce(new Error('ERP indisponível'));

    await expect(new ProductRepository(fake.db).getProducts({
      idCompany: 7,
      limit: 50
    })).rejects.toThrow('ERP indisponível');
  });
});
