import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql, { type RowDataPacket } from 'mysql2/promise';

import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { installShutdownHandlers } from '../../src/serverLifecycle.js';
import { createTenantRuntime } from '../../src/tenancy/tenantRuntime.js';
import type { TenantRuntime } from '../../src/tenancy/tenantRuntime.js';
import { startCoreHttpFake } from '../fixtures/coreHttpFake.js';
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
    tenantSharedB: 'MCP_TEST_COMPANY_SHARED_B_UUID',
    tenantNoCore: 'MCP_TEST_COMPANY_NO_CORE_UUID'
  };
  const raw = process.env[uuidEnvironment[key]];
  if (raw === undefined) throw new Error(`UUID de teste ausente para ${key}.`);

  const definitions: Record<TestCompanyKey, Omit<TestCompanyFixture, 'companyUUID'>> = {
    tenantA: { idCompany: 7, idDatabase: 10, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-A' },
    tenantB: { idCompany: 7, idDatabase: 20, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-B' },
    tenantSharedA: { idCompany: 8, idDatabase: 30, idChat: 1008, idProcessLine: 5008, marker: 'TENANT-SHARED-A' },
    tenantSharedB: { idCompany: 9, idDatabase: 30, idChat: 1009, idProcessLine: 5009, marker: 'TENANT-SHARED-B' },
    tenantNoCore: { idCompany: 10, idDatabase: 30, idChat: 1010, idProcessLine: 5010, marker: 'TENANT-NO-CORE' }
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

function testDatabasePort(): number {
  return Number(process.env.MCP_TEST_DB_PORT ?? process.env.CENTRAL_DB_PORT ?? '3306');
}

function openTestDatabase(database: string): Promise<mysql.Connection> {
  const host = process.env.MCP_TEST_DB_HOST;
  const user = process.env.MCP_TEST_DB_USER;
  const password = process.env.MCP_TEST_DB_PASSWORD;
  if (!host || !user || password === undefined || !/^ca_mcp_test_[a-f0-9]{32}_(registry|a|b|shared)$/.test(database)) {
    throw new Error('Acesso SQL permitido somente aos schemas efêmeros gerados pela fixture.');
  }
  return mysql.createConnection({ host, port: testDatabasePort(), user, password, database });
}

function tenantMetadata(fixture: TestCompanyFixture) {
  return {
    Execution: {
      CompanyUUID: fixture.companyUUID,
      IdCompany: fixture.idCompany,
      IdDatabase: fixture.idDatabase,
      IdChat: fixture.idChat,
      IdProcessLine: fixture.idProcessLine,
      ExecutionUUID: `execution-${fixture.marker}`
    }
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
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
        _meta: callMetadata(fixture, { IdCompany: fixture.idCompany })
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
            ...callMetadata(fixture, { IdCompany: fixture.idCompany }).ca,
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

      const navigation = await client.callTool({
        name: 'list_navigation_destinations',
        arguments: {},
        _meta: callMetadata(fixture, {
          IdCompany: fixture.idCompany,
          IdProcessLine: fixture.idProcessLine,
          ExecutionUUID: `execution-${fixture.marker}`,
          TurnUUID: `turn-${fixture.marker}`
        })
      });
      expect(navigation.isError).not.toBe(true);
      expect(navigation.structuredContent).toEqual({
        Destinations: [{
          DestinationRef: `destination-${expectedPath}`,
          Kind: 'HOME',
          Description: `Core ${expectedPath}`,
          MenuGroup: null,
          Keywords: null
        }]
      });
    }
  });

  it('mantém consultas SQL disponíveis quando a empresa não configura Core', async () => {
    const fixture = company('tenantNoCore');
    const products = await client.callTool({
      name: 'get_products',
      arguments: {},
      _meta: callMetadata(fixture, { IdCompany: fixture.idCompany })
    });
    expect(products.isError).not.toBe(true);
    expect(products.structuredContent).toMatchObject({
      Products: [expect.objectContaining({ ItemCode: `CODE-${fixture.marker}` })]
    });

    for (const name of ['list_flow_actions', 'list_navigation_destinations']) {
      const result = await client.callTool({
        name,
        arguments: {},
        _meta: callMetadata(fixture, {
          IdCompany: fixture.idCompany,
          IdProcessLine: fixture.idProcessLine,
          ExecutionUUID: 'execution-no-core',
          TurnUUID: 'turn-no-core'
        })
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ Code: 'CORE_UNAVAILABLE' });
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

  it('rejeita identidade local divergente e libera o lease para a próxima chamada', async () => {
    const fixture = company('tenantA');
    const tenantDb = await openTestDatabase(process.env.MCP_TEST_TENANT_A_DATABASE as string);
    const wrongUUID = '99999999-9999-4999-8999-999999999999';
    try {
      await tenantDb.execute('UPDATE `Company` SET `CompanyUUID` = ? WHERE `Id` = ?', [wrongUUID, fixture.idCompany]);
      await expect(runtime.provider.withTenantContext(
        tenantMetadata(fixture),
        (context) => context.chatRepository.getChatHistory(fixture.idChat, fixture.idCompany)
      )).rejects.toMatchObject({ code: 'TENANT_IDENTITY_MISMATCH' });

      await tenantDb.execute(
        'UPDATE `Company` SET `CompanyUUID` = ?, `Id` = ? WHERE `Id` = ?',
        [fixture.companyUUID, fixture.idCompany + 1, fixture.idCompany]
      );
      await expect(runtime.provider.withTenantContext(
        tenantMetadata(fixture),
        (context) => context.chatRepository.getChatHistory(fixture.idChat, fixture.idCompany)
      )).rejects.toMatchObject({ code: 'TENANT_IDENTITY_MISMATCH' });
    } finally {
      await tenantDb.execute(
        'UPDATE `Company` SET `CompanyUUID` = ?, `Id` = ? WHERE `Id` IN (?, ?)',
        [fixture.companyUUID, fixture.idCompany, fixture.idCompany, fixture.idCompany + 1]
      );
      await tenantDb.end();
    }

    await expect(runtime.provider.withTenantContext(tenantMetadata(fixture), async () => {
      throw new Error('intentional operation failure after acquiring tenant lease');
    })).rejects.toThrow('intentional operation failure after acquiring tenant lease');
    const history = await runtime.provider.withTenantContext(
      tenantMetadata(fixture),
      (context) => context.chatRepository.getChatHistory(fixture.idChat, fixture.idCompany)
    );
    expect(history).toEqual([{ Sender: 'Customer', Text: `${fixture.marker} history` }]);
  });

  it('expira o cache de MSG4COREAPI e usa a configuração de endpoint nova', async () => {
    const fixture = company('tenantA');
    const tenantDb = await openTestDatabase(process.env.MCP_TEST_TENANT_A_DATABASE as string);
    let originalUrl: string | null | undefined;
    let firstCore: Awaited<ReturnType<typeof startCoreHttpFake>> | undefined;
    let secondCore: Awaited<ReturnType<typeof startCoreHttpFake>> | undefined;
    let cacheRuntime: TenantRuntime | undefined;

    try {
      const [settings] = await tenantDb.execute<Array<RowDataPacket & { Value: string | null }>>(
        'SELECT `Value` FROM `GeneralSettings` WHERE `IdCompany` = ? AND `Param` = ? LIMIT 1',
        [fixture.idCompany, 'MSG4COREAPI']
      );
      originalUrl = settings[0]?.Value;
      if (originalUrl === undefined) throw new Error('Fixture de teste sem MSG4COREAPI.');

      firstCore = await startCoreHttpFake(() => ({ body: {
        Success: true,
        ExecutionUUID: 'cache-test',
        Data: { Actions: [{ Action: 'core-before-expiry', Description: 'Endpoint anterior' }] }
      } }));
      secondCore = await startCoreHttpFake(() => ({ body: {
        Success: true,
        ExecutionUUID: 'cache-test',
        Data: { Actions: [{ Action: 'core-after-expiry', Description: 'Endpoint atualizado' }] }
      } }));
      let clock = 100;
      const activeRuntime = createTenantRuntime(loadEnv({
        ...process.env,
        MCP_CORE_SETTINGS_CACHE_MS: '10',
        CENTRAL_REGISTRY_CACHE_MS: '60000'
      } as NodeJS.ProcessEnv), { now: () => clock });
      cacheRuntime = activeRuntime;

      const listActions = () => activeRuntime.provider.withTenantContext(
        tenantMetadata(fixture),
        async (context) => (await context.getCoreFlowClient()).listFlowActions({
          ExecutionUUID: 'cache-test',
          IdCompany: fixture.idCompany,
          IdProcessLine: fixture.idProcessLine
        })
      );

      await tenantDb.execute(
        'UPDATE `GeneralSettings` SET `Value` = ? WHERE `IdCompany` = ? AND `Param` = ?',
        [`${firstCore.baseUrl}/before`, fixture.idCompany, 'MSG4COREAPI']
      );
      const first = await listActions();
      expect(first.Data?.Actions[0]?.Action).toBe('core-before-expiry');
      expect(firstCore.requests).toHaveLength(1);

      await tenantDb.execute(
        'UPDATE `GeneralSettings` SET `Value` = ? WHERE `IdCompany` = ? AND `Param` = ?',
        [`${secondCore.baseUrl}/after`, fixture.idCompany, 'MSG4COREAPI']
      );
      clock += 11;

      const second = await listActions();
      expect(second.Data?.Actions[0]?.Action).toBe('core-after-expiry');
      expect(secondCore.requests).toHaveLength(1);
      expect(firstCore.requests[0]?.path).toContain('/before/v1/ai-document/flow-actions/list');
      expect(secondCore.requests[0]?.path).toContain('/after/v1/ai-document/flow-actions/list');
    } finally {
      try {
        await cacheRuntime?.close();
      } finally {
        try {
          if (originalUrl !== undefined) {
            await tenantDb.execute(
              'UPDATE `GeneralSettings` SET `Value` = ? WHERE `IdCompany` = ? AND `Param` = ?',
              [originalUrl, fixture.idCompany, 'MSG4COREAPI']
            );
          }
        } finally {
          await Promise.all([
            tenantDb.end(),
            ...(firstCore === undefined ? [] : [firstCore.close()]),
            ...(secondCore === undefined ? [] : [secondCore.close()])
          ]);
        }
      }
    }
  });

  it('isola falha de uma base: readiness e outro tenant seguem saudáveis', async () => {
    const brokenFixture = company('tenantA');
    const healthyFixture = company('tenantB');
    const registryDb = await openTestDatabase(process.env.MCP_TEST_REGISTRY_DATABASE as string);
    let originalPassword: string | undefined;
    let isolatedRuntime: TenantRuntime | undefined;

    try {
      const [databases] = await registryDb.execute<Array<RowDataPacket & { Password: string }>>(
        'SELECT `Password` FROM `Databases` WHERE `IdDatabase` = ?',
        [brokenFixture.idDatabase]
      );
      originalPassword = databases[0]?.Password;
      if (originalPassword === undefined) throw new Error('Fixture de Registry sem credencial de tenant A.');
      isolatedRuntime = createTenantRuntime(loadEnv({
        ...process.env,
        CENTRAL_REGISTRY_CACHE_MS: '1',
        TENANT_DB_CONNECT_TIMEOUT_MS: '1000'
      } as NodeJS.ProcessEnv));

      await registryDb.execute('UPDATE `Databases` SET `Password` = ? WHERE `IdDatabase` = ?', [
        'invalid-test-credential', brokenFixture.idDatabase
      ]);
      await expect(isolatedRuntime.provider.withTenantContext(
        tenantMetadata(brokenFixture),
        (context) => context.chatRepository.getChatHistory(brokenFixture.idChat, brokenFixture.idCompany)
      )).rejects.toMatchObject({ code: 'TENANT_DATABASE_UNAVAILABLE' });

      expect(await isolatedRuntime.isReady()).toBe(true);
      const healthyHistory = await isolatedRuntime.provider.withTenantContext(
        tenantMetadata(healthyFixture),
        (context) => context.chatRepository.getChatHistory(healthyFixture.idChat, healthyFixture.idCompany)
      );
      expect(healthyHistory).toEqual([{ Sender: 'Customer', Text: `${healthyFixture.marker} history` }]);
    } finally {
      try {
        if (originalPassword !== undefined) {
          await registryDb.execute(
            'UPDATE `Databases` SET `Password` = ? WHERE `IdDatabase` = ?',
            [originalPassword, brokenFixture.idDatabase]
          );
        }
      } finally {
        try {
          await isolatedRuntime?.close();
        } finally {
          await registryDb.end();
        }
      }
    }
  });

  it('SIGTERM inicia drain, rejeita novas invocações e aguarda a ativa', async () => {
    const fixture = company('tenantA');
    const entered = deferred<void>();
    const releaseOperation = deferred<void>();
    const processLike = new EventEmitter();
    const exit = vi.fn();
    let exitResolve!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { exitResolve = resolve; });
    const active = runtime.provider.withTenantContext(tenantMetadata(fixture), async () => {
      entered.resolve();
      await releaseOperation.promise;
      return 'operation-finished';
    });
    void active.catch(() => undefined);
    try {
      await entered.promise;
      installShutdownHandlers({
        processLike,
        server: {
          close(callback) { callback(); },
          closeAllConnections: vi.fn()
        },
        runtime,
        timeoutMs: 5000,
        exit(code) { exit(code); exitResolve(code); },
        logger: { info: vi.fn(), error: vi.fn() }
      });
      processLike.emit('SIGTERM');

      expect(await runtime.isReady()).toBe(false);
      await expect(runtime.provider.withTenantContext(tenantMetadata(fixture), async () => 'rejected'))
        .rejects.toMatchObject({ code: 'TENANT_RUNTIME_DRAINING' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(exit).not.toHaveBeenCalled();

      releaseOperation.resolve();
      await expect(active).resolves.toBe('operation-finished');
      await expect(exited).resolves.toBe(0);
      expect(exit).toHaveBeenCalledOnce();
    } finally {
      releaseOperation.resolve();
      await active.catch(() => undefined);
    }
  });

  it('SIGTERM respeita o limite de shutdown quando uma invocação não drena', async () => {
    const fixture = company('tenantB');
    const entered = deferred<void>();
    const releaseOperation = deferred<void>();
    const processLike = new EventEmitter();
    const timeoutMs = 80;
    let exitResolve!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { exitResolve = resolve; });
    const boundedRuntime = createTenantRuntime(loadEnv());
    const active = boundedRuntime.provider.withTenantContext(tenantMetadata(fixture), async () => {
      entered.resolve();
      await releaseOperation.promise;
    });
    void active.catch(() => undefined);
    try {
      await entered.promise;
      const startedAt = performance.now();
      installShutdownHandlers({
        processLike,
        server: {
          close(callback) { callback(); },
          closeAllConnections: vi.fn()
        },
        runtime: boundedRuntime,
        timeoutMs,
        exit: (code) => exitResolve(code),
        logger: { info: vi.fn(), error: vi.fn() }
      });
      processLike.emit('SIGTERM');

      await expect(exited).resolves.toBe(0);
      const elapsedMs = performance.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs - 15);
      expect(elapsedMs).toBeLessThan(timeoutMs + 1500);
      await expect(boundedRuntime.provider.withTenantContext(tenantMetadata(fixture), async () => 'rejected'))
        .rejects.toMatchObject({ code: 'TENANT_RUNTIME_DRAINING' });

      releaseOperation.resolve();
      await active;
    } finally {
      releaseOperation.resolve();
      await active.catch(() => undefined);
      await boundedRuntime.close(0).catch(() => undefined);
    }
  }, 5000);
});
