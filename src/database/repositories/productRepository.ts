import { and, asc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { erpItem } from '../schema/erpItem.js';

export interface ProductRecord {
  IdItem: number;
  ItemCode: string | null;
  ItemName: string | null;
  LongDescription: string | null;
  Price: number | null;
}

export interface ProductSearch {
  idCompany: number;
  itemCode?: string;
  itemName?: string;
  limit: number;
}

export interface ProductRepositoryContract {
  getProducts(search: ProductSearch): Promise<ProductRecord[]>;
}

function containsInsensitive(column: SQLWrapper, value: string): SQL {
  return sql`LOWER(${column}) LIKE LOWER(${`%${value}%`})`;
}

export class ProductRepository implements ProductRepositoryContract {
  public constructor(private readonly db: McpDatabase) {}

  public async getProducts(search: ProductSearch): Promise<ProductRecord[]> {
    const conditions: SQL[] = [
      eq(erpItem.idCompany, search.idCompany),
      eq(erpItem.active, 'Y'),
      sql`UPPER(${erpItem.status}) = UPPER('Active')`
    ];

    const itemCode = search.itemCode?.trim();
    if (itemCode) conditions.push(containsInsensitive(erpItem.itemCode, itemCode));

    const itemName = search.itemName?.trim();
    if (itemName) conditions.push(containsInsensitive(erpItem.itemName, itemName));

    const rows = await this.db
      .select({
        idItem: erpItem.idItem,
        itemCode: erpItem.itemCode,
        itemName: erpItem.itemName,
        longDescription: erpItem.longDescription,
        price: erpItem.price
      })
      .from(erpItem)
      .where(and(...conditions))
      .orderBy(asc(erpItem.itemName), asc(erpItem.itemCode), asc(erpItem.idItem))
      .limit(search.limit);

    return rows.map((row) => ({
      IdItem: row.idItem,
      ItemCode: row.itemCode,
      ItemName: row.itemName,
      LongDescription: row.longDescription,
      Price: row.price
    }));
  }
}
