import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { startCoreHttpFake } from '../../tests/fixtures/coreHttpFake.js';
import {
  setupTenantEnvironment,
  TEST_COMPANIES,
  type TestCompanyKey
} from '../../tests/fixtures/tenantEnvironment.js';

const image = process.argv[2];
if (!image) throw new Error('Usage: npx tsx ops/ci/image-smoke.ts <image>');
const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

const databaseHost = process.env.MCP_TEST_DB_HOST ?? '';
const databasePort = Number(process.env.MCP_TEST_DB_PORT ?? '3306');
const databaseUser = process.env.MCP_TEST_DB_USER ?? '';
const databasePassword = process.env.MCP_TEST_DB_PASSWORD ?? '';

if (process.env.MCP_TEST_DB_ALLOW_CREATE_DROP !== 'YES') {
  throw new Error('Image smoke requires the disposable database guard MCP_TEST_DB_ALLOW_CREATE_DROP=YES.');
}
if (!['127.0.0.1', 'localhost', '::1', 'mariadb'].includes(databaseHost.trim().toLowerCase())) {
  throw new Error('Image smoke accepts only a local or ephemeral MariaDB management host.');
}
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error('MCP_TEST_DB_PORT is invalid.');
}
if (!databaseUser || !databasePassword) {
  throw new Error('MCP_TEST_DB_USER and MCP_TEST_DB_PASSWORD are required.');
}

function docker(args: string[]): string {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const exitCode = typeof error === 'object' && error !== null && 'status' in error
      ? String((error as { status?: unknown }).status ?? 'unknown')
      : 'unknown';
    throw new Error(`Docker ${args[0] ?? 'command'} failed (exit ${exitCode}).`);
  }
}

function containerPort(containerName: string): number {
  const mapping = docker(['port', containerName, '3102/tcp']);
  const match = mapping.match(/:(\d+)\s*$/);
  if (!match) throw new Error('Could not resolve the MCP container host port.');
  return Number(match[1]);
}

function verifyImageMetadata(): void {
  const imageDetails = JSON.parse(docker([
    'image', 'inspect', '--format', '{{json .}}', image!
  ])) as {
    Os: string;
    Architecture: string;
    Config: {
      User?: string;
      Entrypoint?: string[];
      Env?: string[];
      Labels?: Record<string, string>;
    };
  };
  assert.equal(imageDetails.Os, 'linux');
  assert.equal(imageDetails.Architecture, 'amd64');
  assert.equal(imageDetails.Config.User, 'node', 'the image must run without root privileges');
  assert.deepEqual(imageDetails.Config.Entrypoint, ['node', 'dist/src/server.js']);
  assert.equal(imageDetails.Config.Labels?.['org.opencontainers.image.version'], packageVersion);
  assert.equal(imageDetails.Config.Labels?.['org.opencontainers.image.source'], 'https://github.com/costaapps/ca_mcp');
  assert.match(imageDetails.Config.Labels?.['org.opencontainers.image.revision'] ?? '', /^[a-f0-9]{40}$/);
  assert.match(imageDetails.Config.Labels?.['com.costaapps.github.run'] ?? '', /^\d+$/);
  if (process.env.GITHUB_SHA) {
    assert.equal(imageDetails.Config.Labels?.['org.opencontainers.image.revision'], process.env.GITHUB_SHA);
  }
  if (process.env.GITHUB_RUN_NUMBER) {
    assert.equal(imageDetails.Config.Labels?.['com.costaapps.github.run'], process.env.GITHUB_RUN_NUMBER);
  }
  assert.ok(
    !(imageDetails.Config.Env ?? []).some((item) => /^(CENTRAL_DB_|TENANT_DB_|MCP_TEST_DB_|CORE_API_URL=|DB_(HOST|PORT|USER|PASS|PASSWORD|DATABASE)=)/.test(item)),
    'the image must not contain database credentials or test configuration'
  );
}

async function waitForReadiness(url: string, containerName: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Readiness may remain unavailable while the server connects to the ephemeral Registry.
    }

    const state = docker(['inspect', '--format', '{{.State.Status}}', containerName]);
    if (state !== 'running') throw new Error(`MCP container stopped before readiness (state=${state}).`);
    await delay(1000);
  }
  throw new Error('MCP container did not become ready within 120 seconds.');
}

