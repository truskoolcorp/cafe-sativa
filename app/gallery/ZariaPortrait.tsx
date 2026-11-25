'use client'

import { useEffect, useRef, useState } from 'react'

export function ZariaPortrait() {
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const portrait = image.current
    // A fast response may settle before the browser hydrates the event handlers.
    if (portrait?.currentSrc && portrait.complete) {
      if (portrait.naturalWidth > 0) setLoaded(true)
      else setUnavailable(true)
    }
  }, [])
  return (
    <div className="relative w-full max-w-[16rem] aspect-[4/5] overflow-hidden border-l border-primary bg-[#17120f]">
      {!loaded && <div aria-hidden="true" className="absolute inset-0 grid place-items-center font-heading text-6xl md:text-8xl text-primary/70">ZS</div>}
      {!unavailable && (
        // Keep the fixed derivative on its own route; never ask Next's optimizer for a master.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={image} src="/api/gallery/zaria-portrait" alt="Zaria Solenne, Gallery curator" width={448} height={560}
          loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full object-contain ${loaded ? '' : 'invisible'}`}
          onLoad={() => setLoaded(true)} onError={() => setUnavailable(true)} />
      )}
    </div>
  )
}
