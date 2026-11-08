'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { getMetaPixelController } from '@/lib/analytics/meta-pixel'
import { privacyConsent } from '@/lib/analytics/privacy-consent'

export function MetaPixel() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    const controller = getMetaPixelController()
    const sync = () => controller.sync(
      process.env.NEXT_PUBLIC_META_PIXEL_ENABLED === 'true', privacyConsent.getSnapshot().marketing,
    )
    // The adapter notifies synchronously, so revocation does not wait for a
    // React rerender or the next navigation.
    const unsubscribe = privacyConsent.subscribe(sync)
    sync()
    window.addEventListener('hashchange', sync)
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', sync)
    }
  }, [pathname, search])

  useEffect(() => () => getMetaPixelController().deactivate(), [])
  return null
}
