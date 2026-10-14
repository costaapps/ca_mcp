# Deploy do ca_mcp

Este runbook cobre o serviço MCP central, a publicação de imagens no Docker Hub e a atualização de uma única instância em uma VPS Linux. O workflow de release atualiza somente o serviço `mcp` do projeto Compose `ca-mcp`; ele não instala Docker, altera o proxy nem toca em outros containers ou bancos.

## Pré-requisitos da VPS

- Docker Engine e o plugin Docker Compose v2 instalados e funcionando para o usuário de deploy.
- Bash 4+, `flock`, GNU tar, `awk`, `sed`, `stat`, `grep`, `mktemp` e `date` disponíveis no host.
- Proxy HTTPS existente encaminhando para `127.0.0.1:3102`.
- Credencial de leitura do Docker Hub instalada para o usuário que executa Docker. Prefira o credential helper do Docker. O host precisa conseguir baixar `eduardomatuellacostaapps/ca`.
- Chave SSH dedicada para deploy e a chave pública correspondente em `authorized_keys` desse usuário.
- Arquivo `shared/runtime.env` configurado antes do primeiro deploy.

Crie o diretório exclusivo e configure seu proprietário para o usuário de deploy:

```sh
sudo install -d -o mcpdeploy -g mcpdeploy -m 0750 /docker/containers/msg4/ca-mcp
sudo install -d -o mcpdeploy -g mcpdeploy -m 0750 \
  /docker/containers/msg4/ca-mcp/shared \
  /docker/containers/msg4/ca-mcp/releases \
  /docker/containers/msg4/ca-mcp/incoming
```

O usuário precisa de acesso ao Docker Engine para operar o container. Trate a conta e sua chave SSH como credenciais administrativas do host.

## Configuração do serviço

Crie `/docker/containers/msg4/ca-mcp/shared/runtime.env` fora da release. Defina os valores reais no host e aplique modo `0600`:

```dotenv
CENTRAL_DB_HOST=db-central.internal
CENTRAL_DB_PORT=3306
CENTRAL_DB_NAME=registry
CENTRAL_DB_USER=mcp_registry_readonly
CENTRAL_DB_PASS=preencher-no-host
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
```

```sh
sudo chown mcpdeploy:mcpdeploy /docker/containers/msg4/ca-mcp/shared/runtime.env
sudo chmod 0600 /docker/containers/msg4/ca-mcp/shared/runtime.env
```

`CENTRAL_DB_PASS` e as demais configurações centrais não devem ir para GitHub Actions, artifacts, argumentos de linha de comando ou imagem. `MCP_TENANT_ALLOWLIST` é a lista de empresas atendidas por esta instalação; ela não autentica a origem das chamadas.

## Configuração do GitHub

Configure estas variáveis de repositório ou de ambiente:

| Tipo | Nome | Valor |
|---|---|---|
| Variable | `MCP_DEPLOY_HOST` | DNS ou IP da VPS |
| Variable | `MCP_DEPLOY_USER` | Usuário SSH dedicado |
| Variable | `MCP_DEPLOY_PORT` | Porta SSH; pode ser omitida para usar 22 |
| Secret | `DOCKERHUB_TOKEN` | Token com permissão de escrita no Docker Hub, usado apenas pelo job de publicação |
| Secret | `MCP_DEPLOY_SSH_KEY` | Chave privada da conta de deploy |
| Secret | `MCP_DEPLOY_KNOWN_HOSTS` | Linha(s) `known_hosts` obtida(s) por canal administrativo confiável |

O workflow valida a chave do host com `StrictHostKeyChecking=yes`. Não gere `known_hosts` dinamicamente durante o deploy. CI de PR e pushes não recebe esses secrets.

## Primeira instalação

Antes de publicar `v0.2.0`, atualize o AgentRuntime para enviar `CompanyUUID` no metadata técnico em cada chamada de tool MCP e confirme que o consumidor está pronto para o contrato central. A instalação não deve receber tráfego produtivo de um consumidor antigo.

