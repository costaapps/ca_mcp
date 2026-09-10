import { asc, eq } from 'drizzle-orm';

import type { McpDatabase } from '../connection.js';
import { erpPriceList } from '../schema/erpPriceList.js';

export interface PriceListRecord {
  IdPriceList: number;
  Code: string | null;
  Description: string | null;
}

export interface PriceListSearch {
  idCompany: number;
  limit: number;
}

export interface PriceListRepositoryContract {
  getPriceLists(search: PriceListSearch): Promise<PriceListRecord[]>;
}

export class PriceListRepository implements PriceListRepositoryContract {
  public constructor(private readonly db: McpDatabase) {}

  public async getPriceLists(search: PriceListSearch): Promise<PriceListRecord[]> {
    const rows = await this.db
      .select({
        idPriceList: erpPriceList.idPriceList,
        code: erpPriceList.code,
        description: erpPriceList.description
      })
      .from(erpPriceList)
      .where(eq(erpPriceList.idCompany, search.idCompany))
      .orderBy(asc(erpPriceList.idPriceList))
      .limit(search.limit);

    return rows.map((row) => ({
      IdPriceList: row.idPriceList,
      Code: row.code,
      Description: row.description
    }));
  }
}
