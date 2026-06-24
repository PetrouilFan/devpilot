export * as ConfigMemory from "./memory"

import { Schema } from "effect"
import { PositiveInt, NonNegativeInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Memory")({
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable persistent cross-session memory (default: true)",
  }),
  debounce_seconds: PositiveInt.pipe(Schema.optional).annotate({
    description: "Debounce window in seconds before processing memory updates (default: 30)",
  }),
  max_facts: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of facts to store per project (default: 100)",
  }),
  fact_confidence_threshold: Schema.Number.pipe(Schema.optional).annotate({
    description: "Minimum confidence (0.0-1.0) to store a fact (default: 0.7)",
  }),
  injection_enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Whether to inject memory context into the system prompt (default: true)",
  }),
  max_injection_tokens: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum tokens for memory injection in system prompt (default: 2000)",
  }),
  max_injection_facts: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of facts to inject (default: 15)",
  }),
  guaranteed_categories: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Fact categories that bypass the token budget (default: [correction])",
  }),
}) {}
