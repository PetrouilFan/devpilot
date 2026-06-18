export * as SubagentConcurrency from "./concurrency"

import { Effect, Semaphore } from "effect"

export interface ConcurrencyLimit {
  readonly withPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export const make = (maxConcurrency: number): ConcurrencyLimit => {
  const sem = Semaphore.makeUnsafe(maxConcurrency)
  return {
    withPermit: (effect) => sem.withPermit(effect),
  }
}

export const unlimited: ConcurrencyLimit = {
  withPermit: (effect) => effect,
}
