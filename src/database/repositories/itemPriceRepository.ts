import { asc, and, eq } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { erpItemPrice } from '../schema/erpItemPrice.js';

export interface ProductPriceListRecord {
  IdItemPrice: number;
  IdItem: number | null;
  IdPriceList: number | null;
  Price: number | null;
}

export interface ProductPriceListSearch {
  idCompany: number;
  idItem: number;
}

export interface ItemPriceRepositoryContract {
  getProductsPriceLists(search: ProductPriceListSearch): Promise<ProductPriceListRecord[]>;
}

export class ItemPriceRepository implements ItemPriceRepositoryContract {
  public constructor(private readonly db: McpDatabase) {}

  public async getProductsPriceLists(
    search: ProductPriceListSearch
  ): Promise<ProductPriceListRecord[]> {
    const rows = await this.db
      .select({
        idItemPrice: erpItemPrice.idItemPrice,
        idItem: erpItemPrice.idItem,
        idPriceList: erpItemPrice.idPriceList,
        price: erpItemPrice.price
      })
      .from(erpItemPrice)
      .where(and(
        eq(erpItemPrice.idCompany, search.idCompany),
        eq(erpItemPrice.idItem, search.idItem)
      ))
      .orderBy(asc(erpItemPrice.idPriceList), asc(erpItemPrice.idItemPrice));

    return rows.map((row) => ({
      IdItemPrice: row.idItemPrice,
      IdItem: row.idItem,
      IdPriceList: row.idPriceList,
      Price: row.price
    }));
  }
}
