import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ContactForm } from '@/components/site/ContactForm'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with Café Sativa. Press, partnerships, artist and chef inquiries, or questions about the Tenerife venue.',
}

/**
 * Contact landing page. Server component so we get a clean initial
 * render; the form inside is the client piece that reads
 * searchParams. Suspense boundary is required by Next for
 * useSearchParams to not bail out of static generation — we leave
 * the shell static and only the form reads params.
 */
export default function ContactPage() {
  return (
    <div className="pt-24 pb-20 bg-background min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Contact
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Say hello.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-4 leading-relaxed">
            Press, partnerships, artist submissions, or just the right question
            about Tenerife. We read every message.
          </p>
        </div>

        <Suspense fallback={<div className="h-96" />}>
          <ContactForm />
        </Suspense>
      </div>
    </div>
  )
}
