import { describe, expect, it } from "bun:test"

function taskKey(task: { id?: string; description: string }): string {
  return task.id ?? task.description
}

function hasDependencies(tasks: { description: string; depends_on?: readonly string[] }[]): boolean {
  return tasks.some((t) => t.depends_on && t.depends_on.length > 0)
}

function detectCycle(tasks: { id?: string; description: string; depends_on?: readonly string[] }[]): string | null {
  const graph = new Map<string, string[]>()
  for (const task of tasks) {
    graph.set(taskKey(task), [...(task.depends_on ?? [])])
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string): string | null {
    if (inStack.has(node)) return node
    if (visited.has(node)) return null
    visited.add(node)
    inStack.add(node)
    for (const dep of graph.get(node) ?? []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }
    inStack.delete(node)
    return null
  }

  for (const task of tasks) {
    const cycle = detectCycleFor(taskKey(task))
    if (cycle) return cycle
  }
  return null

  function detectCycleFor(key: string): string | null {
    if (inStack.has(key)) return key
    if (visited.has(key)) return null
    visited.add(key)
    inStack.add(key)
    for (const dep of graph.get(key) ?? []) {
      const cycle = detectCycleFor(dep)
      if (cycle) return cycle
    }
    inStack.delete(key)
    return null
  }
}

function topologicalSort(tasks: { id?: string; description: string; depends_on?: readonly string[] }[]) {
  const remaining = new Map(tasks.map((t) => [taskKey(t), t]))
  const layers: typeof tasks[] = []

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(
      (task) => (task.depends_on ?? []).every((dep) => !remaining.has(dep)),
    )
    if (ready.length === 0) break
    layers.push(ready)
    for (const task of ready) {
      remaining.delete(taskKey(task))
    }
  }

  return layers
}

describe("DAG scheduler", () => {
  it("hasDependencies returns false for independent tasks", () => {
    expect(hasDependencies([{ description: "a" }, { description: "b" }])).toBe(false)
  })

  it("hasDependencies returns true when tasks have depends_on", () => {
    expect(
      hasDependencies([
        { description: "a" },
        { description: "b", depends_on: ["a"] },
      ]),
    ).toBe(true)
  })

  it("detectCycle returns null for no cycle", () => {
    const tasks = [
      { id: "a", description: "task a" },
      { id: "b", description: "task b", depends_on: ["a"] },
      { id: "c", description: "task c", depends_on: ["b"] },
    ]
    expect(detectCycle(tasks)).toBeNull()
  })

  it("detectCycle detects simple cycle", () => {
    const tasks = [
      { id: "a", description: "task a", depends_on: ["b"] },
      { id: "b", description: "task b", depends_on: ["a"] },
    ]
    expect(detectCycle(tasks)).not.toBeNull()
  })

  it("detectCycle detects indirect cycle", () => {
    const tasks = [
      { id: "a", description: "task a", depends_on: ["c"] },
      { id: "b", description: "task b", depends_on: ["a"] },
      { id: "c", description: "task c", depends_on: ["b"] },
    ]
    expect(detectCycle(tasks)).not.toBeNull()
  })

  it("topologicalSort produces correct layers", () => {
    const tasks = [
      { id: "a", description: "task a" },
      { id: "b", description: "task b", depends_on: ["a"] },
      { id: "c", description: "task c", depends_on: ["a"] },
      { id: "d", description: "task d", depends_on: ["b", "c"] },
    ]
    const layers = topologicalSort(tasks)
    expect(layers.length).toBe(3)
    expect(layers[0].map((t) => t.id)).toEqual(["a"])
    expect(layers[1].map((t) => t.id)).toEqual(["b", "c"])
    expect(layers[2].map((t) => t.id)).toEqual(["d"])
  })

  it("topologicalSort handles independent tasks in first layer", () => {
    const tasks = [
      { id: "a", description: "task a" },
      { id: "b", description: "task b" },
      { id: "c", description: "task c", depends_on: ["a", "b"] },
    ]
    const layers = topologicalSort(tasks)
    expect(layers.length).toBe(2)
    expect(layers[0].length).toBe(2)
    expect(layers[1].map((t) => t.id)).toEqual(["c"])
  })

  it("topologicalSort stops at cycle", () => {
    const tasks = [
      { id: "a", description: "task a", depends_on: ["b"] },
      { id: "b", description: "task b", depends_on: ["a"] },
    ]
    const layers = topologicalSort(tasks)
    expect(layers.length).toBe(0)
  })
})
