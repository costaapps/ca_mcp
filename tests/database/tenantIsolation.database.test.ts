import { createServer, type Server } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createTenantRuntime } from '../../src/tenancy/tenantRuntime.js';
import type { TenantRuntime } from '../../src/tenancy/tenantRuntime.js';
import type { TestCompanyFixture, TestCompanyKey } from '../fixtures/tenantEnvironment.js';

const requiredTestEnvironment = [
  'MCP_TEST_DB_HOST',
  'MCP_TEST_DB_USER',
  'MCP_TEST_DB_ALLOW_CREATE_DROP',
  'MCP_TEST_REGISTRY_DATABASE',
  'MCP_TEST_TENANT_A_DATABASE',
  'MCP_TEST_TENANT_B_DATABASE',
  'MCP_TEST_TENANT_SHARED_DATABASE'
] as const;

function assertTestOnlyEnvironment(): void {
  for (const key of requiredTestEnvironment) {
    if (process.env[key] === undefined || process.env[key]?.trim().length === 0) {
      throw new Error(`${key} precisa ser definido por npm run test:database.`);
    }
  }
  if (process.env.MCP_TEST_DB_PASSWORD === undefined) {
    throw new Error('MCP_TEST_DB_PASSWORD precisa ser definido por npm run test:database (pode ser vazio).');
  }
  if (process.env.MCP_TEST_DB_ALLOW_CREATE_DROP !== 'YES') {
    throw new Error('A suíte SQL só executa após opt-in MCP_TEST_DB_ALLOW_CREATE_DROP=YES.');
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Não foi possível obter a porta MCP de teste.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function company(key: TestCompanyKey): TestCompanyFixture {
  const uuidEnvironment: Record<TestCompanyKey, string> = {
    tenantA: 'MCP_TEST_COMPANY_A_UUID',
    tenantB: 'MCP_TEST_COMPANY_B_UUID',
    tenantSharedA: 'MCP_TEST_COMPANY_SHARED_A_UUID',
    tenantSharedB: 'MCP_TEST_COMPANY_SHARED_B_UUID'
  };
  const raw = process.env[uuidEnvironment[key]];
  if (raw === undefined) throw new Error(`UUID de teste ausente para ${key}.`);

  const definitions: Record<TestCompanyKey, Omit<TestCompanyFixture, 'companyUUID'>> = {
    tenantA: { idCompany: 7, idDatabase: 10, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-A' },
    tenantB: { idCompany: 7, idDatabase: 20, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-B' },
    tenantSharedA: { idCompany: 8, idDatabase: 30, idChat: 1008, idProcessLine: 5008, marker: 'TENANT-SHARED-A' },
    tenantSharedB: { idCompany: 9, idDatabase: 30, idChat: 1009, idProcessLine: 5009, marker: 'TENANT-SHARED-B' }
  };
  return { companyUUID: raw, ...definitions[key] };
}

function callMetadata(companyFixture: TestCompanyFixture, extra: Record<string, unknown> = {}) {
  return {
    ca: {
      Execution: {
        CompanyUUID: companyFixture.companyUUID,
        ...extra
      }
    }
  };
}

describe('isolamento multi-tenant em MariaDB efêmero', () => {
  let runtime: TenantRuntime;
  let server: Server;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    assertTestOnlyEnvironment();
    const config = loadEnv();
    runtime = createTenantRuntime(config);
    if (!(await runtime.isReady())) throw new Error('Registry de teste não ficou pronto.');

    server = createServer(createApp({
      tenantContextProvider: runtime.provider,
      isReady: runtime.isReady
    }));
    const port = await listen(server);
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    client = new Client({ name: 'ca-mcp-tenant-db-test', version: '0.2.0' });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    runtime?.beginDrain();
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    if (server?.listening) await closeServer(server);
    await runtime?.close().catch(() => undefined);
  }, 30000);

  it('initialize e tools/list funcionam sem identidade de tenant', async () => {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(11);
    const port = (server.address() as { port: number }).port;
    const readiness = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(readiness.status).toBe(200);
  });

  it('isola histórico, Flow e ERP entre bases com IdCompany repetido', async () => {
    for (const fixture of [company('tenantA'), company('tenantB')]) {
      const history = await client.callTool({
        name: 'get_chat_history',
        arguments: {},
        _meta: callMetadata(fixture, { IdChat: fixture.idChat })
      });
      expect(history.isError).not.toBe(true);
      expect(history.structuredContent).toEqual({
        Messages: [{ Sender: 'Customer', Text: `${fixture.marker} history` }]
      });

      const flow = await client.callTool({
        name: 'get_process_line_flow_state',
        arguments: {},
        _meta: callMetadata(fixture, { IdProcessLine: fixture.idProcessLine })
      });
      expect(flow.isError).not.toBe(true);
      expect(flow.structuredContent).toMatchObject({
        Steps: [expect.objectContaining({ IdProcessLine: fixture.idProcessLine, Value: fixture.marker })]
      });

      const products = await client.callTool({
        name: 'get_products',
        arguments: {},
        _meta: callMetadata(fixture, { IdCompany: fixture.idCompany })
      });
      expect(products.isError).not.toBe(true);
      expect(products.structuredContent).toMatchObject({
        Products: [expect.objectContaining({ ItemCode: `CODE-${fixture.marker}` })]
      });
    }
  });

  it('compartilha a base por IdDatabase sem cruzar histórico, Flow ou ERP local', async () => {
    for (const fixture of [company('tenantSharedA'), company('tenantSharedB')]) {
      const history = await client.callTool({
        name: 'get_chat_history',
        arguments: {},
        _meta: callMetadata(fixture, { IdChat: fixture.idChat })
      });
      expect(history.isError).not.toBe(true);
      expect(history.structuredContent).toEqual({
        Messages: [{ Sender: 'Customer', Text: `${fixture.marker} history` }]
      });

      const flow = await client.callTool({
        name: 'get_process_line_flow_state',
        arguments: {},
        _meta: callMetadata(fixture, { IdProcessLine: fixture.idProcessLine })
      });
      expect(flow.isError).not.toBe(true);
      expect(flow.structuredContent).toMatchObject({
        Steps: [expect.objectContaining({ IdProcessLine: fixture.idProcessLine, Value: fixture.marker })]
      });

      const products = await client.callTool({
        name: 'get_products',
        arguments: {},
        _meta: callMetadata(fixture, { IdCompany: fixture.idCompany })
      });
      expect(products.isError).not.toBe(true);
      expect(products.structuredContent).toMatchObject({
        Products: [expect.objectContaining({ ItemCode: `CODE-${fixture.marker}` })]
      });

      const priceLists = await client.callTool({
        name: 'get_pricelists',
        arguments: {},
        _meta: callMetadata(fixture)
      });
      expect(priceLists.isError).not.toBe(true);
      expect(priceLists.structuredContent).toEqual({
        PriceLists: [expect.objectContaining({ Code: `LIST-${fixture.marker}` })]
      });

      const itemPrices = await client.callTool({
        name: 'get_products_pricelists',
        arguments: {},
        _meta: {
          ca: {
            ...callMetadata(fixture).ca,
            Resolved: { IdItem: 1 }
          }
        }
      });
      expect(itemPrices.isError).not.toBe(true);
      expect(itemPrices.structuredContent).toMatchObject({
        ProductsPriceLists: [expect.objectContaining({ IdItemPrice: 1, IdItem: 1 })]
      });
    }

    const crossCompanyHistory = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: callMetadata(company('tenantSharedA'), { IdChat: 1009 })
    });
    expect(crossCompanyHistory.isError).not.toBe(true);
    expect(crossCompanyHistory.structuredContent).toEqual({ Messages: [] });

    const crossCompanyFlow = await client.callTool({
      name: 'get_process_line_flow_state',
      arguments: {},
      _meta: callMetadata(company('tenantSharedA'), { IdProcessLine: 5009 })
    });
    expect(crossCompanyFlow.isError).not.toBe(true);
    expect(crossCompanyFlow.structuredContent).toEqual({ Steps: [] });
  });

  it('usa o Core configurado para cada empresa, inclusive na base compartilhada', async () => {
    for (const fixture of [company('tenantA'), company('tenantB'), company('tenantSharedA'), company('tenantSharedB')]) {
      const result = await client.callTool({
        name: 'list_flow_actions',
        arguments: {},
        _meta: callMetadata(fixture, {
          IdCompany: fixture.idCompany,
          IdProcessLine: fixture.idProcessLine,
          ExecutionUUID: `execution-${fixture.marker}`
        })
      });
      expect(result.isError).not.toBe(true);
      const expectedPath = fixture.marker.toLowerCase();
      expect(result.structuredContent).toEqual({
        Actions: [{ Action: expectedPath, Description: `Core ${expectedPath}` }]
      });
    }
  });

  it('rejeita tenant ausente do Registry e divergência em IdCompany sem fallback', async () => {
    const missing = await client.callTool({ name: 'get_chat_history', arguments: {} });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toEqual({
      Code: 'MISSING_CONTEXT',
      Required: 'Execution.CompanyUUID'
    });

    const malformed = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: { ca: { Execution: { CompanyUUID: 'tenant-a', IdChat: 1 } } }
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.structuredContent).toEqual({
      Code: 'INVALID_CONTEXT',
      Required: 'Execution.CompanyUUID'
    });

    const unknown = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: { ca: { Execution: {
        CompanyUUID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', IdChat: 1
      } } }
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent).toEqual({ Code: 'TENANT_NOT_FOUND' });

    const mismatch = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: callMetadata(company('tenantA'), { IdChat: 1007, IdCompany: 8 })
    });
    expect(mismatch.isError).toBe(true);
    expect(mismatch.structuredContent).toEqual({ Code: 'TENANT_IDENTITY_MISMATCH' });

    const mismatchedProductCompany = await client.callTool({
      name: 'get_products',
      arguments: {},
      _meta: callMetadata(company('tenantSharedA'), { IdCompany: 9 })
    });
    expect(mismatchedProductCompany.isError).toBe(true);
    expect(mismatchedProductCompany.structuredContent).toEqual({ Code: 'TENANT_IDENTITY_MISMATCH' });

    const wrongDatabase = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: callMetadata(company('tenantA'), { IdChat: 1007, IdDatabase: 999 })
    });
    expect(wrongDatabase.isError).toBe(true);
    expect(wrongDatabase.structuredContent).toEqual({ Code: 'TENANT_IDENTITY_MISMATCH' });

    const denied = await client.callTool({
      name: 'get_chat_history',
      arguments: {},
      _meta: { ca: { Execution: { CompanyUUID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', IdChat: 1 } } }
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({ Code: 'TENANT_NOT_ALLOWED' });
  });
});
