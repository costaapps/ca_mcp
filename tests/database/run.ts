import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import mysql from 'mysql2/promise';

import { startCoreHttpFake, type CoreHttpFake } from '../fixtures/coreHttpFake.js';
import {
  setupTenantEnvironment,
  TEST_COMPANIES,
  type TenantEnvironment
} from '../fixtures/tenantEnvironment.js';

const unknownCompanyUUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const allowedManagementHosts = new Set(['localhost', '127.0.0.1', '::1', 'mariadb']);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} é obrigatório para executar test:database.`);
  }
  return value;
}

function testPort(): number {
  const raw = process.env.MCP_TEST_DB_PORT?.trim() || '3306';
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error('MCP_TEST_DB_PORT deve ser uma porta entre 1 e 65535.');
  }
  return value;
}

async function assertMariaDbVersion(host: string, port: number, user: string, password: string): Promise<void> {
  const connection = await mysql.createConnection({ host, port, user, password });
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
    const version = String(rows[0]?.version ?? '');
    if (!/^11\.8\.6-MariaDB/i.test(version)) {
      throw new Error(`test:database requer MariaDB 11.8.6; conectado a "${version || 'desconhecida'}".`);
    }
  } finally {
    await connection.end();
  }
}

function startVitest(): Promise<number> {
  return new Promise((resolveExit) => {
    const vitestPath = resolve('node_modules/vitest/vitest.mjs');
    const child = spawn(process.execPath, [vitestPath, 'run', '--config', 'vitest.database.config.ts'], {
      stdio: 'inherit',
      env: process.env
    });
    child.once('error', (error) => {
      console.error(`Não foi possível iniciar Vitest: ${error.message}`);
      resolveExit(1);
    });
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        console.error(`Vitest foi encerrado por ${signal}.`);
        resolveExit(1);
      } else {
        resolveExit(code ?? 1);
      }
    });
  });
}

function coreResponse(request: { path: string; body: unknown }): { body: unknown; status?: number } {
  const tenant = request.path.split('/')[1] ?? 'unknown';
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  if (request.path.includes('/flow-actions/list')) {
    return {
      body: {
        Success: true,
        ExecutionUUID: body.ExecutionUUID ?? 'execution-test',
        Data: { Actions: [{ Action: tenant, Description: `Core ${tenant}` }] }
      }
    };
  }
  if (request.path.includes('/navigation/destinations/list')) {
    return {
      body: {
        Success: true,
        ExecutionUUID: body.ExecutionUUID ?? 'execution-test',
        Data: { Destinations: [] }
      }
    };
  }
  return { status: 404, body: { Success: false, Data: null } };
}

async function main(): Promise<void> {
  const host = required('MCP_TEST_DB_HOST').trim().toLowerCase();
  if (!allowedManagementHosts.has(host)) {
    throw new Error('test:database aceita somente MariaDB local ou o alias de serviço "mariadb". Hosts remotos são bloqueados.');
  }
  const port = testPort();
  const user = required('MCP_TEST_DB_USER');
  const password = process.env.MCP_TEST_DB_PASSWORD;
  if (password === undefined) throw new Error('MCP_TEST_DB_PASSWORD deve estar definido (pode ser vazio).');
  if (process.env.MCP_TEST_DB_ALLOW_CREATE_DROP !== 'YES') {
    throw new Error('Defina MCP_TEST_DB_ALLOW_CREATE_DROP=YES somente para um MariaDB efêmero/local de teste.');
  }

  await assertMariaDbVersion(host, port, user, password);
  let core: CoreHttpFake | undefined;
  let fixture: TenantEnvironment | undefined;
  let exitCode = 1;
  try {
    core = await startCoreHttpFake(coreResponse);
    fixture = await setupTenantEnvironment({
      managementHost: host,
      port,
      user,
      password,
      coreApiUrlByCompany: {
        [TEST_COMPANIES.tenantA.companyUUID]: `${core.baseUrl}/tenant-a`,
        [TEST_COMPANIES.tenantB.companyUUID]: `${core.baseUrl}/tenant-b`,
        [TEST_COMPANIES.tenantSharedA.companyUUID]: `${core.baseUrl}/tenant-shared-a`,
        [TEST_COMPANIES.tenantSharedB.companyUUID]: `${core.baseUrl}/tenant-shared-b`,
        [TEST_COMPANIES.tenantNoCore.companyUUID]: ''
      }
    });

    Object.assign(process.env, fixture.centralEnv, fixture.testEnv);
    process.env.NODE_ENV = 'test';
    process.env.MCP_TENANT_ALLOWLIST = `${fixture.centralEnv.MCP_TENANT_ALLOWLIST},${unknownCompanyUUID}`;
    exitCode = await startVitest();
  } finally {
    if (fixture !== undefined) await fixture.close().catch((error: unknown) => {
      console.error(`Falha ao remover schemas de teste: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      exitCode = 1;
    });
    await core?.close().catch(() => {
      console.error('Falha ao encerrar o Core HTTP fake.');
      exitCode = 1;
    });
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha desconhecida';
  console.error(`test:database não executado: ${message}`);
  process.exitCode = 1;
});
