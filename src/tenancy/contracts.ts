import type { CAMeta } from '../mcp/context/caMeta.js';
import type { CoreFlowClientContract, CoreNavigationClientContract } from '../core/contracts.js';
import type { ChatRepositoryContract } from '../database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../database/repositories/flowRepository.js';
import type { ItemPriceRepositoryContract } from '../database/repositories/itemPriceRepository.js';
import type { PriceListRepositoryContract } from '../database/repositories/priceListRepository.js';
import type { ProductRepositoryContract } from '../database/repositories/productRepository.js';

/** Safe, immutable tenant identity. It deliberately excludes database credentials and pool handles. */
export interface TenantIdentity {
  readonly companyUUID: string;
  readonly idCompany: number;
  readonly idDatabase: number;
  readonly companyName: string;
}

/** Services leased for one invocation and bound to the resolved tenant database generation. */
export interface TenantInvocationContext {
  readonly identity: TenantIdentity;
  readonly chatRepository: ChatRepositoryContract;
  readonly flowRepository: FlowRepositoryContract;
  readonly productRepository: ProductRepositoryContract;
  readonly priceListRepository: PriceListRepositoryContract;
  readonly itemPriceRepository: ItemPriceRepositoryContract;
  /** Loaded only when a Flow tool needs it; a missing Core URL must not block database tools. */
  getCoreFlowClient(): Promise<CoreFlowClientContract>;
  /** Loaded only when a Navigation tool needs it; a missing Core URL must not block database tools. */
  getCoreNavigationClient(): Promise<CoreNavigationClientContract>;
}

/** Resolves, leases and releases tenant-bound services around one MCP tool invocation. */
export interface TenantContextProvider {
  withTenantContext<T>(
    meta: CAMeta,
    operation: (context: TenantInvocationContext) => Promise<T>
  ): Promise<T>;
}
