import { vi } from 'vitest';

import type { CoreFlowClientContract, CoreNavigationClientContract } from '../../src/core/contracts.js';
import type { ChatRepositoryContract } from '../../src/database/repositories/chatRepository.js';
import type { FlowRepositoryContract } from '../../src/database/repositories/flowRepository.js';
import type { ItemPriceRepositoryContract } from '../../src/database/repositories/itemPriceRepository.js';
import type { PriceListRepositoryContract } from '../../src/database/repositories/priceListRepository.js';
import type { ProductRepositoryContract } from '../../src/database/repositories/productRepository.js';
import type {
  TenantContextProvider,
  TenantIdentity,
  TenantInvocationContext
} from '../../src/tenancy/contracts.js';
import type { CAMeta } from '../../src/mcp/context/caMeta.js';

export const TEST_COMPANY_UUID = '550e8400-e29b-41d4-a716-446655440000';
export const TEST_SECOND_COMPANY_UUID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

export interface TenantFixtureOptions {
  identity?: Partial<TenantIdentity>;
  chatRepository?: ChatRepositoryContract;
  flowRepository?: FlowRepositoryContract;
  productRepository?: ProductRepositoryContract;
  priceListRepository?: PriceListRepositoryContract;
  itemPriceRepository?: ItemPriceRepositoryContract;
  coreFlowClient?: CoreFlowClientContract;
  coreNavigationClient?: CoreNavigationClientContract;
}

export interface TenantFixture {
  context: TenantInvocationContext;
  provider: TenantContextProvider;
  repositories: {
    chatRepository: ChatRepositoryContract;
    flowRepository: FlowRepositoryContract;
    productRepository: ProductRepositoryContract;
    priceListRepository: PriceListRepositoryContract;
    itemPriceRepository: ItemPriceRepositoryContract;
  };
  coreClients: {
    coreFlowClient: CoreFlowClientContract;
    coreNavigationClient: CoreNavigationClientContract;
  };
}

export function createTenantFixture(options: TenantFixtureOptions = {}): TenantFixture {
  const repositories = {
    chatRepository: options.chatRepository ?? {
      getChatHistory: vi.fn().mockResolvedValue([])
    },
    flowRepository: options.flowRepository ?? {
      getProcessLineFlowState: vi.fn().mockResolvedValue([])
    },
    productRepository: options.productRepository ?? {
      getProducts: vi.fn().mockResolvedValue([]),
      getProductById: vi.fn().mockResolvedValue(null)
    },
    priceListRepository: options.priceListRepository ?? {
      getPriceLists: vi.fn().mockResolvedValue([])
    },
    itemPriceRepository: options.itemPriceRepository ?? {
      getProductsPriceLists: vi.fn().mockResolvedValue([])
    }
  } satisfies TenantFixture['repositories'];

  const coreClients = {
    coreFlowClient: options.coreFlowClient ?? {
      listFlowActions: vi.fn().mockResolvedValue({ Success: true, ExecutionUUID: 'execution-1', Data: { Actions: [] } }),
      describeFlowAction: vi.fn(),
      executeFlowAction: vi.fn()
    },
    coreNavigationClient: options.coreNavigationClient ?? {
      listNavigationDestinations: vi.fn().mockResolvedValue({
        Success: true,
        ExecutionUUID: 'execution-1',
        Data: { Destinations: [] }
      }),
      requestHandoff: vi.fn()
    }
  } satisfies TenantFixture['coreClients'];

  const identity: TenantIdentity = Object.freeze({
    companyUUID: TEST_COMPANY_UUID,
    idCompany: 1003,
    idDatabase: 22,
    companyName: 'Test Company',
    ...options.identity
  });

  const context: TenantInvocationContext = Object.freeze({
    identity,
    ...repositories,
    getCoreFlowClient: vi.fn(async () => coreClients.coreFlowClient),
    getCoreNavigationClient: vi.fn(async () => coreClients.coreNavigationClient)
  });

  const provider: TenantContextProvider = {
    withTenantContext: vi.fn(async (_meta: CAMeta, operation) => operation(context))
  };

  return { context, provider, repositories, coreClients };
}

export function tenantMeta(execution: Record<string, unknown> = {}): { ca: { Execution: Record<string, unknown> } } {
  return {
    ca: {
      Execution: {
        CompanyUUID: TEST_COMPANY_UUID,
        IdCompany: 1003,
        ...execution
      }
    }
  };
}

/** Adds the required tenant metadata to a test tools/call request without changing its other fields. */
export function addTenantUUID(meta: unknown, companyUUID = TEST_COMPANY_UUID): Record<string, unknown> {
  const root = typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
  const ca = typeof root.ca === 'object' && root.ca !== null && !Array.isArray(root.ca)
    ? root.ca as Record<string, unknown>
    : {};
  const execution = typeof ca.Execution === 'object' && ca.Execution !== null && !Array.isArray(ca.Execution)
    ? ca.Execution as Record<string, unknown>
    : {};

  return {
    ...root,
    ca: {
      ...ca,
      Execution: { ...execution, CompanyUUID: companyUUID }
    }
  };
}
