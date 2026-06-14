import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for Café Sativa — the rules that govern your use of the venue.',
}

export default function TermsPage() {
  const lastUpdated = 'June 15, 2026'
  const contactEmail = 'hello@cafe-sativa.com'

  return (
    <div className="pt-24 pb-20 bg-background min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-12">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Legal
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-4">
            Last updated: {lastUpdated}
          </p>
        </div>

        <div className="prose-sm font-body space-y-8 text-foreground/90 leading-relaxed">

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Welcome
            </h2>
            <p className="text-muted-foreground">
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Café
              Sativa, a virtual cultural venue operated by Tru Skool Entertainment
              International Corp., Dallas, TX (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
              &ldquo;Café Sativa&rdquo;). By creating an account or accessing the
              venue, you agree to these Terms. If you do not agree, please do not use
              the platform.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Your account
            </h2>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'You must be at least 18 years old to create an account.',
                'You are responsible for keeping your login credentials secure.',
                'You may not share your account with others or create accounts on behalf of third parties.',
                'You agree to provide accurate information when registering.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary mt-1 shrink-0">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Memberships and tickets
            </h2>
            <p className="text-muted-foreground mb-3">
              Café Sativa offers free (Explorer) and paid (Regular and VIP) memberships,
              as well as individual event tickets. By purchasing:
            </p>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'All payments are processed securely via Stripe. We do not store payment card details.',
                'Memberships renew automatically on a monthly basis until cancelled. You may cancel at any time from your account settings.',
                'Event tickets are non-refundable unless the event is cancelled or rescheduled by Café Sativa.',
                'Digital goods (recordings, downloads) are non-refundable once accessed.',
                'We reserve the right to modify pricing with reasonable notice.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary mt-1 shrink-0">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Community standards
            </h2>
            <p className="text-muted-foreground mb-3">
              Café Sativa is a curated cultural space. When using the lounge, interacting
              with hosts, or participating in events, you agree not to:
            </p>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'Post or transmit content that is abusive, harassing, discriminatory, or illegal.',
                'Attempt to impersonate other members, hosts, or staff.',
                'Use the platform to distribute spam or commercial solicitations.',
                'Attempt to circumvent security measures or access content beyond your membership tier.',
                'Record or redistribute event content without prior written consent.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary mt-1 shrink-0">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4">
              We reserve the right to suspend or terminate accounts that violate these
              standards without notice or refund.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              AI hosts
            </h2>
            <p className="text-muted-foreground">
              Our AI hosts (Laviche, Ginger, and Ahnika) are AI-powered concierges
              designed to enhance your experience at the venue. They are not human, do
              not provide professional advice (legal, medical, financial, or otherwise),
              and their responses should not be relied upon as such. Conversation
              history is stored as described in our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Gallery and artist content
            </h2>
            <p className="text-muted-foreground">
              Artists who list work in the Café Sativa Gallery represent that they own
              or have rights to the content they submit, and grant us a limited license
              to display it on the platform. Buyers of gallery items receive the rights
              described in each listing. Café Sativa is not responsible for
              artist-to-buyer disputes beyond facilitating the initial transaction.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Intellectual property
            </h2>
            <p className="text-muted-foreground">
              All content produced by Café Sativa — including the platform design,
              branding, host personas, original event recordings, and written materials
              — is owned by Tru Skool Entertainment International Corp. and protected by
              applicable copyright law. You may not reproduce, distribute, or create
              derivative works without our written permission.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Limitation of liability
            </h2>
            <p className="text-muted-foreground">
              Café Sativa is provided on an &ldquo;as is&rdquo; basis. We do not
              warrant uninterrupted or error-free operation of the platform. To the
              maximum extent permitted by law, Tru Skool Entertainment International
              Corp. shall not be liable for indirect, incidental, or consequential
              damages arising from your use of the platform.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Governing law
            </h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of the State of Texas, United States,
              without regard to its conflict of law provisions. Any disputes shall be
              resolved in the courts of Dallas County, Texas.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Changes to these terms
            </h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. Continued use of Café Sativa
              after changes are posted constitutes your acceptance of the updated Terms.
              For material changes, we will notify you by email or via a notice within
              the platform.
            </p>
          </section>

          <div className="border-t border-border pt-8 mt-8">
            <p className="text-sm text-muted-foreground">
              Questions about these Terms?{' '}
              <a
                href="/contact"
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                Contact us
              </a>{' '}
              or email{' '}
              <a
                href={`mailto:${contactEmail}`}
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                {contactEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