1. Faça merge da implementação validada para `main`.
2. Confirme que o commit inclui a versão `0.2.0` e que os gates da branch passaram.
3. Crie e envie a tag `v0.2.0` sobre esse commit. O workflow exige que a tag corresponda a `package.json` e que o commit faça parte de `main`.
4. Acompanhe os jobs de validação, smoke da imagem, publicação e deploy.
5. Após o healthcheck ficar saudável, valide o endpoint HTTPS pelo proxy existente e uma chamada autorizada do AgentRuntime.

O workflow publica `eduardomatuellacostaapps/ca:mcp-<run_number>`, registra o digest e usa esse digest no deploy. Não publica nem depende de `latest`. O job de publicação só ocorre depois de a imagem exata ter passado pelo smoke test.

## Atualizações

Para cada release, incremente a versão SemVer no pacote, integre e valide o commit em `main`, depois envie uma tag `vX.Y.Z` igual à versão do pacote. Uma tag reexecutada só reutiliza a imagem de mesmo run, versão e commit; divergências fazem o workflow falhar sem substituir a tag. O deploy é serializado e o host rejeita runs mais antigos que a última atualização aplicada.

O deploy guarda cada bundle e metadados em `releases/<run_number>/`, usa `current.json` como estado ativo e mantém `deploy.lock` durante atualização ou rollback. A configuração sensível continua em `shared/runtime.env`.

## Rollback operacional

Execute o comando a partir do repositório, em um ambiente que tenha `MCP_DEPLOY_HOST`, `MCP_DEPLOY_USER`, `MCP_DEPLOY_SSH_KEY` e `MCP_DEPLOY_KNOWN_HOSTS` configurados sem exibi-los no terminal:

```sh
bash ops/deploy/rollback-vps.sh 123
```

Substitua `123` por um run registrado em `releases/<run_number>/installed.json`. O script baixa a imagem anterior pelo digest, atualiza somente `mcp`, espera o healthcheck e grava o estado ativo atomicamente. Se a versão alvo falhar, ele tenta restaurar a versão que estava ativa. Rollback não altera dados ou schema dos bancos.

## Validação isolada dos scripts de deploy

Execute `bash ops/ci/test-deploy-scripts.sh` em Linux para verificar as transações de instalação, atualização, readiness, rollback e rejeição de runs antigos. O teste copia os scripts remotos para um diretório temporário, substitui o diretório fixo de deploy apenas nas cópias e injeta um comando Docker simulado no `PATH`; não conecta por SSH, não acessa Docker Engine e não toca em containers ou serviços reais. Ele também rejeita bundles com traversal, nomes duplicados, symlinks, hardlinks ou tipos especiais e verifica que `shared/runtime.env` permanece intacto.

O smoke test da imagem no workflow usa Docker e bancos descartáveis separados; os testes dos scripts operacionais não substituem esse smoke test nem uma validação final da VPS preparada.

## Diagnóstico

```sh
cd /docker/containers/msg4/ca-mcp/releases/123
docker compose --project-name ca-mcp --project-directory "$PWD" \
  --env-file release.env --file compose.yaml ps
docker compose --project-name ca-mcp --project-directory "$PWD" \
  --env-file release.env --file compose.yaml logs --tail=100 mcp
cat /docker/containers/msg4/ca-mcp/current.json
cat /docker/containers/msg4/ca-mcp/last-failure.json
```

`current.json` registra a release ativa e o maior run aplicado. `last-failure.json`, quando existe, registra um código de erro e os identificadores da tentativa, sem segredos. Em falha no primeiro deploy, o container MCP malsucedido é parado e removido; outros serviços do host não são tocados.

Antes de repetir uma instalação, corrija o código indicado em `last-failure.json` e confira readiness em `/health/ready`. O endpoint `/health` e o bind local permanecem para o proxy já instalado.
