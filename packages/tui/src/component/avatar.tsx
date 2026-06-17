import { RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { avatars, type AvatarExpression } from "../assets/avatar"
import { For, createMemo } from "solid-js"

export type { AvatarExpression }

export interface AvatarProps {
  expression?: AvatarExpression
  width?: number
}

const IMAGE_W = 32
const IMAGE_H = 32

function pixelAt(data: number[][], y: number, x: number): RGBA {
  const px = data[y * IMAGE_W + x]!
  return RGBA.fromInts(px[0]!, px[1]!, px[2]!, px[3]!)
}

function blendWithBg(top: RGBA, bottom: RGBA, bg: RGBA): { fg: RGBA; bg: RGBA } {
  const blend = (src: RGBA, dst: RGBA) => {
    if (src.a >= 255) return src
    if (src.a <= 0) return dst
    const a = src.a / 255
    return RGBA.fromInts(
      Math.round(src.r * a + dst.r * (1 - a)),
      Math.round(src.g * a + dst.g * (1 - a)),
      Math.round(src.b * a + dst.b * (1 - a)),
      255,
    )
  }
  return { fg: blend(top, bg), bg: blend(bottom, bg) }
}

export function Avatar(props: AvatarProps = {}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const expression = () => props.expression ?? "open_eyes"
  const rgb = () => renderer.capabilities?.rgb === true

  const rows = createMemo(() => {
    const data = avatars[expression()] ?? avatars.open_eyes
    const bg = theme.background
    const result: Array<Array<{ char: string; fg: RGBA; bg: RGBA }>> = []

    for (let y = 0; y < IMAGE_H; y += 2) {
      const row: Array<{ char: string; fg: RGBA; bg: RGBA }> = []
      for (let x = 0; x < IMAGE_W; x++) {
        const top = pixelAt(data, y, x)
        const bot = pixelAt(data, y + 1, x)

        if (rgb()) {
          const colors = blendWithBg(top, bot, bg)
          row.push({ char: "▀", fg: colors.fg, bg: colors.bg })
        } else {
          const blended = blendWithBg(top, bot, bg)
          row.push({ char: "█", fg: blended.fg, bg: blended.bg })
        }
      }
      result.push(row)
    }
    return result
  })

  return (
    <box flexDirection="column" width={IMAGE_W}>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(cell) => (
                <text fg={cell.fg} bg={cell.bg} selectable={false}>
                  {cell.char}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
