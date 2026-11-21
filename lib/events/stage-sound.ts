function preferenceKey() {
  return `cs:stage-sound:v1:${window.location.pathname}`
}

export function readStageSound() {
  try {
    return window.sessionStorage.getItem(preferenceKey()) === 'on'
  } catch {
    return false
  }
}

export function writeStageSound(on: boolean) {
  try {
    window.sessionStorage.setItem(preferenceKey(), on ? 'on' : 'off')
  } catch {
    // The control still works if the browser disallows session storage.
  }
}

export const MIN_STAGE_VOLUME = 5

export function readStageVolume() {
  try {
    const value = Number(window.sessionStorage.getItem(`${preferenceKey()}:volume`))
    if (value >= MIN_STAGE_VOLUME && value <= 100) return value
  } catch {
    // The volume control still works without stored preferences.
  }
  return 100
}

export function writeStageVolume(value: number) {
  if (!Number.isFinite(value) || value < MIN_STAGE_VOLUME || value > 100) return
  try {
    window.sessionStorage.setItem(`${preferenceKey()}:volume`, String(value))
  } catch {
    // The volume control still works without stored preferences.
  }
}
