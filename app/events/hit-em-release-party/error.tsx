'use client'

export default function HitEmError({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground">
      <section className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
        <h1 className="font-heading text-3xl font-bold">The gathering page is temporarily unavailable</h1>
        <p className="mt-4 text-muted-foreground">Please try again. No ticket or payment is needed for this public gathering.</p>
        <button type="button" onClick={reset} className="mt-6 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Try again</button>
      </section>
    </div>
  )
}
