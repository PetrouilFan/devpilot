import { expect, test } from "bun:test"
import { LoopDetection } from "@/middleware/loop-detection"

test("returns undefined for first tool call", () => {
  const d = new LoopDetection.LoopDetector()
  d.newTurn()
  expect(d.record("edit")).toBeUndefined()
})

test("warns on repeated identical tool calls at threshold", () => {
  const d = new LoopDetection.LoopDetector({ warn_threshold: 3, hard_limit: 5 })
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("edit")
  d.newTurn()
  const result = d.record("edit")
  expect(result).toBe("You have called the edit tool 3 times in a row. Consider a different approach.")
})

test("hard stops on repeated identical tool calls at limit", () => {
  const d = new LoopDetection.LoopDetector({ warn_threshold: 3, hard_limit: 5 })
  for (let i = 0; i < 5; i++) {
    d.newTurn()
    const result = d.record("edit")
    if (i < 2) expect(result).toBeUndefined()
    else if (i < 3) expect(result).toContain("3 times in a row")
    else if (i < 4) expect(result).toBeUndefined()
    else expect(result).toBe("HARD_STOP")
  }
  expect(d.isHardStopped).toBe(true)
})

test("different tool resets continuous counter", () => {
  const d = new LoopDetection.LoopDetector({ warn_threshold: 3, hard_limit: 5 })
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("read")
  d.newTurn()
  expect(d.record("read")).toBeUndefined()
})

test("per-tool frequency warning within window", () => {
  // Disable continuous identical detection with high thresholds
  const d = new LoopDetection.LoopDetector({
    window_size: 4, tool_freq_warn: 3, tool_freq_hard_limit: 10,
    warn_threshold: 100, hard_limit: 200,
  })
  // With window_size=4, freq check fires when calls.length >= 4
  // After 4 calls of "bash": calls=[bash×4], freq=4 >= 3 → warn
  d.newTurn()
  d.record("bash")
  d.newTurn()
  d.record("bash")
  d.newTurn()
  d.record("bash")
  d.newTurn()
  const result = d.record("bash")
  expect(typeof result).toBe("string")
  expect(result).toContain("has been used")
})

test("per-tool frequency hard stop", () => {
  // Disable continuous identical detection with high thresholds
  const d = new LoopDetection.LoopDetector({
    window_size: 3, tool_freq_warn: 2, tool_freq_hard_limit: 3,
    warn_threshold: 100, hard_limit: 200,
  })
  // After 3 calls of "read": calls=[read×3], calls.length=3 >= 3, freq=3 >= 3 → HARD_STOP
  d.newTurn()
  d.record("read")
  d.newTurn()
  d.record("read")
  d.newTurn()
  const result = d.record("read")
  expect(result).toBe("HARD_STOP")
  expect(d.isHardStopped).toBe(true)
})

test("per-tool frequency overrides", () => {
  // Disable continuous identical detection with high thresholds
  const d = new LoopDetection.LoopDetector({
    window_size: 3, tool_freq_warn: 20, tool_freq_hard_limit: 30,
    warn_threshold: 100, hard_limit: 200,
    tool_freq_overrides: { edit: { warn: 2, hard_limit: 4 } },
  })
  // After 3 calls of "edit": calls=[edit×3], calls.length=3 >= 3, freq=3 >= 2 (override) → warn
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("edit")
  d.newTurn()
  const result = d.record("edit")
  expect(typeof result).toBe("string")
  expect(result).toContain("has been used")
})

test("newTurn increments turn counter", () => {
  const d = new LoopDetection.LoopDetector()
  // @ts-expect-error accessing private for test
  expect(d.turn).toBe(0)
  d.newTurn()
  // @ts-expect-error accessing private for test
  expect(d.turn).toBe(1)
})

test("reset clears state", () => {
  const d = new LoopDetection.LoopDetector({ warn_threshold: 1, hard_limit: 2 })
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("edit")
  expect(d.isHardStopped).toBe(true)
  d.reset()
  expect(d.isHardStopped).toBe(false)
  d.newTurn()
  expect(d.record("edit")).toBeUndefined()
})

test("empty config uses defaults", () => {
  const d = new LoopDetection.LoopDetector({})
  d.newTurn()
  d.record("edit")
  d.newTurn()
  d.record("edit")
  d.newTurn()
  const r = d.record("edit")
  expect(r).toContain("3 times in a row")
  expect(r).not.toBe("HARD_STOP")
})
