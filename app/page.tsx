import Image from 'next/image'
import Link from 'next/link'

export default function VirtualCafePage() {
  return (
    <main className="min-h-screen bg-[#2B1810]">
      
      {/* Hero/Entrance Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-[#2B1810] to-[#5C4033]" />
        
        {/* Smoke effect overlay */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-gradient-to-t from-transparent via-[#C9A961] to-transparent animate-pulse" 
               style={{ animationDuration: '4s' }} />
        </div>

        <div className="relative z-10 text-center px-4 max-w-6xl mx-auto">
          {/* Logo - Text Version */}
          <div className="mb-8 animate-fadeIn">
            <div className="text-center">
              <div className="text-8xl mb-4">☕</div>
              <div className="text-[#C9A961] text-3xl font-serif tracking-widest">CAFÉ SATIVA®</div>
            </div>
          </div>

          {/* Main Title */}
          <h1 className="text-[#F5E6D3] text-5xl md:text-7xl font-serif mb-4 tracking-wide">
            WELCOME TO
          </h1>
          <h2 className="text-[#C9A961] text-6xl md:text-8xl font-serif mb-6 tracking-wider">
            VIRTUAL CAFÉ SATIVA
          </h2>
          
          <p className="text-[#F5E6D3] text-xl md:text-2xl mb-4 font-light max-w-3xl mx-auto">
            Where Culture Gathers Before the Doors Open
          </p>
          
          <p className="text-[#C9A961] text-lg mb-12 tracking-widest">
            SIP • SMOKE • VIBE
          </p>

          {/* Status Badge */}
          <div className="inline-block bg-[#5C4033] border-2 border-[#C9A961] rounded-lg px-6 py-3 mb-12">
            <p className="text-[#C9A961] text-sm uppercase tracking-wider">
              🔴 LIVE NOW • 247 People Inside
            </p>
          </div>

          {/* Enter Button */}
          <div className="mb-16">
            <Link 
              href="/lounge" 
              className="inline-block bg-[#C9A961] text-[#2B1810] px-16 py-5 rounded-sm text-xl font-bold hover:bg-[#F5E6D3] transition-all transform hover:scale-105 uppercase tracking-wider shadow-2xl"
            >
              Enter The Lounge
            </Link>
            <p className="text-[#F5E6D3] text-sm mt-4 opacity-75">
              Free to explore • Premium access available
            </p>
          </div>

          {/* Coming to Tenerife */}
          <div className="border-t border-[#5C4033] pt-8">
            <p className="text-[#F5E6D3] text-lg mb-2">
              Physical Venue Opening
            </p>
            <p className="text-[#C9A961] text-2xl font-serif">
              Tenerife, Spain • 2026
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
          <p className="text-[#C9A961] text-sm mb-2 uppercase tracking-wider">Explore Below</p>
          <svg className="w-6 h-6 text-[#C9A961] mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* What's Inside Section */}
      <section className="py-24 px-4 bg-[#5C4033]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-[#C9A961] text-5xl font-serif mb-6 text-center">
            Explore The Venue
          </h2>
          <p className="text-[#F5E6D3] text-xl text-center mb-16 max-w-3xl mx-auto">
            Navigate through our virtual spaces - each offering unique experiences, 
            live events, and opportunities to connect with culture.
          </p>

          {/* Venue Map/Rooms Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* The Stage */}
            <Link href="/stage" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#8B9D83] to-[#C07855] flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🎭</div>
                    <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block">
                      LIVE NOW
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Stage</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    "At The Table" interview series + live music performances
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    Next: Chef Maria Santos • Tonight 8PM EST
                  </p>
                </div>
              </div>
            </Link>

            {/* The Gallery */}
            <Link href="/gallery" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#C07855] to-[#5C4033] flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🎨</div>
                    <div className="bg-[#C9A961] text-[#2B1810] px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block">
                      NEW EXHIBITION
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Gallery</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    Art exhibitions, buy/sell original work, artist spotlights
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    Current: "Digital Dreams" • 23 pieces available
                  </p>
                </div>
              </div>
            </Link>

            {/* The Kitchen */}
            <Link href="/kitchen" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#8B9D83] to-[#C9A961] flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">👨‍🍳</div>
                    <div className="bg-orange-600 text-white px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block">
                      CLASS MONDAY
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Kitchen</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    Live cooking classes with international chefs, recipes, techniques
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    Next: Nordic-Spanish Fusion • Mon 7PM EST • $25
                  </p>
                </div>
              </div>
            </Link>

            {/* The Cigar Lounge */}
            <Link href="/cigar-lounge" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#5C4033] to-black flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">💨</div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Cigar Lounge</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    Tastings, ratings, ASMR sessions, expert recommendations
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    This Week: Cuban vs. Dominican Showdown
                  </p>
                </div>
              </div>
            </Link>

            {/* The Bar */}
            <Link href="/bar" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#C9A961] to-[#C07855] flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🍸</div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Bar</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    Signature cocktails, mixology classes, spirit education
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    Cocktail of the Week: Canary Island Old Fashioned
                  </p>
                </div>
              </div>
            </Link>

            {/* The Lounge (Community) */}
            <Link href="/lounge" className="group">
              <div className="bg-[#2B1810] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300 border-2 border-transparent hover:border-[#C9A961]">
                <div className="relative h-64 bg-gradient-to-br from-[#8B9D83] to-[#5C4033] flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4">💬</div>
                    <div className="bg-green-600 text-white px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block">
                      247 ONLINE
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-[#C9A961] text-2xl font-serif mb-2">The Lounge</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    Community hub, social chat, member connections, discussions
                  </p>
                  <p className="text-[#C9A961] text-sm">
                    Join the conversation • Free access
                  </p>
                </div>
              </div>
            </Link>

          </div>
        </div>
      </section>

      {/* Live Schedule Section */}
      <section className="py-24 px-4 bg-[#2B1810]">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-[#C9A961] text-5xl font-serif mb-6 text-center">
            This Week at Café Sativa
          </h2>
          <p className="text-[#F5E6D3] text-xl text-center mb-16">
            Live events, classes, and experiences happening now
          </p>

          {/* Weekly Schedule */}
          <div className="space-y-4">
            
            {/* Today */}
            <div className="bg-[#5C4033] border-2 border-[#C9A961] rounded-lg p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs uppercase tracking-wider">
                    LIVE NOW
                  </div>
                  <div>
                    <p className="text-[#C9A961] text-sm uppercase tracking-wider mb-1">Today • 8:00 PM EST</p>
                    <h3 className="text-[#F5E6D3] text-xl font-serif">At The Table: Chef Maria Santos</h3>
                    <p className="text-[#F5E6D3] opacity-75 text-sm">The Stage • Interview & Cooking Demo</p>
                  </div>
                </div>
                <Link 
                  href="/stage/live" 
                  className="bg-[#C9A961] text-[#2B1810] px-8 py-3 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider text-center"
                >
                  Join Live
                </Link>
              </div>
            </div>

            {/* Monday */}
            <div className="bg-[#5C4033] rounded-lg p-6 hover:border-2 hover:border-[#C9A961] transition-all">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-[#C9A961] text-sm uppercase tracking-wider mb-1">Monday • 7:00 PM EST</p>
                  <h3 className="text-[#F5E6D3] text-xl font-serif">Nordic-Spanish Fusion Cooking Class</h3>
                  <p className="text-[#F5E6D3] opacity-75 text-sm">The Kitchen • With Chef Maria & Eureka • $25</p>
                </div>
                <Link 
                  href="/kitchen/class-001" 
                  className="border-2 border-[#C9A961] text-[#C9A961] px-8 py-3 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-center"
                >
                  Get Ticket
                </Link>
              </div>
            </div>

            {/* Tuesday */}
            <div className="bg-[#5C4033] rounded-lg p-6 hover:border-2 hover:border-[#C9A961] transition-all">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-[#C9A961] text-sm uppercase tracking-wider mb-1">Tuesday • 8:00 PM EST</p>
                  <h3 className="text-[#F5E6D3] text-xl font-serif">Cigar & Whiskey Pairing Experience</h3>
                  <p className="text-[#F5E6D3] opacity-75 text-sm">Cigar Lounge • Expert-Led Tasting • Free</p>
                </div>
                <Link 
                  href="/cigar-lounge/events" 
                  className="border-2 border-[#C9A961] text-[#C9A961] px-8 py-3 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-center"
                >
                  RSVP Free
                </Link>
              </div>
            </div>

            {/* Friday */}
            <div className="bg-[#5C4033] rounded-lg p-6 hover:border-2 hover:border-[#C9A961] transition-all">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-[#C9A961] text-sm uppercase tracking-wider mb-1">Friday • 9:00 PM EST</p>
                  <h3 className="text-[#F5E6D3] text-xl font-serif">Live Music: Ahnika Merlot Performance</h3>
                  <p className="text-[#F5E6D3] opacity-75 text-sm">The Stage • Exclusive Set • Members Only</p>
                </div>
                <Link 
                  href="/membership" 
                  className="bg-gradient-to-r from-[#C9A961] to-[#C07855] text-[#2B1810] px-8 py-3 rounded-sm font-semibold hover:opacity-90 transition-opacity uppercase tracking-wider text-center"
                >
                  Become Member
                </Link>
              </div>
            </div>

            {/* Saturday */}
            <div className="bg-[#5C4033] rounded-lg p-6 hover:border-2 hover:border-[#C9A961] transition-all">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-[#C9A961] text-sm uppercase tracking-wider mb-1">Saturday • 4:00 PM EST</p>
                  <h3 className="text-[#F5E6D3] text-xl font-serif">Gallery Opening: "Digital Dreams" Exhibition</h3>
                  <p className="text-[#F5E6D3] opacity-75 text-sm">The Gallery • 25 Artists • Art Available for Purchase</p>
                </div>
                <Link 
                  href="/gallery/exhibitions/digital-dreams" 
                  className="border-2 border-[#C9A961] text-[#C9A961] px-8 py-3 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-center"
                >
                  View Art
                </Link>
              </div>
            </div>

          </div>

          {/* View Full Calendar */}
          <div className="text-center mt-12">
            <Link 
              href="/calendar" 
              className="inline-block text-[#C9A961] hover:text-[#F5E6D3] transition-colors text-lg"
            >
              View Full Calendar →
            </Link>
          </div>
        </div>
      </section>

      {/* Membership CTA Section */}
      <section className="py-24 px-4 bg-gradient-to-br from-[#5C4033] to-[#2B1810]">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-[#C9A961] text-5xl font-serif mb-6">
            Become a Member
          </h2>
          <p className="text-[#F5E6D3] text-xl mb-12 max-w-3xl mx-auto">
            Full access to all venues, exclusive events, early ticket access, 
            art marketplace, and priority seating when Tenerife opens in 2026.
          </p>

          {/* Membership Tiers */}
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            
            {/* Free */}
            <div className="bg-[#2B1810] rounded-lg p-8 border-2 border-[#5C4033]">
              <h3 className="text-[#F5E6D3] text-2xl font-serif mb-2">Explorer</h3>
              <p className="text-[#C9A961] text-4xl font-bold mb-6">FREE</p>
              <ul className="text-[#F5E6D3] text-left space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Access to The Lounge</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Browse The Gallery</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Select free events</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Shop merch</span>
                </li>
              </ul>
              <Link 
                href="/lounge" 
                className="block w-full border-2 border-[#C9A961] text-[#C9A961] py-3 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider"
              >
                Enter Free
              </Link>
            </div>

            {/* Regular Member */}
            <div className="bg-[#2B1810] rounded-lg p-8 border-2 border-[#C9A961] transform md:scale-105">
              <div className="bg-[#C9A961] text-[#2B1810] px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block mb-4">
                MOST POPULAR
              </div>
              <h3 className="text-[#F5E6D3] text-2xl font-serif mb-2">Regular</h3>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">$9.99</p>
              <p className="text-[#F5E6D3] text-sm mb-6 opacity-75">/month</p>
              <ul className="text-[#F5E6D3] text-left space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Everything in Explorer</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>All live events access</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Buy/sell in Art Gallery</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Event recordings library</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Member badge & perks</span>
                </li>
              </ul>
              <Link 
                href="/membership/regular" 
                className="block w-full bg-[#C9A961] text-[#2B1810] py-3 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider"
              >
                Join Now
              </Link>
            </div>

            {/* VIP */}
            <div className="bg-[#2B1810] rounded-lg p-8 border-2 border-[#C07855]">
              <div className="bg-gradient-to-r from-[#C9A961] to-[#C07855] text-[#2B1810] px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block mb-4">
                VIP EXPERIENCE
              </div>
              <h3 className="text-[#F5E6D3] text-2xl font-serif mb-2">VIP</h3>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">$24.99</p>
              <p className="text-[#F5E6D3] text-sm mb-6 opacity-75">/month</p>
              <ul className="text-[#F5E6D3] text-left space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Everything in Regular</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Exclusive VIP-only events</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Priority guest Q&A access</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>20% merch discount</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">✓</span>
                  <span>Priority seating (Tenerife 2026)</span>
                </li>
              </ul>
              <Link 
                href="/membership/vip" 
                className="block w-full bg-gradient-to-r from-[#C9A961] to-[#C07855] text-[#2B1810] py-3 rounded-sm font-semibold hover:opacity-90 transition-opacity uppercase tracking-wider"
              >
                Go VIP
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4 bg-[#2B1810] border-y border-[#5C4033]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-[#C9A961] text-5xl font-bold mb-2">2.1K+</p>
              <p className="text-[#F5E6D3]">Community Members</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-5xl font-bold mb-2">47</p>
              <p className="text-[#F5E6D3]">Live Events Hosted</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-5xl font-bold mb-2">156</p>
              <p className="text-[#F5E6D3]">Artworks Sold</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-5xl font-bold mb-2">89min</p>
              <p className="text-[#F5E6D3]">Avg. Session Time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Newsletter Section */}
      <section className="py-24 px-4 bg-[#5C4033]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[#C9A961] text-4xl font-serif mb-6">
            Never Miss a Session
          </h2>
          <p className="text-[#F5E6D3] text-lg mb-8">
            Get weekly event updates, exclusive content, and early access to special experiences.
          </p>
          <form className="flex flex-col md:flex-row gap-4 max-w-lg mx-auto">
            <input 
              type="email" 
              placeholder="Your email address" 
              className="flex-1 px-6 py-4 rounded-sm bg-[#2B1810] text-[#F5E6D3] placeholder-[#C9A961] focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
            />
            <button 
              type="submit" 
              className="bg-[#C9A961] text-[#2B1810] px-10 py-4 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider whitespace-nowrap"
            >
              Subscribe
            </button>
          </form>
        </div>
      </section>

    </main>
  )
}
