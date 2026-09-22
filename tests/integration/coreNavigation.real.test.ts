import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CoreNavigationClient } from '../../src/core/CoreNavigationClient.js';

const integrationEnabled = process.env.CORE_NAVIGATION_INTEGRATION === '1';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatório quando CORE_NAVIGATION_INTEGRATION=1.`);
  return value;
}

function requiredPositiveInteger(name: string): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} deve ser um inteiro positivo.`);
  }
  return value;
}

describe.skipIf(!integrationEnabled)('Core Navigation — integração opt-in', () => {
  it('valida os endpoints reais de listagem e solicitação de handoff', async () => {
    const client = new CoreNavigationClient({
      baseUrl: requiredEnvironment('CORE_API_URL'),
      timeoutMs: Number(process.env.CORE_NAVIGATION_TIMEOUT_MS ?? 30000)
    });
    const context = {
      ExecutionUUID: requiredEnvironment('CORE_NAVIGATION_EXECUTION_UUID'),
      IdCompany: requiredPositiveInteger('CORE_NAVIGATION_ID_COMPANY'),
      IdProcessLine: requiredPositiveInteger('CORE_NAVIGATION_ID_PROCESS_LINE')
    };

    // The turn is required by the trusted MCP context, but is intentionally not
    // sent by CoreNavigationClient because it is not part of the Core contract.
    requiredEnvironment('CORE_NAVIGATION_TURN_UUID');

    const listResponse = await client.listNavigationDestinations(context);
    expect(listResponse.Success).toBe(true);
    if (!listResponse.Success) return;

    expect(listResponse.Data).toEqual({
      Destinations: expect.any(Array)
    });
    const destinationRef = requiredEnvironment('CORE_NAVIGATION_DESTINATION_REF');
    expect(listResponse.Data.Destinations.some(
      (destination) => destination.DestinationRef === destinationRef
    )).toBe(true);

    const handoffResponse = await client.requestHandoff({
      ...context,
      RequestUUID: randomUUID(),
      DestinationRef: destinationRef,
      Reason: process.env.CORE_NAVIGATION_REASON?.trim() || 'Teste de integração MCP/Core.',
      Summary: process.env.CORE_NAVIGATION_SUMMARY?.trim() || 'Validação opt-in do contrato de Navigation.'
    });

    expect(handoffResponse).toMatchObject({
      Success: true,
      ExecutionUUID: context.ExecutionUUID,
      Data: {
        Accepted: expect.any(Boolean),
        Destination: expect.any(String),
        Status: 'REQUESTED',
        HandoffUUID: expect.any(String)
      }
    });
  });
});
