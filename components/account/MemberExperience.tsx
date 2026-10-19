import Link from 'next/link'

/** Approved Café Sativa virtual venue features. Deliberately no invented
 * balances, referrals, sessions, replay assets, or entitlements. */
const sections = [
  { title: 'Approved programming library', description: 'Read released venue stories and editorial programming with your account.', href: '/account/library', action: 'Open your library' },
  { title: 'Past recordings', description: 'Rewatch approved Stage and venue sessions when released. VIP replay access will be checked against your membership.', href: '/stage', action: 'Explore the Stage' },
  { title: 'Recipe library', description: 'Class recipes and downloadable cards will appear after chef and content approval.', href: '/kitchen', action: 'Explore the Kitchen' },
  { title: 'Listening and recommendations', description: 'Curated episodes and trusted resources will appear when their links are reviewed and published.', href: '/discover', action: 'Explore approved content' },
  { title: 'Rewards and milestones', description: 'Points, referrals and redeemable perks are being prepared. No demo balances or rewards are shown as earned.', href: '/membership', action: 'See membership benefits' },
] as const

export function MemberExperience() {
  return (
    <section aria-labelledby="member-experience" className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your Café Sativa</p>
        <h2 id="member-experience" className="font-heading text-2xl font-bold mt-2">Member experiences</h2>
        <p className="text-sm text-muted-foreground mt-2">Explore the venue while these member libraries are prepared. Only verified, approved content will be listed when available.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map(section => (
          <article key={section.title} className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-heading text-lg font-bold">{section.title}</h3>
            <p className="text-sm text-muted-foreground my-3">{section.description}</p>
            <Link className="text-sm font-semibold text-primary underline-offset-4 hover:underline" href={section.href}>{section.action} →</Link>
          </article>
        ))}
      </div>
    </section>
  )
}
