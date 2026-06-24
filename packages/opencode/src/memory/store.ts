import { Effect, Schema } from "effect"
import path from "path"
import type { MemoryStateType } from "./types"
import { MemoryState, emptyMemoryState } from "./types"
import { FSUtil } from "@devpilot-ai/core/fs-util"

const MEMORY_FILE = "memory.json"

const decodeMemoryState = Schema.decodeUnknownExit(MemoryState)

let factCounter = 0
function nextFactID(): string {
  return `fact_${Date.now()}_${++factCounter}`
}

export function load(fs: FSUtil.Interface, dir: string) {
  const file = path.join(dir, ".opencode", MEMORY_FILE)
  return Effect.gen(function* () {
    const content = yield* fs.readFileStringSafe(file)
    if (!content) return emptyMemoryState()
    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as ReturnType<typeof JSON.parse>,
      catch: () => undefined,
    })
    if (!parsed) return emptyMemoryState()
    const decoded = decodeMemoryState(parsed)
    if (decoded._tag === "Success") return decoded.value
    return emptyMemoryState()
  }).pipe(Effect.catch(() => Effect.succeed(emptyMemoryState())))
}

export function save(fs: FSUtil.Interface, dir: string, state: MemoryStateType) {
  const file = path.join(dir, ".opencode", MEMORY_FILE)
  return Effect.gen(function* () {
    yield* fs.ensureDir(path.dirname(file)).pipe(Effect.orDie)
    yield* fs.writeFileString(file, JSON.stringify(state, null, 2)).pipe(Effect.orDie)
  })
}

export function addFact(
  state: MemoryStateType,
  fact: { content: string; category: string; confidence: number },
  source: string,
  maxFacts: number,
): MemoryStateType {
  const contentKey = fact.content.toLowerCase().trim()
  const exists = state.facts.some((f) => f.content.toLowerCase().trim() === contentKey)
  if (exists) return state

  const newFact = {
    id: nextFactID(),
    content: fact.content,
    category: fact.category,
    confidence: fact.confidence,
    createdAt: Date.now(),
    source,
  } as MemoryStateType["facts"][number]

  const all = [...state.facts, newFact]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxFacts)

  return { ...state, facts: all }
}

export * as MemoryStore from "./store"
