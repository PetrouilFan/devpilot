import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@devpilot-ai/core/fs-util"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@devpilot-ai/core/cross-spawn-spawner"
import { MemoryStore } from "@/memory/store"
import { emptyMemoryState } from "@/memory/types"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(
  FSUtil.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  NodeFileSystem.layer,
))

it.live("save then load returns same state", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const state = emptyMemoryState()
    yield* MemoryStore.save(fs, dir, state)
    const loaded = yield* MemoryStore.load(fs, dir)
    expect(loaded.facts).toHaveLength(0)
    expect(loaded.version).toBe(2)
  }),
)

it.live("load from non-existent dir returns empty state", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const loaded = yield* MemoryStore.load(fs, dir + "/nonexistent")
    expect(loaded.facts).toHaveLength(0)
  }),
)

it.live("load from corrupt JSON returns empty state", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    yield* fs.ensureDir(dir + "/.opencode")
    yield* fs.writeFileString(dir + "/.opencode/memory.json", "not json")
    const loaded = yield* MemoryStore.load(fs, dir)
    expect(loaded.facts).toHaveLength(0)
  }),
)

it.live("load from invalid structure returns empty state", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    yield* fs.ensureDir(dir + "/.opencode")
    yield* fs.writeFileString(dir + "/.opencode/memory.json", JSON.stringify({ not: "memory" }))
    const loaded = yield* MemoryStore.load(fs, dir)
    expect(loaded.facts).toHaveLength(0)
  }),
)

it.live("addFact deduplicates by content", () =>
  Effect.gen(function* () {
    let state = emptyMemoryState()
    state = MemoryStore.addFact(state, { content: "I prefer TypeScript", category: "preference", confidence: 0.8 }, "s1", 100)
    state = MemoryStore.addFact(state, { content: "i prefer typescript", category: "preference", confidence: 0.8 }, "s1", 100)
    expect(state.facts).toHaveLength(1)
  }),
)

it.live("addFact respects maxFacts limit", () =>
  Effect.gen(function* () {
    let state = emptyMemoryState()
    for (let i = 0; i < 5; i++) {
      state = MemoryStore.addFact(state, { content: `fact ${i}`, category: "knowledge", confidence: 0.5 + i * 0.1 }, "s1", 3)
    }
    expect(state.facts).toHaveLength(3)
  }),
)

it.live("addFact sorts by confidence descending", () =>
  Effect.gen(function* () {
    let state = emptyMemoryState()
    state = MemoryStore.addFact(state, { content: "low", category: "knowledge", confidence: 0.3 }, "s1", 10)
    state = MemoryStore.addFact(state, { content: "high", category: "knowledge", confidence: 0.9 }, "s1", 10)
    state = MemoryStore.addFact(state, { content: "mid", category: "knowledge", confidence: 0.6 }, "s1", 10)
    expect(state.facts[0].content).toBe("high")
    expect(state.facts[1].content).toBe("mid")
    expect(state.facts[2].content).toBe("low")
  }),
)

it.live("save and reload preserves facts", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    let state = emptyMemoryState()
    state = MemoryStore.addFact(state, { content: "I like Go", category: "preference", confidence: 0.8 }, "s1", 100)
    yield* MemoryStore.save(fs, dir, state)
    const loaded = yield* MemoryStore.load(fs, dir)
    expect(loaded.facts).toHaveLength(1)
    expect(loaded.facts[0].content).toBe("I like Go")
  }),
)
