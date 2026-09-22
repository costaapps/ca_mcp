# Costa Apps MCP Server

MCP Server da PoC AIDocument da Costa Apps. O serviço mantém as seis tools de consulta existentes sobre o banco Msg4 de homologação e expõe três Flow tools stateless que funcionam como adapter da API interna do Core:

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
- MySQL/MariaDB acessível pela aplicação

## Configuração e execução

```powershell
Copy-Item .env.example .env
npm install
npm run build
npm start
```

O processo escuta em `PORT` (padrão `3102`). Os endpoints são `GET /health` e `/mcp` via Streamable HTTP.

Não há migrations neste repositório: `Message` e `ProcessLineFlow` são tabelas existentes do Core.

## Metadata MCP

As tools não recebem IDs técnicos em `arguments`. O Agent Runtime envia somente o contexto necessário em `_meta.ca`:

```json
{
  "ca": {
    "Execution": {
      "IdChat": 123,
      "IdProcessLine": 456
    }
  }
}
```

`get_chat_history` exige `Execution.IdChat`. `get_process_line_flow_state` exige `Execution.IdProcessLine`.

As Flow tools exigem, exclusivamente em `_meta.ca.Execution`, `ExecutionUUID`, `IdCompany` e `IdProcessLine`. `TurnUUID` é opcional e serve para correlação. IDs técnicos não fazem parte dos argumentos funcionais.

As Navigation tools exigem, exclusivamente em `_meta.ca.Execution`, `ExecutionUUID`, `TurnUUID`, `IdCompany` e `IdProcessLine`. `list_navigation_destinations` recebe `{}`. `request_handoff` recebe apenas `DestinationRef`, `Reason` e `Summary`; `DestinationRef` é opaco e não pode ser substituído por IDs técnicos.

## Flow tools

`list_flow_actions` recebe `{}` e lista as capabilities disponíveis no AIDocument.

`describe_flow_action` recebe apenas `{ "Action": "..." }` e retorna descrição, disponibilidade, repetição e `RequiredInputs`.

`execute_flow_action` recebe `{ "Action": "...", "Input": {} }`. O MCP cria um novo `RequestUUID` para cada intenção, chama o Core sem retry automático e preserva o `Output` sem transformação.

As três tools usam `CORE_API_URL` e `CORE_API_TIMEOUT_MS` para acessar os endpoints internos `/v1/ai-document/flow-actions/*`. Não consultam `Flow`/`ProcessLineFlow` no banco, não interpretam `ObjectType`, não resolvem `$CA_Input`, não aplicam `Repeatable` e não mantêm cache ou estado conversacional.

Em uma execução bem-sucedida, `InvocationUUID`, `IdFlow` e `IdProcessLineFlow` ficam somente em `_meta.ca.FlowInvocation`. Em uma falha de execução, o MCP retorna `isError=true` e o envelope funcional com `Success`, `Action`, `Output` e `Error`.

## Navigation / Handoff

`list_navigation_destinations` chama o endpoint interno de destinos do Core e retorna somente `DestinationRef`, `Kind` (`MENU` ou `HOME`), descrição, grupo e palavras-chave. A tool não consulta `CompanyMenu` nem expõe `IdCompanyMenu`, `IdCompanyModule`, `IdModule` ou `Module.Object`.

`request_handoff` gera um `RequestUUID` novo no MCP e encaminha a solicitação ao Core. O MCP não escolhe, valida semanticamente ou aplica o destino; o Core é responsável por autorizar e persistir o Handoff. Um eventual `HandoffUUID` é usado apenas em observabilidade e não é exibido ao Agent.

## Integração real opcional

A suíte padrão não depende de um Core disponível. Para executar a validação real dos dois endpoints de Navigation, habilite explicitamente o teste com `CORE_NAVIGATION_INTEGRATION=1` e forneça `CORE_API_URL`, `CORE_NAVIGATION_EXECUTION_UUID`, `CORE_NAVIGATION_TURN_UUID`, `CORE_NAVIGATION_ID_COMPANY` e `CORE_NAVIGATION_ID_PROCESS_LINE`. O teste usa um `DestinationRef` retornado pela listagem do Core; `CORE_NAVIGATION_DESTINATION_REF` é opcional para selecionar um destino específico dessa lista. `CORE_NAVIGATION_TIMEOUT_MS`, `CORE_NAVIGATION_REASON` e `CORE_NAVIGATION_SUMMARY` também são opcionais. O teste usa uma nova `RequestUUID` e pode criar uma solicitação de handoff no Core configurado; por isso, deve ser executado somente contra um contexto de homologação autorizado.

As duas tools usam os endpoints `/v1/agent-platform/navigation/destinations/list` e `/v1/agent-platform/navigation/handoffs/request`, sem retry automático. Em runtime, elas reutilizam `CORE_API_URL` e `CORE_API_TIMEOUT_MS`; as variáveis `CORE_NAVIGATION_*` acima são exclusivas do teste opt-in.

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

Os testes usam repositories falsos por padrão e não exigem banco de homologação. O teste MCP sobe um HTTP local e usa `StreamableHTTPClientTransport` do SDK v2.
