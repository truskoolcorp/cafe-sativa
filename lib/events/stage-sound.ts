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
