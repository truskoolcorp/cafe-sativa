type Props = {
  on: boolean
  busy?: boolean
  needsActivation?: boolean
  toggle: () => void
}

export default function StageSoundToggle({ on, busy, needsActivation, toggle }: Props) {
  return (
    <button type="button" className="text-sm text-primary underline underline-offset-4"
      aria-pressed={needsActivation ? undefined : on} aria-busy={busy || undefined} onClick={toggle}>
      {needsActivation ? 'Enable sound' : <>
        Sound<span aria-hidden="true">: {busy ? 'Starting…' : on ? 'On' : 'Off'}</span>
      </>}
    </button>
  )
}
