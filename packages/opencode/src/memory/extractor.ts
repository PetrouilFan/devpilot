import type { ExtractionResultType, MemoryFactType } from "./types"

/**
 * Pattern-based fact extraction from conversation turns.
 * Uses lightweight heuristics rather than LLM calls, making it suitable
 * for background execution after each turn.
 */

// Correction patterns: user correcting the AI
const CORRECTION_PATTERNS = [
  /no[.,]*\s+(?:I\s+(?:meant|prefer|use|want|like|need|have))/i,
  /(?:don'?t|do not|stop|instead of|actually|rather)/i,
  /(?:use|using|uses?)\s+(?:\w+\s+){0,3}(?:instead|rather)/i,
  /I\s+(?:prefer|like|want|need)\s+\w+\s+instead\s+of/i,
  /I'm\s+(?:using|on)\s+(\w+)/i,
]

// Preference patterns: user expressing preference
const PREFERENCE_PATTERNS = [
  /I\s+(?:prefer|like|love|hate|dislike)\s+(.+)/i,
  /(?:better|worse|preferred|favorite)\s+(?:way|approach|method|tool|library|framework)/i,
  /(?:always|never|usually|typically|normally)\s+(?:use|do|write|code)/i,
  /I\s+(?:use|work\s+with|code\s+in|write)\s+(\w+)/i,
]

// Knowledge patterns: user sharing information
const KNOWLEDGE_PATTERNS = [
  /I\s+(?:work|worked|have\s+experience|have\s+been)\s+(?:as|with|on|in)/i,
  /I\s+(?:know|understand|learned|studied|used\s+before)/i,
  /my\s+(?:background|experience|expertise|role|job)/i,
]

/**
 * Extracts simple facts from a user message using pattern matching.
 * Returns an empty array if nothing meaningful is found.
 */
function extractFactFromUserMessage(userMessage: string, confidence: number): { content: string; category: MemoryFactType["category"]; confidence: number } | undefined {
  // Check corrections first (highest priority)
  for (const pattern of CORRECTION_PATTERNS) {
    const match = userMessage.match(pattern)
    if (match) {
      return {
        content: `User corrected approach: ${match[0].trim()}`,
        category: "correction",
        confidence: Math.min(confidence + 0.2, 1.0),
      }
    }
  }

  // Check preferences
  for (const pattern of PREFERENCE_PATTERNS) {
    const match = userMessage.match(pattern)
    if (match) {
      return {
        content: `User preference: ${match[0].trim()}`,
        category: "preference",
        confidence: confidence,
      }
    }
  }

  // Check knowledge/experience sharing
  for (const pattern of KNOWLEDGE_PATTERNS) {
    const match = userMessage.match(pattern)
    if (match) {
      return {
        content: `User context: ${match[0].trim()}`,
        category: "knowledge",
        confidence: Math.max(confidence - 0.1, 0.3),
      }
    }
  }

  return undefined
}

/**
 * Extracts facts from a conversation turn using pattern matching.
 * No LLM call required — fast and lightweight for background execution.
 */
export function extract(
  userMessage: string,
  _assistantMessage: string,
  _toolCalls: string[],
): { facts: Array<{ content: string; category: MemoryFactType["category"]; confidence: number }> } {
  const result: Array<{ content: string; category: MemoryFactType["category"]; confidence: number }> = []

  if (!userMessage || userMessage.length < 10) return { facts: result }

  // Extract from user message
  const fact = extractFactFromUserMessage(userMessage, 0.7)
  if (fact) {
    result.push(fact)
  }

  return { facts: result }
}

/**
 * Formats facts for injection into the system prompt as XML.
 */
export function formatFactsForInjection(
  facts: ExtractionResultType["facts"],
  maxFacts: number,
): string {
  const sorted = [...facts]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxFacts)

  if (sorted.length === 0) return ""

  return [
    "<memory>",
    ...sorted.map(
      (fact) =>
        `  <fact category="${fact.category}" confidence="${fact.confidence.toFixed(2)}">${fact.content}</fact>`,
    ),
    "</memory>",
  ].join("\n")
}

export * as MemoryExtractor from "./extractor"
