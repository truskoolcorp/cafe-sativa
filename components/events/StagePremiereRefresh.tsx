'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function StagePremiereRefresh({ startsAt }: { startsAt: string }) {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function checkStart() {
      clearTimeout(timer)
      const remaining = Date.parse(startsAt) - Date.now()
      if (remaining <= 0) {
        router.refresh()
        return
      }
      timer = setTimeout(checkStart, Math.min(remaining + 500, 60_000))
    }
    checkStart()
    return () => clearTimeout(timer)
  }, [router, startsAt])

  return null
}
