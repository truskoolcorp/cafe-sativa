import Link from 'next/link'

// Mock data - will be replaced with backend
const liveMembers = [
  { id: 1, name: "Alex Rivera", avatar: "AR", status: "online", room: "The Stage", badge: "VIP" },
  { id: 2, name: "Sofia Chen", avatar: "SC", status: "online", room: "The Gallery", badge: "Regular" },
  { id: 3, name: "Marcus Williams", avatar: "MW", status: "online", room: "Cigar Lounge", badge: "VIP" },
  { id: 4, name: "Elena Torres", avatar: "ET", status: "online", room: "The Kitchen", badge: "Regular" },
  { id: 5, name: "David Kim", avatar: "DK", status: "online", room: "The Bar", badge: "Regular" },
]

const recentMessages = [
  { id: 1, user: "Sofia Chen", message: "Just bought my first piece from the gallery! So excited!", time: "2 min ago", channel: "general" },
  { id: 2, user: "Marcus Williams", message: "Tonight's cigar pairing was incredible. That Cuban was 🔥", time: "5 min ago", channel: "cigar-lounge" },
  { id: 3, user: "Elena Torres", message: "Who's joining the cooking class on Monday?", time: "8 min ago", channel: "kitchen" },
  { id: 4, user: "Alex Rivera", message: "Can't wait for Chef Maria's interview tonight!", time: "12 min ago", channel: "stage" },
]

