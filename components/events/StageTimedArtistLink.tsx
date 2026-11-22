'use client'

import { useEffect, useState } from 'react'
import { stageLinkCueDelay } from '@/lib/events/stage-link-cue'

type Props = { href: string; label: string; showAt: number; serverNow: number }

export default function StageTimedArtistLink({ href, label, showAt, serverNow }: Props) {
  const [visible, setVisible] = useState(() => stageLinkCueDelay(showAt, serverNow, 0) === 0)

  useEffect(() => {
    const anchor = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    function update() {
      clearTimeout(timer)
      const delay = stageLinkCueDelay(showAt, serverNow, performance.now() - anchor)
      setVisible(delay === 0)
      if (delay !== null && delay > 0) timer = setTimeout(update, Math.min(delay + 25, 60_000))
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [showAt, serverNow])

  if (!visible) return null
  return (
    <aside aria-label="Artist link" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-2">
      <span className="text-sm text-muted-foreground">From The Stage</span>
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">
        {label} <span className="sr-only">(opens in a new tab)</span>
      </a>
    </aside>
  )
}
