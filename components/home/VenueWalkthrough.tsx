/** Owner-approved full walkthrough. The player loads media only on request. */
export function VenueWalkthrough() {
  return (
    <section id="walkthrough" aria-labelledby="walkthrough-heading" className="scroll-mt-24 py-16 md:py-24 border-b border-border/40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">SIP | SMOKE | VIBE</p>
        <h2 id="walkthrough-heading" className="font-heading text-3xl md:text-5xl font-bold">Step inside Café Sativa</h2>
        <p id="walkthrough-description" className="mt-4 mb-8 max-w-2xl text-muted-foreground leading-relaxed">Take a guided tour with Keith and our hosts—from music and art to the kitchen, cigar lounge, and conversations at the table.</p>
        <video
          controls
          playsInline
          preload="none"
          poster="/rooms/venue.webp"
          aria-label="Café Sativa full venue walkthrough"
          aria-describedby="walkthrough-description"
          className="aspect-video w-full rounded-xl border border-border bg-black object-contain shadow-xl"
        >
          <source src="/api/venue-walkthrough" type="video/mp4" />
          Your browser does not support embedded video. <a href="/api/venue-walkthrough">Watch the walkthrough</a>.
        </video>
      </div>
    </section>
  )
}