export default function LoungePage() {
  return (
    <main className="min-h-screen bg-[#2B1810]">
      
      {/* Header */}
      <section className="py-16 px-4 bg-gradient-to-b from-[#5C4033] to-[#2B1810] border-b border-[#C9A961]">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-[#C9A961] text-5xl md:text-6xl font-serif mb-2">
                The Lounge
              </h1>
              <p className="text-[#F5E6D3] text-xl">
                Community Hub • Where Everyone Gathers
              </p>
            </div>
            <div className="text-right">
              <div className="inline-block bg-green-600 text-white px-4 py-2 rounded-full text-sm uppercase tracking-wider mb-2">
                🟢 247 ONLINE
              </div>
              <p className="text-[#F5E6D3] text-sm">
                2,134 Total Members
              </p>
            </div>
          </div>

          {/* Quick Nav */}
          <div className="flex flex-wrap gap-4">
            <Link href="/lounge" className="bg-[#C9A961] text-[#2B1810] px-6 py-2 rounded-sm font-semibold uppercase tracking-wider text-sm">
              General Chat
            </Link>
            <Link href="/lounge/stage" className="bg-[#5C4033] border-2 border-[#C9A961] text-[#C9A961] px-6 py-2 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-sm">
              #stage
            </Link>
            <Link href="/lounge/gallery" className="bg-[#5C4033] border-2 border-[#C9A961] text-[#C9A961] px-6 py-2 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-sm">
              #gallery
            </Link>
            <Link href="/lounge/kitchen" className="bg-[#5C4033] border-2 border-[#C9A961] text-[#C9A961] px-6 py-2 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-sm">
              #kitchen
            </Link>
            <Link href="/lounge/cigars" className="bg-[#5C4033] border-2 border-[#C9A961] text-[#C9A961] px-6 py-2 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider text-sm">
              #cigar-lounge
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* Main Chat Area */}
          <div className="lg:col-span-2">
            <div className="bg-[#5C4033] rounded-lg p-6 min-h-[600px] flex flex-col">
              {/* Channel Header */}
              <div className="border-b border-[#C9A961] pb-4 mb-4">
                <h2 className="text-[#C9A961] text-2xl font-serif mb-1">#general</h2>
                <p className="text-[#F5E6D3] text-sm opacity-75">
                  The main gathering space - all topics welcome
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {recentMessages.map((msg) => (
                  <div key={msg.id} className="group">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#C9A961] flex items-center justify-center text-[#2B1810] font-bold flex-shrink-0">
                        {msg.user.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[#C9A961] font-semibold">{msg.user}</span>
                          <span className="text-[#F5E6D3] text-xs opacity-50">{msg.time}</span>
                        </div>
                        <p className="text-[#F5E6D3]">{msg.message}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Welcome Message for New Users */}
                <div className="bg-[#2B1810] border-2 border-[#C9A961] rounded-lg p-6 my-4">
                  <h3 className="text-[#C9A961] text-lg font-semibold mb-2">👋 Welcome to The Lounge!</h3>
                  <p className="text-[#F5E6D3] mb-4">
                    This is a demo of the chat interface. In the full version, you'll be able to:
                  </p>
                  <ul className="text-[#F5E6D3] space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-[#C9A961]">✓</span>
                      <span>Send messages and join conversations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#C9A961]">✓</span>
                      <span>React to messages with emojis</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#C9A961]">✓</span>
                      <span>Share images, videos, and links</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#C9A961]">✓</span>
                      <span>Direct message other members</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#C9A961]">✓</span>
                      <span>Get notifications for @mentions</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Message Input */}
              <div className="border-t border-[#C9A961] pt-4">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Message #general..." 
                    disabled
                    className="flex-1 px-4 py-3 rounded-sm bg-[#2B1810] text-[#F5E6D3] placeholder-[#C9A961] opacity-50 cursor-not-allowed"
                  />
                  <button 
                    disabled
                    className="bg-[#C9A961] text-[#2B1810] px-6 py-3 rounded-sm font-semibold opacity-50 cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
                <p className="text-[#C9A961] text-xs mt-2 text-center">
                  💡 Sign in to participate in chat
                </p>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            
            {/* Who's Online */}
            <div className="bg-[#5C4033] rounded-lg p-6">
              <h3 className="text-[#C9A961] text-xl font-serif mb-4">Who's Here</h3>
              <div className="space-y-3">
                {liveMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 p-2 hover:bg-[#2B1810] rounded transition-colors cursor-pointer">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-[#C9A961] flex items-center justify-center text-[#2B1810] font-bold">
                        {member.avatar}
                      </div>
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#5C4033]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[#F5E6D3] font-semibold text-sm">{member.name}</p>
                        {member.badge === "VIP" && (
                          <span className="bg-gradient-to-r from-[#C9A961] to-[#C07855] text-[#2B1810] px-2 py-0.5 rounded text-xs font-bold">
                            VIP
                          </span>
                        )}
                      </div>
                      <p className="text-[#C9A961] text-xs">in {member.room}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-4 text-[#C9A961] hover:text-[#F5E6D3] text-sm transition-colors">
                View All (247) →
              </button>
            </div>

            {/* Happening Now */}
            <div className="bg-[#5C4033] rounded-lg p-6">
              <h3 className="text-[#C9A961] text-xl font-serif mb-4">Happening Now</h3>
              <div className="space-y-4">
                <Link href="/stage/live" className="block">
                  <div className="bg-[#2B1810] rounded-lg p-4 hover:border-2 hover:border-[#C9A961] transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                      <span className="text-red-600 text-xs uppercase font-bold">LIVE</span>
                    </div>
                    <h4 className="text-[#F5E6D3] font-semibold mb-1">Chef Maria Interview</h4>
                    <p className="text-[#C9A961] text-xs">The Stage • 143 watching</p>
                  </div>
                </Link>

                <div className="bg-[#2B1810] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#C9A961] text-xs uppercase font-bold">SOON</span>
                  </div>
                  <h4 className="text-[#F5E6D3] font-semibold mb-1">Cigar Tasting</h4>
                  <p className="text-[#C9A961] text-xs">In 45 minutes • Cigar Lounge</p>
                </div>
              </div>
            </div>

            {/* Community Rules */}
            <div className="bg-[#5C4033] rounded-lg p-6">
              <h3 className="text-[#C9A961] text-xl font-serif mb-4">Community Guidelines</h3>
              <ul className="text-[#F5E6D3] space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">•</span>
                  <span>Be respectful and welcoming</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">•</span>
                  <span>Share your passions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">•</span>
                  <span>Support fellow members</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#C9A961]">•</span>
                  <span>Keep it cultural, creative, chill</span>
                </li>
              </ul>
            </div>

          </div>

        </div>
      </div>

      {/* Membership CTA */}
      <section className="py-16 px-4 bg-[#5C4033] mt-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-[#C9A961] text-4xl font-serif mb-4">
            Ready to Join the Conversation?
          </h2>
          <p className="text-[#F5E6D3] text-lg mb-8">
            Become a member to unlock full chat access, events, and exclusive experiences.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              href="/membership/regular" 
              className="bg-[#C9A961] text-[#2B1810] px-10 py-4 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider"
            >
              Become a Member
            </Link>
            <Link 
              href="/" 
              className="border-2 border-[#C9A961] text-[#C9A961] px-10 py-4 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider"
            >
              Explore Other Venues
            </Link>
          </div>
        </div>
      </section>

    </main>
  )
}
