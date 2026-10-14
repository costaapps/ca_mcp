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
  idItem: number;
}

export interface ItemPriceRepositoryContract {
  getProductsPriceLists(search: ProductPriceListSearch): Promise<ProductPriceListRecord[]>;
}

export class ItemPriceRepository implements ItemPriceRepositoryContract {
  private readonly db: McpDatabase;
  private readonly idCompany: number;

  public constructor(db: McpDatabase, idCompany: number) {
    if (!Number.isSafeInteger(idCompany) || idCompany <= 0) {
      throw new RangeError('ItemPriceRepository exige um IdCompany positivo.');
    }
    this.db = db;
    this.idCompany = idCompany;
    Object.freeze(this);
  }

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
        eq(erpItemPrice.idCompany, this.idCompany),
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
