'use client'

import { useEffect, useState } from 'react'

export default function HomePage() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  if (!ready) return null

  return (
    <main className="min-h-screen bg-[#2B1810] text-white flex flex-col items-center justify-center">
      <h1 className="text-5xl font-serif text-[#C9A961] mb-6">
        Café Sativa
      </h1>

      <p className="text-lg text-[#F5E6D3] mb-8 text-center max-w-md">
        Sip. Smoke. Vibe.
        <br />
        A virtual-first experience platform for culture, cuisine, and elevated living.
      </p>

      <button
        onClick={async () => {
          try {
            const res = await fetch('/api/create-checkout-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: 'insider' }),
            })

            const data = await res.json()

            if (data.url) {
              window.location.href = data.url
            } else {
              alert('Checkout failed')
            }
          } catch (err) {
            console.error(err)
            alert('Something went wrong')
          }
        }}
        className="bg-[#C9A961] text-[#2B1810] px-8 py-4 rounded font-semibold hover:bg-[#F5E6D3]"
      >
        Join Café Sativa Insider
      </button>
    </main>
  )
}
