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
  Available: z.boolean(),
  ExecutionCount: z.number().int().nonnegative(),
  UnavailableReason: z.string().nullable(),
  RequiredInputs: z.array(z.string())
}).passthrough();

export const coreExecuteFlowActionDataSchema = z.object({
  Action: nonEmptyStringSchema,
  Output: jsonValueSchema,
  Invocation: z.object({
    InvocationUUID: nonEmptyStringSchema,
    IdFlow: z.number().int(),
    IdProcessLineFlow: z.number().int()
  }).passthrough()
}).passthrough();
