declare global {
  const DEVPILOT_VERSION: string
  const DEVPILOT_CHANNEL: string
}

export const InstallationVersion = typeof DEVPILOT_VERSION === "string" ? DEVPILOT_VERSION : "local"
export const InstallationChannel = typeof DEVPILOT_CHANNEL === "string" ? DEVPILOT_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
