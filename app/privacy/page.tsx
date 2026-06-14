import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Café Sativa — how we collect, use, and protect your information.',
}

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-4">
            Last updated: {lastUpdated}
          </p>
        </div>

        <div className="prose-sm font-body space-y-8 text-foreground/90 leading-relaxed">

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Who we are
            </h2>
            <p className="text-muted-foreground">
              Café Sativa is a virtual-first cultural venue operated by Tru Skool
              Entertainment International Corp., Dallas, TX. Our website is located at{' '}
              <span className="text-foreground">www.cafe-sativa.com</span>. Questions
              about this policy can be directed to{' '}
              <a
                href={`mailto:${contactEmail}`}
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                {contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Information we collect
            </h2>
            <p className="text-muted-foreground mb-3">
              We collect only what is necessary to operate the venue and provide a
              personalized experience:
            </p>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'Account information — name and email address when you create an account.',
                'Payment information — processed securely by Stripe. We do not store full card numbers.',
                'Usage data — pages visited, events attended, and host conversations, used to personalize your experience.',
                'Communications — messages you send through our contact form or to our AI hosts.',
                'Email subscriptions — your address if you opt in to our event announcements.',
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
              How we use your information
            </h2>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'To create and manage your account and membership.',
                'To process event ticket purchases and gallery transactions.',
                'To operate our AI host conversations and maintain conversation memory within your membership tier.',
                'To send event announcements and updates you have opted into.',
                'To improve the venue experience and troubleshoot technical issues.',
                'To comply with legal obligations.',
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
              Sharing your information
            </h2>
            <p className="text-muted-foreground">
              We do not sell your personal information. We share data only with
              trusted service providers necessary to operate the platform — including
              Stripe (payment processing), Supabase (database infrastructure), and
              Resend (transactional email). Each provider is bound by appropriate data
              protection agreements.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              AI host conversations
            </h2>
            <p className="text-muted-foreground">
              Conversations with our AI hosts (Laviche, Ginger, and Ahnika) are stored
              to provide memory continuity across sessions. Regular members retain 90
              days of conversation history; VIP members retain 365 days. You may
              request deletion of your conversation history at any time by contacting
              us.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Cookies and tracking
            </h2>
            <p className="text-muted-foreground">
              We use essential cookies to maintain your session and authentication
              state. We do not use third-party advertising cookies or cross-site
              tracking technologies.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Data retention
            </h2>
            <p className="text-muted-foreground">
              We retain your account data for as long as your account is active or as
              needed to provide services. If you close your account, we will delete or
              anonymize your personal data within 30 days, except where retention is
              required by law.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Your rights
            </h2>
            <p className="text-muted-foreground mb-3">
              You have the right to:
            </p>
            <ul className="space-y-2 text-muted-foreground list-none pl-0">
              {[
                'Access the personal data we hold about you.',
                'Request correction of inaccurate data.',
                'Request deletion of your data.',
                'Opt out of marketing emails at any time via the unsubscribe link.',
                'Lodge a complaint with your local data protection authority.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary mt-1 shrink-0">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4">
              To exercise any of these rights, contact us at{' '}
              <a
                href={`mailto:${contactEmail}`}
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                {contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-bold text-foreground mb-3">
              Changes to this policy
            </h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. When we do, we will
              update the &ldquo;Last updated&rdquo; date above and, for material
              changes, notify you by email or via an in-venue notice.
            </p>
          </section>

          <div className="border-t border-border pt-8 mt-8">
            <p className="text-sm text-muted-foreground">
              Questions?{' '}
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
