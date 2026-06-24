import { Schema } from "effect"

/**
 * A single extracted fact about the user, their preferences, project context,
 * coding style, or corrections.
 */
export const MemoryFact = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  category: Schema.Literals(["preference", "knowledge", "context", "behavior", "goal", "correction"] as const),
  confidence: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.optional(Schema.Number),
  source: Schema.String,
})
export type MemoryFactType = Schema.Schema.Type<typeof MemoryFact>

/**
 * Summary sections for high-level user and history context.
 */
export const MemorySummaries = Schema.Struct({
  workContext: Schema.optional(Schema.String),
  personalContext: Schema.optional(Schema.String),
  topOfMind: Schema.optional(Schema.String),
  recentActivity: Schema.optional(Schema.String),
  longTermBackground: Schema.optional(Schema.String),
})
export type MemorySummariesType = Schema.Schema.Type<typeof MemorySummaries>

/**
 * Full memory state persisted to disk per project.
 */
export const MemoryState = Schema.Struct({
  facts: Schema.Array(MemoryFact),
  summaries: MemorySummaries,
  version: Schema.Number,
})
export type MemoryStateType = Schema.Schema.Type<typeof MemoryState>

export const emptyMemoryState = (): MemoryStateType => ({
  facts: [],
  summaries: {},
  version: 2,
})

/**
 * Structured output from the memory extraction LLM call.
 */
export const ExtractionResult = Schema.Struct({
  facts: Schema.Array(
    Schema.Struct({
      content: Schema.String,
      category: Schema.Literals(["preference", "knowledge", "context", "behavior", "goal", "correction"] as const),
      confidence: Schema.Number,
    }),
  ),
  summary: Schema.optional(Schema.String),
})
export type ExtractionResultType = Schema.Schema.Type<typeof ExtractionResult>

export * as MemoryTypes from "./types"
