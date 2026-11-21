'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function StagePremiereRefresh({ startsAt, serverNow }: { startsAt: string; serverNow?: number }) {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let refreshed = false
    const anchor = performance.now()
    function checkStart() {
      clearTimeout(timer)
      if (refreshed) return
      const now = serverNow === undefined ? Date.now() : serverNow + performance.now() - anchor
      const remaining = Date.parse(startsAt) - now
      if (!Number.isFinite(remaining)) return
      if (remaining <= 0) {
        refreshed = true
        router.refresh()
        return
      }
      timer = setTimeout(checkStart, Math.min(remaining + 500, 60_000))
    }
    checkStart()
    document.addEventListener('visibilitychange', checkStart)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkStart)
    }
  }, [router, startsAt, serverNow])

  return null
}
