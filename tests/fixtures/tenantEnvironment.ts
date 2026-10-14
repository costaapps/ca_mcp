import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import mysql from 'mysql2/promise';

export const TEST_COMPANIES = Object.freeze({
  tenantA: Object.freeze({ companyUUID: '11111111-1111-4111-8111-111111111111', idCompany: 7, idDatabase: 10 }),
  tenantB: Object.freeze({ companyUUID: '22222222-2222-4222-8222-222222222222', idCompany: 7, idDatabase: 20 }),
  tenantSharedA: Object.freeze({ companyUUID: '33333333-3333-4333-8333-333333333333', idCompany: 8, idDatabase: 30 }),
  tenantSharedB: Object.freeze({ companyUUID: '44444444-4444-4444-8444-444444444444', idCompany: 9, idDatabase: 30 })
});

export type TestCompanyKey = keyof typeof TEST_COMPANIES;

export interface TenantEnvironmentOptions {
  /** Address used by this fixture process to create and clean the temporary schemas. */
  managementHost: string;
  port: number;
  user: string;
  password: string;
  /** Address the MCP container uses for the central Registry (for example host.docker.internal). */
  centralHost?: string;
  /** Address the MCP container uses to reach tenant database hosts. */
  tenantHost?: string;
  /** Per-company endpoints let a smoke test prove the intended Core received the request. */
  coreApiUrlByCompany?: Readonly<Record<string, string>>;
  coreApiUrl?: string;
}

export interface TestCompanyFixture {
  readonly companyUUID: string;
  readonly idCompany: number;
  readonly idDatabase: number;
  readonly idChat: number;
  readonly idProcessLine: number;
  readonly marker: string;
}

export interface TenantEnvironment {
  readonly databases: {
    readonly registry: string;
    readonly tenantA: string;
    readonly tenantB: string;
    readonly tenantShared: string;
  };
  readonly companies: Readonly<Record<TestCompanyKey, TestCompanyFixture>>;
  readonly centralEnv: Readonly<Record<string, string>>;
  readonly testEnv: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

const allowedManagementHosts = new Set(['localhost', '127.0.0.1', '::1', 'mariadb']);
const allowedServiceHosts = new Set([...allowedManagementHosts, 'host.docker.internal']);

function quoteIdentifier(value: string): string {
  if (!/^ca_mcp_test_[a-f0-9]{32}_(registry|a|b|shared)$/.test(value)) {
    throw new Error('Generated tenant fixture database name is invalid.');
  }
  return `\`${value}\``;
}

function validateServiceHost(value: string, kind: 'central' | 'tenant'): string {
  const host = value.trim().toLowerCase();
  if (!allowedServiceHosts.has(host)) {
    throw new Error(`Tenant fixture ${kind} host must be a documented local Docker alias.`);
  }
  return host;
}

async function seedCompany(
  connection: mysql.Connection,
  company: TestCompanyFixture,
  name: string
): Promise<void> {
  await connection.execute(
    'INSERT INTO `Company` (`Id`, `CompanyUUID`, `Name`) VALUES (?, ?, ?)',
    [company.idCompany, company.companyUUID, name]
  );
  await connection.execute(
    'INSERT INTO `GeneralSettings` (`IdCompany`, `Param`, `Value`) VALUES (?, ?, ?)',
    [company.idCompany, 'MSG4COREAPI', 'http://127.0.0.1:1']
  );

  const channelId = 700 + company.idCompany;
  await connection.execute('INSERT INTO `Channel` (`IdChannel`, `IdCompany`) VALUES (?, ?)', [channelId, company.idCompany]);
  await connection.execute('INSERT INTO `Chat` (`IdChat`, `IdChannel`) VALUES (?, ?)', [company.idChat, channelId]);
  await connection.execute(
    'INSERT INTO `Message` (`IdMessage`, `IdChat`, `Text`, `SenderType`, `DateTimeMessage`) VALUES (?, ?, ?, ?, ?)',
    [11000 + company.idCompany, company.idChat, `${company.marker} history`, 'Customer', '2026-10-13 12:00:00']
  );

  const companyModuleId = 800 + company.idCompany;
  await connection.execute('INSERT INTO `CompanyModule` (`IdCompanyModule`, `IdCompany`) VALUES (?, ?)', [companyModuleId, company.idCompany]);
  await connection.execute('INSERT INTO `ProcessLine` (`IdProcessLine`, `IdCompanyModule`) VALUES (?, ?)', [company.idProcessLine, companyModuleId]);
  await connection.execute(
    'INSERT INTO `ProcessLineFlow` (`IdProcessLineFlow`, `IdFlow`, `IdProcessLine`, `IdChat`, `IdCompanyModule`, `Description`, `ObjectDescription`, `ObjectType`, `DataType`, `Level`, `LevelOrder`, `FatherIdFlow`, `Param`, `Value`, `IdMessage`, `ResponseIdMessage`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [15000 + company.idCompany, 1, company.idProcessLine, company.idChat, companyModuleId, `${company.marker} flow`, null, 'PROMPT', 'string', '1', 1, null, 'Response', company.marker, 11000 + company.idCompany, null]
  );
  await connection.execute(
    'INSERT INTO `ERP_Item` (`IdItem`, `IdCompany`, `ItemCode`, `ItemName`, `LongDescription`, `Price`, `Active`, `Status`) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)',
    [1, company.idCompany, `CODE-${company.marker}`, `${company.marker} product`, null, 10, 'Y', 'Active',
      2, company.idCompany, `CODE-${company.marker}`, `${company.marker} product`, null, 10, 'Y', 'Ativo']
  );
  await connection.execute(
    'INSERT INTO `ERP_PriceList` (`IdPriceList`, `IdCompany`, `Code`, `Description`) VALUES (?, ?, ?, ?)',
    [1, company.idCompany, `LIST-${company.marker}`, `${company.marker} price list`]
  );
  await connection.execute(
    'INSERT INTO `ERP_ItemPrice` (`IdItemPrice`, `IdCompany`, `IdItem`, `IdPriceList`, `Price`) VALUES (?, ?, ?, ?, ?)',
    [1, company.idCompany, 1, 1, 10.25]
  );
}

/**
 * Builds isolated databases with generated names and drops only those same schemas in close().
 * The explicit opt-in prevents normal test runs from ever provisioning a database by accident.
 */
export async function setupTenantEnvironment(options: TenantEnvironmentOptions): Promise<TenantEnvironment> {
  const managementHost = options.managementHost.trim().toLowerCase();
  if (!allowedManagementHosts.has(managementHost)) {
    throw new Error('Tenant fixtures accept only local MariaDB or the "mariadb" service alias.');
  }
  if (process.env.MCP_TEST_DB_ALLOW_CREATE_DROP !== 'YES') {
    throw new Error('Set MCP_TEST_DB_ALLOW_CREATE_DROP=YES only for an ephemeral/local test MariaDB.');
  }
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('Test database port is invalid.');
  }
  if (!options.user.trim()) throw new Error('Test database user is required.');

