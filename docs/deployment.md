# Operação manual do ca_mcp na VPS

O GitHub Actions valida e publica imagens no Docker Hub. Ele não acessa a VPS. A instalação, atualização e reversão são feitas manualmente com Docker Compose a partir deste repositório.

## Pré-requisitos

- VPS Linux com Docker Engine e Docker Compose v2 instalados.
- Rede Docker externa `ai-shared` criada no host; o proxy HTTPS também deve estar conectado a ela.
- A VPS consegue acessar o repositório, o Docker Hub e o Registry central, as bases autorizadas e os serviços Core necessários.
- O proxy HTTPS existente encaminha para `mcp:3102` pela rede `ai-shared`.
- Se o repositório de imagens for privado, configure no host credencial Docker Hub com permissão somente de leitura.
- Antes de ativar a primeira release `0.2.0`, o AgentRuntime deve enviar `CompanyUUID` no metadata técnico de cada chamada MCP.

## Primeira instalação

Clone o repositório no diretório escolhido para manter o serviço e crie a configuração local:

```sh
git clone https://github.com/costaapps/ca_mcp.git
cd ca_mcp
cp .env.example .env
chmod 600 .env
```

Edite `.env` no host e defina a tag publicada e os valores reais do Runtime. Não versione nem compartilhe esse arquivo.

```dotenv
MCP_IMAGE=eduardomatuellacostaapps/ca:mcp-0.2.0
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

`MCP_TENANT_ALLOWLIST` é obrigatória em produção e limita as empresas atendidas por esta instalação; ela não autentica a origem das chamadas. `CENTRAL_DB_PORT` pode ser omitida para usar `3306`. As credenciais das bases das empresas e endereços Core são resolvidos pelo Registry e pelas configurações do Core.

Suba e confira o serviço:

```sh
docker network inspect ai-shared >/dev/null 2>&1 || docker network create ai-shared
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:3102/health/ready
```

Valide também o endereço público pelo proxy HTTPS e uma chamada MCP do AgentRuntime. A porta publicada no host permanece restrita ao loopback da VPS.

## Encaminhamento pelo Nginx

O endpoint MCP é `/mcp`. Se o Nginx roda em container, conecte esse container à rede Docker externa `ai-shared` e inclua o bloco abaixo dentro do `server {}` HTTPS do domínio usado pelo AgentRuntime:

```nginx
location = /mcp {
    proxy_pass http://mcp:3102/mcp;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

O nome `mcp` é o serviço definido em `compose.yaml`; o Nginx o resolve pela rede compartilhada. Depois de iniciar o Compose, valide a configuração e recarregue o Nginx. Em um Nginx instalado diretamente na VPS, use o upstream `http://127.0.0.1:3102/mcp` no `proxy_pass`; a porta do Compose está vinculada somente ao loopback do host. Não exponha a porta `3102` publicamente. Mantenha TLS no `server {}` HTTPS do Nginx e configure o AgentRuntime para usar `https://<domínio>/mcp`.

Para Nginx instalado no host, valide e recarregue com:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Se o Nginx também for um container, rode `nginx -t` e recarregue o container pelo mecanismo usado nessa instalação. Por fim, confirme o endpoint local do serviço com `curl -fsS http://127.0.0.1:3102/health/ready` e faça uma chamada MCP pelo domínio HTTPS.

## Publicação de releases

Pull requests e pushes para `develop` ou `main` executam typecheck, lint, testes padrão, build, integração SQL em MariaDB 11.8.6 e smoke test da imagem. Eles não publicam imagens.

Antes da primeira release, configure estes secrets do repositório no GitHub:

- `DOCKERHUB_USERNAME`: usuário de login do Docker Hub (`eduardomatuellacostaapps`);
- `DOCKERHUB_IMAGE`: nome completo do repositório de imagem (`eduardomatuellacostaapps/ca`);
- `DOCKERHUB_TOKEN`: token com permissão de escrita nesse repositório.

Publicar uma GitHub Release associada à tag `vX.Y.Z` inicia o workflow de release. A publicação no Docker Hub só acontece depois que o commit pertence à `main`, a tag coincide com `package.json` e a imagem passou por todos os gates. O mesmo artefato testado recebe as tags:

- `eduardomatuellacostaapps/ca:mcp-<run_number>`, para rastreabilidade do workflow;
- `eduardomatuellacostaapps/ca:mcp-<versão>`, para seleção operacional, por exemplo `mcp-0.2.0`.

As referências são montadas usando o secret `DOCKERHUB_IMAGE`; o login usa `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN`. O build e smoke da imagem usam uma tag local e não precisam de secrets Docker Hub. As duas tags devem apontar para o mesmo digest. O publicador verifica labels, plataforma e digest; se uma tag já existir com outra imagem, a publicação falha sem tentar substituí-la. Reexecuções reutilizam tags correspondentes e podem completar uma publicação parcial. O workflow não publica nem depende de `latest` e não executa SSH ou deploy remoto.

Para uma proteção no próprio registry contra alterações feitas por outros escritores, habilite tags imutáveis no Docker Hub para o padrão `^mcp-[0-9]+\.[0-9]+\.[0-9]+$`, se esse recurso estiver disponível na conta. Consulte [Immutable tags on Docker Hub](https://docs.docker.com/docker-hub/repos/manage/hub-images/immutable-tags/). O token `DOCKERHUB_TOKEN` do GitHub Actions precisa somente de permissão de escrita no repositório de imagens e é usado pelo job de publicação.

## Atualização

Depois de uma release validada e publicada, atualize o clone e selecione a tag de versão no `.env`:

```sh
git pull --ff-only
${EDITOR:-nano} .env
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:3102/health/ready
```

Confira `.env.example` após o `git pull` e acrescente manualmente ao `.env` quaisquer configurações novas, preservando os valores secretos existentes. O Compose não executa migrations de banco; mudanças de schema devem ser tratadas em procedimento separado.

## Rollback

Edite `.env` e restaure em `MCP_IMAGE` a tag da versão anterior. Em seguida:

```sh
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:3102/health/ready
```

O rollback troca a imagem do serviço. Ele não reverte alterações de dados ou schema nos bancos.

## Diagnóstico

```sh
docker compose ps
docker compose logs --tail=100 mcp
curl -i http://127.0.0.1:3102/health/ready
```

`/health/ready` depende da inicialização e da disponibilidade do Registry. Uma falha em uma base de empresa não deve derrubar a readiness global. Confirme conectividade, allowlist e configuração do Registry antes de encaminhar tráfego.

Para validar localmente os contratos de publicação e Compose, execute `bash ops/ci/test-release-publish.sh` e `bash ops/ci/test-compose-config.sh`. O workflow também executa ambos sem secrets de publicação.
