export * as ConfigSubagents from "./subagents"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Subagents")({
  model: Schema.String.pipe(Schema.optional).annotate({
    description: "Default model for all subagents (e.g. 'anthropic/claude-haiku-3.5')",
  }),
  max_concurrency: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of subagents that can run concurrently",
  }),
  isolation: Schema.Literals(["worktree", "scope", "none"]).pipe(Schema.optional).annotate({
    description: "Filesystem isolation mode for write-capable subagents",
  }),
  timeout_ms: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum time in milliseconds a subagent can run before timeout",
  }),
  orchestrator: Schema.String.pipe(Schema.optional).annotate({
    description: "Name of the agent to use as orchestrator for complex task decomposition",
  }),
  orchestrator_trigger: Schema.Literals(["auto", "manual"]).pipe(Schema.optional).annotate({
    description: "How the orchestrator is invoked: 'auto' for automatic detection, 'manual' for explicit invocation",
  }),
}) {}
