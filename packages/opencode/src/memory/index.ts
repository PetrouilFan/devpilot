import { LayerNode } from "@devpilot-ai/core/effect/layer-node"
import { NodePath } from "@effect/platform-node"
import { Context, Duration, Effect, Layer } from "effect"
import { FSUtil } from "@devpilot-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import type { MemoryStateType } from "./types"
import { emptyMemoryState } from "./types"
import * as Store from "./store"
import * as Extractor from "./extractor"
import { Config } from "@/config/config"

// Default config values
const DEFAULT_MAX_FACTS = 100
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7
const DEFAULT_MAX_INJECTION_FACTS = 15
const DEFAULT_GUARANTEED_CATEGORIES = ["correction"]

export interface Interface {
  /**
   * Process a conversation turn for memory extraction.
   * Called after each assistant response.
   */
  readonly processTurn: (input: {
    userMessage: string
    assistantMessage: string
    toolCalls: string[]
    sessionID: string
  }) => Effect.Effect<void>

  /**
   * Get formatted memory context for injection into the system prompt.
   * Returns an XML string or undefined if no memory is available.
   */
  readonly getContext: () => Effect.Effect<string | undefined>

  /**
   * Clear all stored memory for the current project.
   */
  readonly clear: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@devpilot/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const config = yield* Config.Service

    // Per-project memory state loaded lazily
    const state = yield* InstanceState.make(
      Effect.fn("Memory.state")(function* (ctx) {
        return yield* Store.load(fs, ctx.directory)
      }),
    )

    const processTurn = Effect.fn("Memory.processTurn")(function* (input: {
      userMessage: string
      assistantMessage: string
      toolCalls: string[]
      sessionID: string
    }) {
      const cfg = yield* config.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (cfg?.memory?.enabled === false) return
      if (!input.userMessage || !input.assistantMessage) return

      const confidenceThreshold = cfg?.memory?.fact_confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD
      const maxFacts = cfg?.memory?.max_facts ?? DEFAULT_MAX_FACTS

      // Extract facts via pattern matching (no LLM call)
      const result = Extractor.extract(
        input.userMessage,
        input.assistantMessage,
        input.toolCalls,
      )

      if (!result.facts || result.facts.length === 0) return

      // Update state with new facts
      const current = yield* InstanceState.get(state)
      let updated = current
      for (const fact of result.facts) {
        if (fact.confidence < confidenceThreshold) continue
        updated = Store.addFact(updated, fact, input.sessionID, maxFacts)
      }

      // Persist
      if (updated !== current) {
        const ctx = yield* InstanceState.context
        yield* Store.save(fs, ctx.directory, updated)
      }
    })

    const getContext = Effect.fn("Memory.getContext")(function* () {
      const cfg = yield* config.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (cfg?.memory?.injection_enabled === false) return
      if (cfg?.memory?.enabled === false) return

      const current = yield* InstanceState.get(state)
      if (current.facts.length === 0) return

      const maxFacts = cfg?.memory?.max_injection_facts ?? DEFAULT_MAX_INJECTION_FACTS
      const guaranteed = cfg?.memory?.guaranteed_categories ?? DEFAULT_GUARANTEED_CATEGORIES

      // Separate guaranteed facts from regular ones
      const guaranteedFacts = current.facts.filter((f) => guaranteed.includes(f.category))
      const regularFacts = current.facts.filter((f) => !guaranteed.includes(f.category))

      // Sort regular by confidence and take top N
      const topRegular = regularFacts
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxFacts)

      const allFacts = [...guaranteedFacts, ...topRegular]

      if (allFacts.length === 0) return ""

      // Build XML
      const categories = [...new Set(allFacts.map((f) => f.category))]
      const parts: string[] = ["<memory>"]

      for (const cat of categories) {
        const catFacts = allFacts.filter((f) => f.category === cat)
        parts.push(`  <${cat}>`)
        for (const fact of catFacts) {
          parts.push(`    <fact confidence="${fact.confidence.toFixed(2)}">${fact.content}</fact>`)
        }
        parts.push(`  </${cat}>`)
      }

      // Add summaries
      if (current.summaries.workContext) {
        parts.push(`  <work_context>${current.summaries.workContext}</work_context>`)
      }
      if (current.summaries.personalContext) {
        parts.push(`  <personal_context>${current.summaries.personalContext}</personal_context>`)
      }

      parts.push("</memory>")

      return parts.join("\n")
    })

    const clear = Effect.fn("Memory.clear")(function* () {
      const ctx = yield* InstanceState.context
      yield* Store.save(fs, ctx.directory, emptyMemoryState())
    })

    return Service.of({ processTurn, getContext, clear })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, FSUtil.node])

export * as Memory from "."