  const token = randomUUID().replaceAll('-', '');
  const databases = Object.freeze({
    registry: `ca_mcp_test_${token}_registry`,
    tenantA: `ca_mcp_test_${token}_a`,
    tenantB: `ca_mcp_test_${token}_b`,
    tenantShared: `ca_mcp_test_${token}_shared`
  });
  const centralHost = options.centralHost === undefined
    ? managementHost
    : validateServiceHost(options.centralHost, 'central');
  const tenantHost = options.tenantHost === undefined
    ? managementHost
    : validateServiceHost(options.tenantHost, 'tenant');
  const companies: Readonly<Record<TestCompanyKey, TestCompanyFixture>> = Object.freeze({
    tenantA: Object.freeze({ ...TEST_COMPANIES.tenantA, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-A' }),
    tenantB: Object.freeze({ ...TEST_COMPANIES.tenantB, idChat: 1007, idProcessLine: 5007, marker: 'TENANT-B' }),
    tenantSharedA: Object.freeze({ ...TEST_COMPANIES.tenantSharedA, idChat: 1008, idProcessLine: 5008, marker: 'TENANT-SHARED-A' }),
    tenantSharedB: Object.freeze({ ...TEST_COMPANIES.tenantSharedB, idChat: 1009, idProcessLine: 5009, marker: 'TENANT-SHARED-B' })
  });

  const admin = await mysql.createConnection({
    host: managementHost,
    port: options.port,
    user: options.user,
    password: options.password
  });
  const createdSchemas: string[] = [];

  try {
    for (const name of Object.values(databases)) {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdSchemas.push(name);
    }

    const registrySql = await readFile(resolve('tests/database/fixtures/registry.sql'), 'utf8');
    const tenantSql = await readFile(resolve('tests/database/fixtures/tenant.sql'), 'utf8');
    for (const [name, sql] of [
      [databases.registry, registrySql],
      [databases.tenantA, tenantSql],
      [databases.tenantB, tenantSql],
      [databases.tenantShared, tenantSql]
    ] as const) {
      const connection = await mysql.createConnection({
        host: managementHost,
        port: options.port,
        user: options.user,
        password: options.password,
        database: name,
        multipleStatements: true
      });
      try {
        await connection.query(sql);
      } finally {
        await connection.end();
      }
    }

    const registry = await mysql.createConnection({
      host: managementHost,
      port: options.port,
      user: options.user,
      password: options.password,
      database: databases.registry
    });
    try {
      for (const [idDatabase, databaseName] of [
        [10, databases.tenantA], [20, databases.tenantB], [30, databases.tenantShared]
      ] as const) {
        await registry.execute(
          'INSERT INTO `Databases` (`IdDatabase`, `Hostname`, `Port`, `DBName`, `Username`, `Password`) VALUES (?, ?, ?, ?, ?, ?)',
          [idDatabase, tenantHost, options.port, databaseName, options.user, options.password]
        );
      }
      await registry.execute(
        'INSERT INTO `Company` (`IdDatabase`, `IdCompany`, `CompanyUUID`, `Name`) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
        [10, 7, companies.tenantA.companyUUID, 'Tenant A',
          20, 7, companies.tenantB.companyUUID, 'Tenant B',
          30, 8, companies.tenantSharedA.companyUUID, 'Tenant Shared A',
          30, 9, companies.tenantSharedB.companyUUID, 'Tenant Shared B']
      );
    } finally {
      await registry.end();
    }

    const seed = async (name: string, items: ReadonlyArray<TestCompanyKey>): Promise<void> => {
      const connection = await mysql.createConnection({
        host: managementHost,
        port: options.port,
        user: options.user,
        password: options.password,
        database: name
      });
      try {
        for (const key of items) {
          const labels: Record<TestCompanyKey, string> = {
            tenantA: 'Tenant A',
            tenantB: 'Tenant B',
            tenantSharedA: 'Tenant Shared A',
            tenantSharedB: 'Tenant Shared B'
          };
          const label = labels[key];
          await seedCompany(connection, companies[key], label);
        }
      } finally {
        await connection.end();
      }
    };
    await seed(databases.tenantA, ['tenantA']);
    await seed(databases.tenantB, ['tenantB']);
    await seed(databases.tenantShared, ['tenantSharedA', 'tenantSharedB']);

    const coreUrl = (key: TestCompanyKey): string =>
      options.coreApiUrlByCompany?.[companies[key].companyUUID] ?? options.coreApiUrl ?? 'http://127.0.0.1:1';
    for (const key of Object.keys(companies) as TestCompanyKey[]) {
      const databaseName = key === 'tenantA' ? databases.tenantA
        : key === 'tenantB' ? databases.tenantB : databases.tenantShared;
      const connection = await mysql.createConnection({
        host: managementHost,
        port: options.port,
        user: options.user,
        password: options.password,
        database: databaseName
      });
      try {
        await connection.execute(
          'UPDATE `GeneralSettings` SET `Value` = ? WHERE `IdCompany` = ? AND UPPER(`Param`) = ?',
          [coreUrl(key), companies[key].idCompany, 'MSG4COREAPI']
        );
      } finally {
        await connection.end();
      }
    }

    const centralEnv = Object.freeze({
      CENTRAL_DB_HOST: centralHost,
      CENTRAL_DB_PORT: String(options.port),
      CENTRAL_DB_NAME: databases.registry,
      CENTRAL_DB_USER: options.user,
      CENTRAL_DB_PASS: options.password,
      MCP_TENANT_ALLOWLIST: Object.values(companies).map((company) => company.companyUUID).join(',')
    });
    const testEnv = Object.freeze({
      MCP_TEST_REGISTRY_DATABASE: databases.registry,
      MCP_TEST_TENANT_A_DATABASE: databases.tenantA,
      MCP_TEST_TENANT_B_DATABASE: databases.tenantB,
      MCP_TEST_TENANT_SHARED_DATABASE: databases.tenantShared,
      MCP_TEST_COMPANY_A_UUID: companies.tenantA.companyUUID,
      MCP_TEST_COMPANY_B_UUID: companies.tenantB.companyUUID,
      MCP_TEST_COMPANY_SHARED_A_UUID: companies.tenantSharedA.companyUUID,
      MCP_TEST_COMPANY_SHARED_B_UUID: companies.tenantSharedB.companyUUID
    });

    return {
      databases,
      companies,
      centralEnv,
      testEnv,
      async close() {
        const dropResults = await Promise.allSettled(createdSchemas.map((name) =>
          admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`)
        ));
        let closeError: unknown;
        await admin.end().catch((error: unknown) => { closeError = error; });
        const failedDrop = dropResults.find((result) => result.status === 'rejected');
        if (failedDrop?.status === 'rejected') throw failedDrop.reason;
        if (closeError !== undefined) throw closeError;
      }
    };
  } catch (error) {
    await Promise.allSettled(createdSchemas.map((name) =>
      admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`)
    ));
    await admin.end().catch(() => undefined);
    throw error;
  }
}
