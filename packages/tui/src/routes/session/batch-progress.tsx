import { createMemo, For, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { Locale } from "../../util/locale"

export function BatchProgress() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))

  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    return sync.data.session
      .filter((x) => x.parentID === s.id)
      .toSorted((a, b) => a.time.created - b.time.created)
  })

  const progress = createMemo(() => {
    const kids = children()
    if (kids.length === 0) return null

    let running = 0
    let completed = 0
    let queued = 0

    for (const kid of kids) {
      const status = sync.data.session_status[kid.id]
      if (!status) {
        queued++
        continue
      }
      switch (status.type) {
        case "busy":
          running++
          break
        case "idle":
          completed++
          break
        case "retry":
          running++
          break
      }
    }

    return { total: kids.length, running, completed, queued, kids }
  })

  const { theme } = useTheme()

  return (
    <Show when={progress()}>
      {(p) => (
        <box flexShrink={0}>
          <box
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={1}
            {...SplitBorder}
            border={["left"]}
            borderColor={theme.border}
            flexShrink={0}
            backgroundColor={theme.backgroundPanel}
          >
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>Batch</b>
                </text>
                <text fg={theme.textMuted}>
                  {p().completed}/{p().total} complete
                </text>
                <Show when={p().running > 0}>
                  <text fg={theme.warning}>
                    {p().running} running
                  </text>
                </Show>
                <Show when={p().queued > 0}>
                  <text fg={theme.textMuted}>
                    {p().queued} queued
                  </text>
                </Show>
              </box>
            </box>
            <box flexDirection="row" gap={1} marginTop={0}>
              <For each={p().kids}>
                {(kid) => {
                  const status = createMemo(() => sync.data.session_status[kid.id])
                  const title = (kid.title ?? "").replace(/ @\w+ subagent$/, "").slice(0, 12)
                  const statusLabel = createMemo(() => {
                    const s = status()
                    if (!s) return "queued"
                    if (s.type === "busy") return "..."
                    if (s.type === "retry") return "retry"
                    return "done"
                  })
                  const statusColor = createMemo(() => {
                    const s = status()
                    if (s?.type === "busy" || s?.type === "retry") return theme.warning
                    if (s?.type === "idle") return theme.success
                    return theme.textMuted
                  })
                  return (
                    <text fg={theme.textMuted}>
                      {title}: <span style={{ fg: statusColor() }}>{statusLabel()}</span>
                    </text>
                  )
                }}
              </For>
            </box>
          </box>
        </box>
      )}
    </Show>
  )
}
