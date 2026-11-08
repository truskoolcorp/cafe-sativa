'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { privacyConsent } from '@/lib/analytics/privacy-consent'
import { getMetricoolController } from '@/lib/analytics/metricool'

export function Metricool() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    const controller = getMetricoolController()
    const sync = () => controller.sync(process.env.NEXT_PUBLIC_METRICOOL_ENABLED === 'true',
      privacyConsent.getSnapshot().analytics)
    const unsubscribe = privacyConsent.subscribe(sync)
    sync()
    window.addEventListener('hashchange', sync)
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', sync)
      controller.sync(false, false)
    }
  }, [pathname, search])
  return null
}
