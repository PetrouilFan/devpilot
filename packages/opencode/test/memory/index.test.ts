import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@devpilot-ai/core/fs-util"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@devpilot-ai/core/cross-spawn-spawner"
import { Memory } from "@/memory"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const it = testEffect(Layer.mergeAll(
  Memory.defaultLayer,
  FSUtil.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  TestConfig.layer({
    get: () => Effect.succeed({
      memory: { enabled: true, injection_enabled: true, fact_confidence_threshold: 0.3 },
    }),
  }),
  NodeFileSystem.layer,
))

it.instance("extracts and persists facts from conversation turns", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.processTurn({
      userMessage: "I use Rust for backend work",
      assistantMessage: "Good choice, Rust is great",
      toolCalls: [],
      sessionID: "test-session",
    })
    const context = yield* memory.getContext()
    expect(context).toBeDefined()
    expect(context).toBeString()
    expect(context).toContain("<fact")
    expect(context).toContain("Rust")
  }),
)

it.instance("getContext returns undefined when no facts exist", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const context = yield* memory.getContext()
    expect(context).toBeUndefined()
  }),
)

it.instance("clear wipes all state", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.processTurn({
      userMessage: "I use Python for scripting",
      assistantMessage: "Good choice",
      toolCalls: [],
      sessionID: "test-session",
    })
    const before = yield* memory.getContext()
    expect(before).toBeDefined()
    expect(before).toBeString()
    expect(before).toContain("<fact")
    expect(before).toContain("Python")
    yield* memory.clear()
    const after = yield* memory.getContext()
    expect(after).toBeUndefined()
  }),
)

it.instance("processTurn ignores empty messages", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.processTurn({
      userMessage: "",
      assistantMessage: "",
      toolCalls: [],
      sessionID: "test-session",
    })
    const ctx = yield* memory.getContext()
    expect(ctx).toBeUndefined()
  }),
)
