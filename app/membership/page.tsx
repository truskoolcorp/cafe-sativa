'use client'

export default function MembershipPage() {
  const handleCheckout = async (plan: string) => {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    })

    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  return (
    <main className="p-10">
      <h1 className="text-4xl font-semibold mb-6">Membership</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="border p-6 rounded-xl">
          <h2 className="text-2xl mb-2">Insider</h2>
          <p>$9.99/mo</p>
          <button onClick={() => handleCheckout('insider')} className="mt-4 bg-[#d08e49] px-4 py-2 rounded">
            Join Insider
          </button>
        </div>

        <div className="border p-6 rounded-xl">
          <h2 className="text-2xl mb-2">Founding Guest</h2>
          <p>$24.99/mo</p>
          <button onClick={() => handleCheckout('founder')} className="mt-4 bg-[#d08e49] px-4 py-2 rounded">
            Become Founding Guest
          </button>
        </div>
      </div>
    </main>
  )
}
