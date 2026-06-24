import { ConfigV1 } from "@devpilot-ai/core/v1/config/config"

const DEFAULT_WARN_THRESHOLD = 3
const DEFAULT_HARD_LIMIT = 5
const DEFAULT_WINDOW_SIZE = 20
const DEFAULT_TOOL_FREQ_WARN = 30
const DEFAULT_TOOL_FREQ_HARD_LIMIT = 50

type ToolCall = {
  tool: string
  turn: number
}

/**
 * Sliding-window loop detector that tracks tool call frequency per tool type.
 *
 * Two detection modes:
 * 1. Repeated identical tool calls (e.g. edit → edit → edit without progress)
 * 2. Excessive frequency of a single tool type within a window
 */
export class LoopDetector {
  private calls: ToolCall[] = []
  private duplicates = 0
  private lastTool: string | undefined
  private continuousCount = 0
  private turn = 0
  private warnedTools = new Set<string>()
  private hardStopTools = new Set<string>()

  private cfg?: ConfigV1.Info["loop_detection"]

  constructor(cfg?: ConfigV1.Info["loop_detection"]) {
    this.cfg = cfg
  }

  newTurn() {
    this.turn++
  }

  /**
   * Record a tool call and check for loop patterns.
   * Returns a warning message if the tool is looping, or undefined if OK.
   * Returns "HARD_STOP" if the hard limit is reached.
   */
  record(tool: string): string | undefined {
    this.calls.push({ tool, turn: this.turn })
    const windowSize = this.cfg?.window_size ?? DEFAULT_WINDOW_SIZE
    if (this.calls.length > windowSize) this.calls.shift()

    // Continuous identical tool detection
    if (this.lastTool === tool) {
      this.continuousCount++
      const hardLimit = this.cfg?.hard_limit ?? DEFAULT_HARD_LIMIT
      const warnThreshold = this.cfg?.warn_threshold ?? DEFAULT_WARN_THRESHOLD

      if (this.continuousCount >= hardLimit && !this.hardStopTools.has(tool)) {
        this.hardStopTools.add(tool)
        return `HARD_STOP`
      }

      if (this.continuousCount >= warnThreshold && !this.warnedTools.has(tool)) {
        this.warnedTools.add(tool)
        return `You have called the ${tool} tool ${this.continuousCount} times in a row. Consider a different approach.`
      }
    } else {
      this.continuousCount = 1
    }
    this.lastTool = tool

    // Per-tool frequency detection within the window
    if (this.calls.length >= windowSize) {
      const freqWarning = this.cfg?.tool_freq_warn ?? DEFAULT_TOOL_FREQ_WARN
      const freqHardLimit = this.cfg?.tool_freq_hard_limit ?? DEFAULT_TOOL_FREQ_HARD_LIMIT
      const overrides = this.cfg?.tool_freq_overrides ?? {}
      const warnLimit = overrides[tool]?.warn ?? freqWarning
      const hardLimit = overrides[tool]?.hard_limit ?? freqHardLimit

      const freq = this.calls.filter((c) => c.tool === tool).length
      if (freq >= hardLimit && !this.hardStopTools.has(tool)) {
        this.hardStopTools.add(tool)
        return `HARD_STOP`
      }
      if (freq >= warnLimit && !this.warnedTools.has(tool)) {
        this.warnedTools.add(tool)
        return `Tool ${tool} has been used ${freq} times in the last ${windowSize} turns. Consider a more efficient approach.`
      }
    }

    return undefined
  }

  get isHardStopped() {
    return this.hardStopTools.size > 0
  }

  reset() {
    this.calls = []
    this.duplicates = 0
    this.lastTool = undefined
    this.continuousCount = 0
    this.warnedTools.clear()
    this.hardStopTools.clear()
  }
}

export * as LoopDetection from "./loop-detection"
