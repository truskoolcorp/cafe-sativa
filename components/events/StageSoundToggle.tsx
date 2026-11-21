type Props = {
  on: boolean
  busy?: boolean
  toggle: () => void
}

export default function StageSoundToggle({ on, busy, toggle }: Props) {
  return (
    <button type="button" className="text-sm text-primary underline underline-offset-4"
      aria-pressed={on} aria-busy={busy || undefined} onClick={toggle}>
      Sound<span aria-hidden="true">: {on ? 'On' : 'Off'}</span>
    </button>
  )
}
