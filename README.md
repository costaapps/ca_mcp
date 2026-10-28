# Costa Apps MCP Server

MCP Server da plataforma AIDocument da Costa Apps. O serviço roteia consultas e ferramentas operacionais para a base da empresa resolvida no Registry central; as Flow e Navigation tools funcionam como adapters stateless da API interna do Core:

- `get_chat_history`
- `get_process_line_flow_state`
- `get_products`
- `get_pricelists`
- `get_products_pricelists`
- `resolve_product`
- `list_flow_actions`
- `describe_flow_action`
- `execute_flow_action`
- `list_navigation_destinations`
- `request_handoff`

## Requisitos

- Node.js 22+
- Registry central acessível com credencial de leitura
- Bases MariaDB/MySQL das empresas acessíveis pelo MCP
- `MCP_TENANT_ALLOWLIST` com os UUIDs atendidos pela instalação; obrigatória em produção

## Configuração e execução

```powershell
Copy-Item .env.example .env
npm ci
npm run build
npm start
```

Preencha no `.env` a conexão central e a allowlist. O processo valida o Registry central antes de abrir a API; se a conexão, o schema necessário ou a permissão de leitura falhar, o MCP encerra com erro sem começar a escutar. Depois de subir, escuta em `PORT` (padrão `3102`) e expõe `/mcp` via Streamable HTTP, `/health` e `/health/live` como liveness e `/health/ready` para readiness contínua do Registry e do estado de drenagem.

Não há migrations produtivas neste repositório: `Message`, `ProcessLineFlow` e as tabelas de negócio são existentes nas bases do Core. O Registry central é somente leitura.

## Metadata MCP

As tools não recebem IDs técnicos em `arguments`. Em cada `tools/call`, o Agent Runtime envia a empresa em `_meta.ca.Execution.CompanyUUID`; os demais campos técnicos continuam conforme o contrato de cada tool:

```json
{
  "_meta": {
    "ca": {
      "Execution": {
        "CompanyUUID": "550e8400-e29b-41d4-a716-446655440000",
        "IdChat": 123,
        "IdProcessLine": 456
      }
    }
  }
}
```

`CompanyUUID` é obrigatório em todas as onze tools e não é necessário para `initialize` nem `tools/list`. `get_chat_history` exige `Execution.IdChat`. `get_process_line_flow_state` exige `Execution.IdProcessLine`. O MCP resolve a conexão pelo Registry; `IdDatabase` recebido, quando presente, serve apenas para conferência. Veja [docs/multitenancy.md](docs/multitenancy.md) para o fluxo de resolução, isolamento, configuração e limites operacionais.

As Flow tools exigem, exclusivamente em `_meta.ca.Execution`, `ExecutionUUID`, `IdCompany` e `IdProcessLine`. `TurnUUID` é opcional e serve para correlação. IDs técnicos não fazem parte dos argumentos funcionais.

As Navigation tools exigem, exclusivamente em `_meta.ca.Execution`, `ExecutionUUID`, `TurnUUID`, `IdCompany` e `IdProcessLine`. `list_navigation_destinations` recebe `{}`. `request_handoff` recebe apenas `DestinationRef`, `Reason` e `Summary`; `DestinationRef` é opaco e não pode ser substituído por IDs técnicos.

## Flow tools

`list_flow_actions` recebe `{}` e lista somente `Action` e `Description` das capabilities disponíveis no AIDocument. Configuração técnica retornada pelo Core não é exposta ao Agent.

`describe_flow_action` recebe apenas `{ "Action": "..." }` e retorna descrição, disponibilidade, repetição, `Effect` (`READ`, `WRITE`, `EXTERNAL_READ`, `EXTERNAL_WRITE`, `OUTPUT` ou `CONTROL`) e `RequiredInputs`. Também propaga `ObjectDescription` quando fornecido pelo Core: texto sem transformação ou `null`. O campo é opcional para manter capabilities e respostas anteriores sem essa orientação válidas; sua ausência é preservada. O MCP não interpreta essa orientação semântica, não a converte em `RequiredInputs` ou schema de entrada e não implementa a resolução de PROMPT.

`execute_flow_action` recebe `{ "Action": "...", "Input": {} }`. O MCP cria um novo `RequestUUID` para cada intenção, chama o Core sem retry automático e preserva o `Output` sem transformação. A resposta funcional de sucesso inclui `Success=true`, `Action`, `Status` (`COMPLETED` ou `NEEDS_INPUT`), `MissingInformation` e `Output`. `Status=NEEDS_INPUT` é uma conclusão válida da invocation e não gera `isError`; uma nova intenção do Agent pode gerar uma nova invocation. Falhas usam exclusivamente o envelope `Success=false`, `Action`, `Output=null` e `Error` com `Code` e `Message`, junto de `isError=true`.

As três tools resolvem `MSG4COREAPI` nas `GeneralSettings` da empresa e usam `CORE_API_TIMEOUT_MS` para acessar os endpoints internos `/v1/ai-document/flow-actions/*`. Não consultam `Flow`/`ProcessLineFlow` no banco, não interpretam `ObjectType`, não resolvem `$CA_Input`, não aplicam `Repeatable` e não mantêm cache ou estado conversacional.

