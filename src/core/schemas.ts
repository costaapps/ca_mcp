import { z } from 'zod';

import type { JsonValue } from './contracts.js';

const nonEmptyStringSchema = z.string().min(1);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema)
]));

const coreFlowErrorSchema = z.object({
  Code: nonEmptyStringSchema,
  Message: nonEmptyStringSchema
}).passthrough();

const coreFlowSuccessSchema = z.object({
  Success: z.literal(true),
  ExecutionUUID: nonEmptyStringSchema,
  Data: z.unknown()
}).passthrough();

const coreFlowFailureSchema = z.object({
  Success: z.literal(false),
  ExecutionUUID: nonEmptyStringSchema,
  Data: z.null(),
  Error: coreFlowErrorSchema
}).passthrough();

export const coreFlowResponseSchema = z.union([
  coreFlowSuccessSchema,
  coreFlowFailureSchema
]);

export const coreListFlowActionsDataSchema = z.object({
  Actions: z.array(z.object({
    Action: nonEmptyStringSchema,
    Description: z.string()
  }).passthrough())
}).passthrough();

export const coreDescribeFlowActionDataSchema = z.object({
  Action: nonEmptyStringSchema,
  Description: z.string(),
  Repeatable: z.boolean(),
  Effect: z.enum(['READ', 'WRITE', 'EXTERNAL_READ', 'EXTERNAL_WRITE', 'OUTPUT', 'CONTROL']),
  Available: z.boolean(),
  ExecutionCount: z.number().int().nonnegative(),
  UnavailableReason: z.string().nullable(),
  RequiredInputs: z.array(z.string())
}).passthrough();

export const coreExecuteFlowActionDataSchema = z.object({
  Action: nonEmptyStringSchema,
  Status: z.enum(['COMPLETED', 'NEEDS_INPUT', 'FAILED']),
  MissingInformation: z.array(nonEmptyStringSchema),
  Output: jsonValueSchema,
  Invocation: z.object({
    InvocationUUID: nonEmptyStringSchema,
    IdFlow: z.number().int(),
    IdProcessLineFlow: z.number().int()
  }).passthrough()
}).passthrough();

const coreNavigationErrorSchema = z.object({
  Code: nonEmptyStringSchema,
  Message: nonEmptyStringSchema
}).passthrough();

const coreNavigationSuccessSchema = z.object({
  Success: z.literal(true),
  ExecutionUUID: nonEmptyStringSchema,
  Data: z.unknown()
}).passthrough();

const coreNavigationFailureSchema = z.object({
  Success: z.literal(false),
  ExecutionUUID: nonEmptyStringSchema,
  Data: z.null(),
  Error: coreNavigationErrorSchema
}).passthrough();

export const coreNavigationResponseSchema = z.union([
  coreNavigationSuccessSchema,
  coreNavigationFailureSchema
]);

export const navigationDestinationSchema = z.object({
  DestinationRef: nonEmptyStringSchema,
  Kind: z.enum(['MENU', 'HOME']),
  Description: z.string(),
  MenuGroup: z.string().nullable(),
  Keywords: z.string().nullable(),
  AIReference: z.string().nullable().optional()
}).strict();

export const coreListNavigationDestinationsDataSchema = z.object({
  Destinations: z.array(navigationDestinationSchema)
}).strict();

export const coreRequestHandoffDataSchema = z.object({
  Accepted: z.literal(true),
  Destination: nonEmptyStringSchema,
  Status: z.literal('REQUESTED'),
  HandoffUUID: nonEmptyStringSchema
}).strict();
