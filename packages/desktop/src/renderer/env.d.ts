import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __DEVPILOT__?: {
      deepLinks?: string[]
    }
  }
}
