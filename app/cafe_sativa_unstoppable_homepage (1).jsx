export default function CafeSativaHomepage() {
  const experienceZones = [
    {
      title: 'The Stage',
      subtitle: 'Live music, interviews, and cultural moments',
      description:
        'Curated performances, intimate sets, artist conversations, and signature programming that gives the brand a heartbeat before the physical venue opens.',
      cta: 'View Events',
    },
    {
      title: 'The Kitchen',
      subtitle: 'Chef drops, tasting experiences, and culinary storytelling',
      description:
        'A virtual-first culinary program anchored by elevated small plates, recipe content, and limited featured-chef experiences designed to test demand before real-world expansion.',
      cta: 'Explore the Kitchen',
    },
    {
      title: 'The Runway',
      subtitle: 'Fashion in motion',
      description:
        'Monthly runway showcases, designer features, and culture-driven style moments that make Café Sativa feel like a destination, not just a digital venue.',
      cta: 'Get Runway Access',
    },
    {
      title: 'The Smoke Room',
      subtitle: 'A refined smoke experience',
      description:
        'Luxury ambience, premium rituals, and a mood-forward environment shaped for cigar nights, pairings, intimate conversation, and future private lounge programming.',
      cta: 'Step Inside',
    },
    {
      title: 'Cold Stoned',
      subtitle: 'Dessert, gelato, and signature pairings',
      description:
        'A playful but upscale anchor concept for daytime and late-night indulgence, blending gelato, affogatos, dessert moments, and future pairing experiences.',
      cta: 'Discover Cold Stoned',
    },
    {
      title: 'The Gallery',
      subtitle: 'Art, drops, and visual culture',
      description:
        'A curated home for exhibitions, artist spotlights, and digital drops that reinforce Café Sativa as a culture platform first and a physical venue second.',
      cta: 'View the Gallery',
    },
  ];

  const upcomingDrops = [
    {
      type: 'Featured Chef',
      title: 'The Sativa Table: Chef in Residence',
      date: 'Monthly',
      detail:
        'One or two featured chef drops per month with rotating cuisine concepts, limited menus, and RSVP-first access.',
    },
    {
      type: 'Runway Night',
      title: 'Runway at Café Sativa',
      date: 'Monthly',
      detail:
        'Designer showcases and culture-driven fashion programming built to translate cleanly into future in-person events.',
    },
    {
      type: 'Members Experience',
      title: 'Private Sessions',
      date: 'Weekly',
      detail:
        'Premium lounge experiences, members-only content, and high-touch digital activations that warm the audience before launch.',
    },
  ];

  const chefProgram = [
    '1–2 featured chef drops per month',
    'Rotating cuisine formats to test demand before physical buildout',
    'Chef interviews, prep content, tasting previews, and limited RSVP releases',
    'Archive of past chefs to build prestige and social proof over time',
  ];

  const tiers = [
    {
      name: 'Guest List',
      price: 'Free',
      description: 'Enter the world, browse experiences, and get updates on public drops.',
      features: ['Access the virtual lounge', 'Public event previews', 'Gallery browsing', 'Newsletter updates'],
      cta: 'Join Free',
      highlight: false,
    },
    {
      name: 'Insider',
      price: '$9.99/mo',
      description: 'Early access to the best of Café Sativa before everyone else gets the invite.',
      features: ['Early chef drop access', 'Premium event releases', 'Members content', 'Event replay library'],
      cta: 'Become an Insider',
      highlight: true,
    },
    {
      name: 'Founding Guest',
      price: '$24.99/mo',
      description: 'Priority positioning for the people getting in before the doors officially exist.',
      features: ['Everything in Insider', 'VIP-only digital experiences', 'Priority reservation status for future physical openings', 'Exclusive invites and perks'],
      cta: 'Claim Founding Status',
      highlight: false,
    },
  ];

  const stats = [
    { label: 'Virtual-first launch model', value: '01' },
    { label: 'Featured chef drops each month', value: '1–2' },
    { label: 'Core atmosphere drivers', value: '04' },
    { label: 'Paths to monetize before launch', value: '06+' },
  ];

  const visualGallery = [
    {
      title: 'Arrival / Gallery Corridor',
      image:
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80',
    },
    {
      title: 'The Main Lounge',
      image:
        'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1400&q=80',
    },
    {
      title: 'Runway Night',
      image:
        'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1400&q=80',
    },
    {
      title: 'Cold Stoned',
      image:
        'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=1400&q=80',
    },
  ];

  return (
    <main className="min-h-screen bg-[#0d0a09] text-[#f7efe4]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(204,137,63,0.32),transparent_38%),radial-gradient(circle_at_85%_20%,rgba(134,77,28,0.20),transparent_24%),linear-gradient(to_bottom,rgba(0,0,0,0.15),rgba(13,10,9,0.95))]" />
        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#d7a25e]">Café Sativa</p>
            <p className="text-sm text-[#cdb9a1]">Virtual-first hospitality brand</p>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-[#dbc8b0] md:flex">
            <a href="#experience" className="transition hover:text-white">Experience</a>
            <a href="#chef-series" className="transition hover:text-white">Featured Chefs</a>
            <a href="#runway" className="transition hover:text-white">Runway</a>
            <a href="#membership" className="transition hover:text-white">Membership</a>
            <a href="#waitlist" className="transition hover:text-white">Guest List</a>
          </nav>
          <a
            href="#waitlist"
            className="rounded-full border border-[#c8843c] bg-[#c8843c]/10 px-5 py-2 text-sm font-medium text-[#ffd7ad] transition hover:bg-[#c8843c] hover:text-[#1c120d]"
          >
            Join the Guest List
          </a>
        </header>

        <section className="relative z-10 mx-auto grid max-w-7xl gap-10 px-6 pb-20 pt-8 lg:grid-cols-[1.15fr_0.85fr] lg:px-10 lg:pb-28 lg:pt-10">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.25em] text-[#d6b489] backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-[#ffb15e]" />
              Sip • Smoke • Vibe
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-tight text-white md:text-7xl">
              Culture gathers here before the doors even open.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#d4c2aa] md:text-xl">
              Café Sativa is a luxury digital destination blending cuisine, music, fashion, art, and smoke culture into a curated lounge experience that starts online, builds community, validates demand, and evolves into real-world locations.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <a
                href="#waitlist"
                className="rounded-full bg-[#d28c45] px-7 py-4 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#1d120c] transition hover:bg-[#ef9f4c]"
              >
                Become a Founding Guest
              </a>
              <a
                href="#experience"
                className="rounded-full border border-white/15 bg-white/5 px-7 py-4 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#f5e7d5] transition hover:border-white/30 hover:bg-white/10"
              >
                Explore the Venue
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <p className="text-2xl font-semibold text-[#ffd3a0]">{stat.value}</p>
                  <p className="mt-1 text-sm text-[#cab89f]">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-10 top-14 hidden h-40 w-40 rounded-full bg-[#c2772f]/20 blur-3xl lg:block" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#1a120e] shadow-2xl shadow-black/50">
                <img
                  src="https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1400&q=80"
                  alt="Luxury lounge ambience"
                  className="h-[240px] w-full object-cover"
                />
                <div className="p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-[#d3a165]">Live Atmosphere</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">A digital venue with real gravity</h2>
                  <p className="mt-3 text-sm leading-7 text-[#d0bca2]">
                    Cinematic ambience, event energy, and a membership-first world that lets the audience step inside now instead of waiting for a lease to make it real.
                  </p>
                </div>
              </div>
              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#17100c] shadow-2xl shadow-black/50 xl:mt-10">
                <img
                  src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1400&q=80"
                  alt="Runway inside an upscale venue"
                  className="h-[240px] w-full object-cover"
                />
                <div className="p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-[#d3a165]">Brand Edge</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Cuisine, runway, smoke, and sound</h2>
                  <p className="mt-3 text-sm leading-7 text-[#d0bca2]">
                    Not just nightlife. Not just a lounge. Café Sativa is designed as a layered hospitality ecosystem with multiple entry points for attention, revenue, and loyalty.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10" id="experience">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">The experience</p>
          <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">Built as a digital venue now, designed for real-world expansion later.</h2>
          <p className="mt-5 text-lg leading-8 text-[#ceb79b]">
            Each zone is more than a page. It is a proof point for demand, programming, content, and future monetization. The site should feel like a place people can already enter.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {experienceZones.map((zone) => (
            <div key={zone.title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 transition hover:-translate-y-1 hover:border-[#c78947]/50 hover:bg-white/[0.06]">
              <p className="text-xs uppercase tracking-[0.25em] text-[#d09d61]">{zone.subtitle}</p>
              <h3 className="mt-3 text-2xl font-semibold text-white">{zone.title}</h3>
              <p className="mt-4 text-sm leading-7 text-[#cfbaa0]">{zone.description}</p>
              <a href="#waitlist" className="mt-6 inline-block text-sm font-medium text-[#f3c48d] transition hover:text-[#ffd9ae]">
                {zone.cta} →
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#120d0b]" id="chef-series">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">Featured chef series</p>
            <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">The Sativa Table</h2>
            <p className="mt-5 text-lg leading-8 text-[#ceb79b]">
              A recurring culinary spotlight built for the virtual-first phase. Limited chef drops create urgency, prestige, and recurring content while giving the brand clean data on what diners actually want before the physical space opens.
            </p>
            <div className="mt-8 space-y-4">
              {chefProgram.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#d1904d]" />
                  <p className="text-sm leading-7 text-[#dbc5aa]">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#1b120d,#23160f)] p-7 shadow-2xl shadow-black/40">
            <div className="rounded-[1.5rem] border border-[#d1914d]/30 bg-black/20 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-[#d9a56a]">This month</p>
                  <h3 className="mt-2 text-3xl font-semibold text-white">Chef in Residence</h3>
                </div>
                <span className="rounded-full border border-[#d1914d]/40 bg-[#d1914d]/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-[#ffd7ad]">
                  Limited RSVP
                </span>
              </div>
              <div className="mt-8 overflow-hidden rounded-[1.5rem] border border-white/10">
                <img
                  src="https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1400&q=80"
                  alt="Chef plating dishes in an upscale kitchen"
                  className="h-72 w-full object-cover"
                />
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-[#cca06b]">Format</p>
                  <p className="mt-2 text-lg font-medium text-white">1–2 rotating chef drops per month</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-[#cca06b]">Positioning</p>
                  <p className="mt-2 text-lg font-medium text-white">New chefs. Limited menus. No repeats.</p>
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a href="#waitlist" className="rounded-full bg-[#d28c45] px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#1d120c] transition hover:bg-[#eba456]">
                  Reserve Early Access
                </a>
                <a href="#membership" className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#f3e4d3] transition hover:bg-white/10">
                  Join as Insider
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10" id="runway">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#17110e] shadow-2xl shadow-black/40">
            <img
              src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=80"
              alt="Fashion-forward event environment"
              className="h-full min-h-[420px] w-full object-cover"
            />
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">Runway at Café Sativa</p>
            <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">Fashion is not an add-on here. It is part of the experience architecture.</h2>
            <p className="mt-5 text-lg leading-8 text-[#ceb79b]">
              Monthly runway showcases give Café Sativa a cultural advantage most lounge concepts do not have. They create content, ticket moments, brand crossover, and a clear path from digital storytelling to physical event programming.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-medium text-white">Digital-first benefit</p>
                <p className="mt-2 text-sm leading-7 text-[#cfbaa0]">Runway clips, designer highlights, and guest-list scarcity without waiting for full venue buildout.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-medium text-white">Physical-world payoff</p>
                <p className="mt-2 text-sm leading-7 text-[#cfbaa0]">A clean monthly program that folds directly into future in-person fashion nights and designer collaborations.</p>
              </div>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#waitlist" className="rounded-full bg-[#d28c45] px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#1d120c] transition hover:bg-[#ef9f4c]">
                Get Runway Access
              </a>
              <a href="#visual-world" className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-center text-sm font-semibold uppercase tracking-[0.22em] text-[#f3e4d3] transition hover:bg-white/10">
                View the World
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#120c0a]" id="visual-world">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">The world of Café Sativa</p>
            <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">Make the audience feel the place before the place exists.</h2>
            <p className="mt-5 text-lg leading-8 text-[#ceb79b]">
              Use cinematic mockups, runway visuals, food moments, and atmosphere-first imagery to make the virtual presence feel tangible, desirable, and share-worthy from the first scroll.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {visualGallery.map((item) => (
              <div key={item.title} className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03]">
                <img src={item.image} alt={item.title} className="h-64 w-full object-cover" />
                <div className="p-4">
                  <p className="text-sm font-medium text-white">{item.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-3">
          {upcomingDrops.map((drop) => (
            <div key={drop.title} className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-[#d39a60]">{drop.type}</p>
              <h3 className="mt-3 text-2xl font-semibold text-white">{drop.title}</h3>
              <p className="mt-2 text-sm text-[#e5c79f]">{drop.date}</p>
              <p className="mt-4 text-sm leading-7 text-[#d4bea1]">{drop.detail}</p>
              <a href="#waitlist" className="mt-6 inline-block text-sm font-medium text-[#ffd3a3] transition hover:text-[#ffe2c2]">
                Request access →
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10" id="membership">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">Membership</p>
          <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">Turn curiosity into a guest list. Turn the guest list into a movement.</h2>
          <p className="mt-5 text-lg leading-8 text-[#ceb79b]">
            The early goal is not just traffic. It is capture, loyalty, and proof. Membership should feel like getting closer to something special before the rest of the market realizes what is happening.
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-[2rem] border p-7 shadow-2xl shadow-black/20 ${
                tier.highlight
                  ? 'border-[#d08e49] bg-[linear-gradient(180deg,rgba(208,142,73,0.18),rgba(255,255,255,0.04))]'
                  : 'border-white/10 bg-white/[0.04]'
              }`}
            >
              <p className="text-xs uppercase tracking-[0.25em] text-[#d5a266]">{tier.name}</p>
              <h3 className="mt-3 text-4xl font-semibold text-white">{tier.price}</h3>
              <p className="mt-4 text-sm leading-7 text-[#d0baa0]">{tier.description}</p>
              <ul className="mt-6 space-y-3 text-sm text-[#ead6bb]">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[#d08e49]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#waitlist"
                className={`mt-8 inline-block w-full rounded-full px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.22em] transition ${
                  tier.highlight
                    ? 'bg-[#d08e49] text-[#1b120d] hover:bg-[#eea75a]'
                    : 'border border-white/15 bg-white/5 text-[#f4e5d2] hover:bg-white/10'
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[linear-gradient(180deg,#160f0c,#0d0a09)]" id="waitlist">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#c78947]">Founding guest list</p>
            <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">Get in before the doors are real.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#ceb79b]">
              Join the list for featured chef drops, runway announcements, member experiences, opening updates, and priority access when Café Sativa activates in the physical world.
            </p>
            <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6">
              <p className="text-sm leading-7 text-[#d6c0a6]">
                This is the engine. Email and SMS capture matter more than vanity traffic right now. Every chef feature, runway release, and members experience should feed this list.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7 shadow-2xl shadow-black/30">
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const payload = {
                  name: formData.get('name'),
                  email: formData.get('email'),
                  phone: formData.get('phone'),
                  interest: formData.get('interest'),
                };

                try {
                  const res = await fetch('/api/waitlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });

                  if (res.ok) {
                    alert('You are on the list. Welcome to Café Sativa.');
                    e.currentTarget.reset();
                  } else {
                    alert('Something went wrong. Try again.');
                  }
                } catch (err) {
                  alert('Network error. Try again.');
                }
              }}
            >
              <div>
                <label className="mb-2 block text-sm text-[#e8d5bc]">Full Name</label>
                <input
                  name="name"
                  required
                  className="w-full rounded-2xl border border-white/10 bg-[#130e0b] px-4 py-3 text-white outline-none transition placeholder:text-[#8d7860] focus:border-[#d08e49]"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e8d5bc]">Email</label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-2xl border border-white/10 bg-[#130e0b] px-4 py-3 text-white outline-none transition placeholder:text-[#8d7860] focus:border-[#d08e49]"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e8d5bc]">Phone</label>
                <input
                  name="phone"
                  type="tel"
                  className="w-full rounded-2xl border border-white/10 bg-[#130e0b] px-4 py-3 text-white outline-none transition placeholder:text-[#8d7860] focus:border-[#d08e49]"
                  placeholder="Optional for SMS updates"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e8d5bc]">What do you want first?</label>
                <select
                  name="interest"
                  className="w-full rounded-2xl border border-white/10 bg-[#130e0b] px-4 py-3 text-white outline-none transition focus:border-[#d08e49]"
                >
                  <option>Featured chef drops</option>
                  <option>Runway nights</option>
                  <option>Membership updates</option>
                  <option>Cold Stoned releases</option>
                  <option>Opening updates</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-[#d08e49] px-6 py-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#1c120d] transition hover:bg-[#eea75a]"
              >
                Join the Guest List
              </button>
              <p className="text-xs leading-6 text-[#a99379]">
                By joining, you agree to receive launch updates, curated event announcements, and priority-access invitations from Café Sativa.
              </p>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
