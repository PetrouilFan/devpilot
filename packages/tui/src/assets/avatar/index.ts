import { close_eyes } from "./close_eyes"
import { look_left } from "./look_left"
import { look_right } from "./look_right"
import { open_eyes } from "./open_eyes"
import { sad } from "./sad"

export const avatars = {
  close_eyes,
  look_left,
  look_right,
  open_eyes,
  sad,
} as const

export type AvatarExpression = keyof typeof avatars
export type AvatarPixels = number[]
