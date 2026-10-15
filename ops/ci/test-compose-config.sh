#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/ca-mcp-compose-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

cp "$repo_root/compose.yaml" "$test_root/compose.yaml"
cat > "$test_root/.env" <<'EOF'
MCP_IMAGE=eduardomatuellacostaapps/ca:mcp-0.2.1
CENTRAL_DB_HOST=registry.test.invalid
CENTRAL_DB_PORT=3306
CENTRAL_DB_NAME=registry_test
CENTRAL_DB_USER=registry_test_user
CENTRAL_DB_PASS=not-a-real-secret
MCP_TENANT_ALLOWLIST=550e8400-e29b-41d4-a716-446655440000
CENTRAL_DB_CONNECTION_LIMIT=4
CENTRAL_REGISTRY_CACHE_MS=60000
TENANT_DB_CONNECTION_LIMIT=8
TENANT_DB_CONNECT_TIMEOUT_MS=10000
TENANT_DB_MAX_POOLS=32
TENANT_DB_IDLE_TTL_MS=300000
CORE_API_TIMEOUT_MS=60000
MCP_CORE_SETTINGS_CACHE_MS=60000
MCP_SHUTDOWN_TIMEOUT_MS=75000
EOF
chmod 0600 "$test_root/.env"

docker compose --project-directory "$test_root" --file "$test_root/compose.yaml" \
  config --format json > "$test_root/compose.json"

node --input-type=module - "$test_root/compose.json" "$repo_root" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [configPath, repoRoot] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const service = config.services?.mcp;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

if (!service) fail('Compose does not define service mcp');
if (service.image !== 'eduardomatuellacostaapps/ca:mcp-0.2.1') fail('MCP_IMAGE was not loaded from the root .env');
if (service.environment?.NODE_ENV !== 'production' || String(service.environment?.PORT) !== '3102') fail('production process settings are missing');
if (service.environment?.CENTRAL_DB_HOST !== 'registry.test.invalid' || service.environment?.CENTRAL_DB_NAME !== 'registry_test') fail('runtime settings were not loaded from the root .env');
if (service.init !== true || service.restart !== 'unless-stopped') fail('init or restart policy changed');
if (service.read_only !== true) fail('container root filesystem is not read-only');
if (String(service.cpus) !== '1' || Number(service.mem_limit) !== 536870912 || Number(service.pids_limit) !== 128) fail('resource limits changed');
if (!service.ports?.some((port) => port.host_ip === '127.0.0.1' && String(port.published) === '3102' && Number(port.target) === 3102)) fail('port is not restricted to loopback:3102');
if (!service.cap_drop?.includes('ALL') || !service.security_opt?.includes('no-new-privileges:true')) fail('container privilege restrictions changed');
if (!service.tmpfs?.some((mount) => String(mount).startsWith('/tmp:'))) fail('/tmp is not configured as temporary writable storage');
if (!['90s', '1m30s'].includes(String(service.stop_grace_period))) fail('graceful stop period is not 90 seconds');
if (!JSON.stringify(service.healthcheck).includes('/health/ready')) fail('readiness healthcheck is missing');

const dockerignore = readFileSync(join(repoRoot, '.dockerignore'), 'utf8').split(/\r?\n/);
if (!dockerignore.includes('.env') || !dockerignore.includes('.env.*')) fail('Docker build context does not exclude local env files');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
if (!/^USER\s+node\s*$/m.test(dockerfile)) fail('production image does not run as the unprivileged node user');
const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8').split(/\r?\n/);
if (!gitignore.includes('.env')) fail('root .env is not ignored by Git');
const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8');
const sampleKeys = new Set(envExample.split(/\r?\n/).map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean));
if ((envExample.match(/^\s*MCP_IMAGE\s*=/gm) ?? []).length !== 1) fail('.env.example must define exactly one MCP_IMAGE');
if (!/^\s*MCP_IMAGE=eduardomatuellacostaapps\/ca:mcp-[0-9]+\.[0-9]+\.[0-9]+\s*$/m.test(envExample)) fail('.env.example must select a semantic-version Docker Hub tag');
for (const key of [
  'CENTRAL_DB_HOST', 'CENTRAL_DB_PORT', 'CENTRAL_DB_NAME', 'CENTRAL_DB_USER', 'CENTRAL_DB_PASS',
  'MCP_TENANT_ALLOWLIST', 'CENTRAL_DB_CONNECTION_LIMIT', 'CENTRAL_REGISTRY_CACHE_MS',
  'TENANT_DB_CONNECTION_LIMIT', 'TENANT_DB_CONNECT_TIMEOUT_MS', 'TENANT_DB_MAX_POOLS',
  'TENANT_DB_IDLE_TTL_MS', 'CORE_API_TIMEOUT_MS', 'MCP_CORE_SETTINGS_CACHE_MS', 'MCP_SHUTDOWN_TIMEOUT_MS',
]) {
  if (!sampleKeys.has(key)) fail(`.env.example is missing ${key}`);
}

console.log('PASS: root .env configuration and hardened Compose contract');
NODE
