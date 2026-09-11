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

## Flow tools

`list_flow_actions` recebe `{}` e lista as capabilities disponíveis no AIDocument.

`describe_flow_action` recebe apenas `{ "Action": "..." }` e retorna descrição, disponibilidade, repetição e `RequiredInputs`.

`execute_flow_action` recebe `{ "Action": "...", "Input": {} }`. O MCP cria um novo `RequestUUID` para cada intenção, chama o Core sem retry automático e preserva o `Output` sem transformação.

As três tools usam `CORE_API_URL` e `CORE_API_TIMEOUT_MS` para acessar os endpoints internos `/v1/ai-document/flow-actions/*`. Não consultam `Flow`/`ProcessLineFlow` no banco, não interpretam `ObjectType`, não resolvem `$CA_Input`, não aplicam `Repeatable` e não mantêm cache ou estado conversacional.

Em uma execução bem-sucedida, `InvocationUUID`, `IdFlow` e `IdProcessLineFlow` ficam somente em `_meta.ca.FlowInvocation`. Em uma falha de execução, o MCP retorna `isError=true` e o envelope funcional com `Success`, `Action`, `Output` e `Error`.

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
