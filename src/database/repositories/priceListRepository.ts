import { asc, eq } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { erpPriceList } from '../schema/erpPriceList.js';

export interface PriceListRecord {
  IdPriceList: number;
  Code: string | null;
  Description: string | null;
}

export interface PriceListSearch {
  limit: number;
}

export interface PriceListRepositoryContract {
  getPriceLists(search: PriceListSearch): Promise<PriceListRecord[]>;
}

export class PriceListRepository implements PriceListRepositoryContract {
  private readonly db: McpDatabase;
  private readonly idCompany: number;

  public constructor(db: McpDatabase, idCompany: number) {
    if (!Number.isSafeInteger(idCompany) || idCompany <= 0) {
      throw new RangeError('PriceListRepository exige um IdCompany positivo.');
    }
    this.db = db;
    this.idCompany = idCompany;
    Object.freeze(this);
  }

  public async getPriceLists(search: PriceListSearch): Promise<PriceListRecord[]> {
    const rows = await this.db
      .select({
        idPriceList: erpPriceList.idPriceList,
        code: erpPriceList.code,
        description: erpPriceList.description
      })
      .from(erpPriceList)
      .where(eq(erpPriceList.idCompany, this.idCompany))
      .orderBy(asc(erpPriceList.idPriceList))
      .limit(search.limit);

    return rows.map((row) => ({
      IdPriceList: row.idPriceList,
      Code: row.code,
      Description: row.description
    }));
  }
}
