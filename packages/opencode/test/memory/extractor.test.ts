import { expect, test } from "bun:test"
import { MemoryExtractor } from "@/memory/extractor"

test("extracts preference from explicit preference pattern", () => {
  const result = MemoryExtractor.extract("I dislike using JavaScript", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("preference")
  expect(result.facts[0].content).toContain("dislike")
})

test("extracts correction from correction pattern", () => {
  const result = MemoryExtractor.extract("no, I meant using Bun instead of Node", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("correction")
  expect(result.facts[0].confidence).toBeGreaterThan(0.7)
})

test("extracts knowledge from experience sharing", () => {
  const result = MemoryExtractor.extract("I have experience with distributed systems and Kafka", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("knowledge")
})

test("returns empty for short messages", () => {
  const result = MemoryExtractor.extract("Hi", "", [])
  expect(result.facts).toHaveLength(0)
})

test("returns empty for empty message", () => {
  const result = MemoryExtractor.extract("", "", [])
  expect(result.facts).toHaveLength(0)
})

test("returns empty for irrelevant messages", () => {
  const result = MemoryExtractor.extract("The weather is nice today", "", [])
  expect(result.facts).toHaveLength(0)
})

test("extracts 'always use' as preference", () => {
  const result = MemoryExtractor.extract("I always use React for frontend development", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("preference")
})

test("extracts 'never use' as preference", () => {
  const result = MemoryExtractor.extract("I never use class components", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("preference")
})

test("extracts 'typically write' as preference", () => {
  const result = MemoryExtractor.extract("I typically write functional components", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("preference")
})

test("extracts 'don't use' as correction", () => {
  const result = MemoryExtractor.extract("Don't use var, use const instead", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("correction")
})

test("extracts 'I know' as knowledge", () => {
  const result = MemoryExtractor.extract("I know Python and JavaScript well", "", [])
  expect(result.facts).toHaveLength(1)
  expect(result.facts[0].category).toBe("knowledge")
})