Em uma execução bem-sucedida, `InvocationUUID`, `IdFlow` e `IdProcessLineFlow` ficam somente em `_meta.ca.FlowInvocation`. Em uma falha de execução, o MCP retorna `isError=true` e o envelope funcional com `Success`, `Action`, `Output` e `Error`.

O teste `tests/integration/agenticFlowBridge.test.ts` usa transporte MCP HTTP real e um Core HTTP simulado para exercitar `list → describe → execute` com AUTO, PROMPT, CFL e `NEEDS_INPUT → COMPLETED`. Ele comprova o contrato da ponte deste repositório sem depender de Core ou Agent Runtime externos. O E2E inter-repositórios com Core e Runtime reais depende dos respectivos trabalhos e não é substituído por esse teste local.

## Navigation / Handoff

`list_navigation_destinations` chama o endpoint interno de destinos do Core e retorna `DestinationRef`, `Kind` (`MENU` ou `HOME`), descrição, grupo, palavras-chave e `AIReference` quando fornecido pelo Core. `AIReference` é dado descritivo opcional (também pode ser `null`): o MCP apenas valida e transporta seu texto, sem interpretá-lo ou registrá-lo em logs. A tool não consulta `CompanyMenu` nem expõe `IdCompanyMenu`, `IdCompanyModule`, `IdModule` ou `Module.Object`.

`request_handoff` gera um `RequestUUID` novo no MCP e encaminha a solicitação ao Core. O MCP não escolhe, valida semanticamente ou aplica o destino; o Core é responsável por autorizar e persistir o Handoff. Um eventual `HandoffUUID` é usado apenas em observabilidade e não é exibido ao Agent.

## Integração real opcional

A suíte padrão não depende de um Core disponível. Para executar a validação real dos dois endpoints de Navigation, habilite explicitamente o teste com `CORE_NAVIGATION_INTEGRATION=1` e forneça `CORE_API_URL`, `CORE_NAVIGATION_EXECUTION_UUID`, `CORE_NAVIGATION_TURN_UUID`, `CORE_NAVIGATION_ID_COMPANY` e `CORE_NAVIGATION_ID_PROCESS_LINE`. O teste usa um `DestinationRef` retornado pela listagem do Core; `CORE_NAVIGATION_DESTINATION_REF` é opcional para selecionar um destino específico dessa lista. `CORE_NAVIGATION_TIMEOUT_MS`, `CORE_NAVIGATION_REASON` e `CORE_NAVIGATION_SUMMARY` também são opcionais. O teste usa uma nova `RequestUUID` e pode criar uma solicitação de handoff no Core configurado; por isso, deve ser executado somente contra um contexto de homologação autorizado.

As duas tools usam os endpoints `/v1/agent-platform/navigation/destinations/list` e `/v1/agent-platform/navigation/handoffs/request`, sem retry automático. Em runtime, o endereço é resolvido das `GeneralSettings` da empresa e `CORE_API_TIMEOUT_MS` define o limite da chamada. As variáveis `CORE_NAVIGATION_*`, inclusive o endereço de teste, são exclusivas do teste opt-in.

## Structured content

Histórico:

```json
{
  "Messages": [
    { "Sender": "System", "Text": "Como posso ajudar?" },
    { "Sender": "Customer", "Text": "Quero comprar um carro." }
  ]
}
```

Estado do fluxo:

```json
{
  "Steps": [
    {
      "IdProcessLineFlow": 1001,
      "IdFlow": 11111,
      "IdProcessLine": 456,
      "IdChat": 123,
      "IdCompanyModule": 9,
      "DataType": "string",
      "Level": 1,
      "LevelOrder": 1,
      "FatherIdFlow": null,
      "Description": "Pergunta inicial",
      "ObjectDescription": "Pergunta",
      "ObjectType": "PROMPT",
      "Param": "Response",
      "HasResponse": true,
      "Value": "Quero comprar um carro.",
      "IdMessage": 70,
      "ResponseIdMessage": 71
    }
  ]
}
```

`Value` é convertido para objeto/array quando contém JSON válido; texto comum permanece string. Campos extensos de query, request, headers e opções não fazem parte da resposta inicial.

## Desenvolvimento

```powershell
npm test
npm run typecheck
npm run build
npm run lint
```

Os testes padrão usam providers/repositories falsos e não exigem banco de homologação. O teste MCP sobe um HTTP local e usa `StreamableHTTPClientTransport` do SDK v2. A integração SQL real é opt-in via `npm run test:database` e MariaDB 11.8.6; requer `MCP_TEST_DB_HOST`, `MCP_TEST_DB_PORT`, `MCP_TEST_DB_USER`, `MCP_TEST_DB_PASSWORD` e a confirmação explícita `MCP_TEST_DB_ALLOW_CREATE_DROP=YES`. O runner aceita somente MariaDB local ou alias `mariadb`, cria schemas aleatórios, faz cleanup em `finally` e remove somente aqueles que criou.