function coreBaseUrlForContainer(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hostname = 'host.docker.internal';
  return url.toString().replace(/\/$/, '');
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} was not an object.`);
  }
  return value as Record<string, unknown>;
}

function executionMetadata(company: {
  companyUUID: string;
  idCompany: number;
  idDatabase: number;
  idChat: number;
  idProcessLine: number;
}, key: TestCompanyKey): { ca: { Execution: Record<string, unknown> } } {
  return {
    ca: {
      Execution: {
        CompanyUUID: company.companyUUID,
        ExecutionUUID: `image-smoke-${key}`,
        TurnUUID: `image-smoke-turn-${key}`,
        IdCompany: company.idCompany,
        IdDatabase: company.idDatabase,
        IdChat: company.idChat,
        IdProcessLine: company.idProcessLine
      }
    }
  };
}

async function main(): Promise<void> {
  const coreKeys = Object.keys(TEST_COMPANIES) as TestCompanyKey[];
  const coreFakes = new Map<TestCompanyKey, Awaited<ReturnType<typeof startCoreHttpFake>>>();
  let tenantEnvironment: Awaited<ReturnType<typeof setupTenantEnvironment>> | undefined;
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  const containerName = `ca-mcp-image-smoke-${randomUUID().slice(0, 8)}`;
  let containerStarted = false;

  try {
    verifyImageMetadata();

    for (const key of coreKeys) {
      const fake = await startCoreHttpFake(() => ({
        body: {
          Success: true,
          ExecutionUUID: `smoke-core-${key}`,
          Data: { Actions: [{ Action: `core-${key}`, Description: `route-${key}` }] }
        }
      }), { listenHost: '0.0.0.0' });
      coreFakes.set(key, fake);
    }

    tenantEnvironment = await setupTenantEnvironment({
      managementHost: databaseHost,
      port: databasePort,
      user: databaseUser,
      password: databasePassword,
      centralHost: 'host.docker.internal',
      tenantHost: 'host.docker.internal',
      coreApiUrlByCompany: Object.fromEntries(coreKeys.map((key) => [
        TEST_COMPANIES[key].companyUUID,
        coreBaseUrlForContainer(coreFakes.get(key)!.baseUrl)
      ]))
    });

    const environment = Object.entries({
      ...tenantEnvironment.centralEnv,
      NODE_ENV: 'production',
      PORT: '3102',
      CORE_API_TIMEOUT_MS: '5000'
    }).flatMap(([key, value]) => ['--env', `${key}=${value}`]);

    docker([
      'run', '--detach', '--rm', '--name', containerName, '--platform', 'linux/amd64',
      '--publish', '127.0.0.1::3102',
      '--add-host', 'host.docker.internal:host-gateway',
      '--init', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
      '--cpus', '1', '--memory', '512m', '--pids-limit', '128',
      '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
      ...environment,
      image
    ]);
    containerStarted = true;

    docker(['exec', containerName, 'node', '-e', [
      "const fs = require('node:fs');",
      "const forbidden = ['/app/.env', '/app/node_modules/vitest', '/app/node_modules/tsx', '/app/tests'];",
      "if (forbidden.some((path) => fs.existsSync(path))) process.exit(1);"
    ].join(' ')]);

    const hostPort = containerPort(containerName);
    const baseUrl = `http://127.0.0.1:${hostPort}`;
    await waitForReadiness(`${baseUrl}/health/ready`, containerName);

    client = new Client({ name: 'ca-mcp-image-smoke', version: packageVersion });
    transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);

    const listedTools = await client.listTools();
    assert.equal(listedTools.tools.length, 11, 'the packaged service must expose all eleven tools');

    for (const key of coreKeys) {
      const company = tenantEnvironment.companies[key];
      const history = await client.callTool({
        name: 'get_chat_history',
        arguments: {},
        _meta: executionMetadata(company, key)
      });
      assert.notEqual(history.isError, true, `get_chat_history failed for ${key}`);
      const historyContent = objectValue(history.structuredContent, `${key} history`);
      const messages = historyContent.Messages;
      assert.ok(Array.isArray(messages), `${key} history did not include Messages`);
      assert.ok(
        messages.some((message) => String(objectValue(message, `${key} message`).Text).includes(`${company.marker} history`)),
        `${key} received another company's chat history`
      );
      for (const otherKey of coreKeys.filter((candidate) => candidate !== key)) {
        assert.ok(
          messages.every((message) => !String(objectValue(message, `${key} message`).Text).includes(tenantEnvironment!.companies[otherKey].marker)),
          `${key} history leaked ${otherKey}`
        );
      }

      const flowState = await client.callTool({
        name: 'get_process_line_flow_state',
        arguments: {},
        _meta: executionMetadata(company, key)
      });
      assert.notEqual(flowState.isError, true, `get_process_line_flow_state failed for ${key}`);
      const stateContent = objectValue(flowState.structuredContent, `${key} flow state`);
      const steps = stateContent.Steps;
      assert.ok(Array.isArray(steps), `${key} flow state did not include Steps`);
      assert.ok(
        steps.some((step) => String(objectValue(step, `${key} flow step`).Value).includes(company.marker)),
        `${key} received another company's Flow state`
      );
      for (const otherKey of coreKeys.filter((candidate) => candidate !== key)) {
        assert.ok(
          steps.every((step) => !String(objectValue(step, `${key} flow step`).Value).includes(tenantEnvironment!.companies[otherKey].marker)),
          `${key} Flow state leaked ${otherKey}`
        );
      }

      const actions = await client.callTool({
        name: 'list_flow_actions',
        arguments: {},
        _meta: executionMetadata(company, key)
      });
      assert.notEqual(actions.isError, true, `list_flow_actions failed for ${key}`);
      const actionContent = objectValue(actions.structuredContent, `${key} flow actions`);
      const actionList = actionContent.Actions;
      assert.ok(Array.isArray(actionList), `${key} Core response did not include Actions`);
      assert.ok(
        actionList.some((action) => objectValue(action, `${key} Core action`).Action === `core-${key}`),
        `${key} was routed to the wrong Core endpoint`
      );
      assert.equal(coreFakes.get(key)!.requests.length, 1, `${key} Core endpoint received an unexpected request count`);
    }

    console.info(JSON.stringify({ type: 'image_smoke_passed', tools: listedTools.tools.length, tenants: coreKeys.length }));
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (transport) await transport.close().catch(() => undefined);
    if (containerStarted) {
      try { docker(['rm', '--force', containerName]); } catch { /* container may already have exited */ }
    }
    for (const fake of coreFakes.values()) await fake.close().catch(() => undefined);
    if (tenantEnvironment) await tenantEnvironment.close();
  }
}

await main();
