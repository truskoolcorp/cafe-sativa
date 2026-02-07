import './globals.css'
import type { Metadata } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import Link from 'next/link'

const playfair = Playfair_Display({ 
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Virtual Café Sativa® | Experience the Culture Before the Doors Open',
  description: 'Join our virtual lounge for live events, art exhibitions, cooking classes, cigar tastings, and community. Opening in Tenerife 2026. Sip • Smoke • Vibe',
  keywords: ['Virtual Café Sativa', 'online lounge', 'virtual events', 'art gallery', 'cooking classes', 'cigar lounge', 'cultural community', 'Tenerife 2026'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="font-sans">
        {/* Navigation */}
        <nav className="fixed top-0 w-full z-50 bg-[#2B1810] bg-opacity-95 backdrop-blur-sm border-b border-[#5C4033]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-20">
              <Link href="/" className="text-[#C9A961] text-xl md:text-2xl font-serif tracking-wide hover:text-[#F5E6D3] transition-colors flex items-center gap-2">
                <span className="text-2xl">☕</span>
                <span>CAFÉ SATIVA®</span>
              </Link>
              
              <div className="hidden md:flex space-x-8">
                <Link href="/" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  Home
                </Link>
                <Link href="/stage" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  The Stage
                </Link>
                <Link href="/gallery" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  Gallery
                </Link>
                <Link href="/kitchen" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  Kitchen
                </Link>
                <Link href="/cigar-lounge" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  Cigar Lounge
                </Link>
                <Link href="/lounge" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">
                  Community
                </Link>
                <Link href="/membership" className="bg-[#C9A961] text-[#2B1810] px-4 py-2 rounded-sm hover:bg-[#F5E6D3] transition-colors font-semibold">
                  Join
                </Link>
              </div>

              {/* Mobile menu button */}
              <button className="md:hidden text-[#C9A961]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <div className="pt-20">
          {children}
        </div>

        {/* Footer */}
        <footer className="bg-[#2B1810] border-t border-[#5C4033] py-12 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-4 gap-8 mb-8">
              {/* Brand */}
              <div className="md:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-3xl">☕</span>
                  <h3 className="text-[#C9A961] text-2xl font-serif">CAFÉ SATIVA®</h3>
                </div>
                <p className="text-[#F5E6D3] mb-4">
                  Where Nordic Wellness Meets Canary Island Culture
                </p>
                <p className="text-[#C9A961] text-sm">
                  Virtual Venue • Physical Location Coming 2026
                </p>
              </div>

              {/* Quick Links */}
              <div>
                <h4 className="text-[#C9A961] font-semibold mb-4 uppercase tracking-wider">Explore</h4>
                <ul className="space-y-2">
                  <li><Link href="/stage" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">The Stage</Link></li>
                  <li><Link href="/gallery" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">The Gallery</Link></li>
                  <li><Link href="/kitchen" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">The Kitchen</Link></li>
                  <li><Link href="/cigar-lounge" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Cigar Lounge</Link></li>
                  <li><Link href="/lounge" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Community</Link></li>
                </ul>
              </div>

              {/* Connect */}
              <div>
                <h4 className="text-[#C9A961] font-semibold mb-4 uppercase tracking-wider">Connect</h4>
                <ul className="space-y-2">
                  <li><a href="https://instagram.com/cafesativa" target="_blank" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Instagram</a></li>
                  <li><a href="https://facebook.com/cafesativa" target="_blank" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Facebook</a></li>
                  <li><a href="https://tiktok.com/@cafesativa" target="_blank" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">TikTok</a></li>
                  <li><Link href="/contact" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Contact Us</Link></li>
                </ul>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="border-t border-[#5C4033] pt-8 flex flex-col md:flex-row justify-between items-center">
              <p className="text-[#F5E6D3] text-sm mb-4 md:mb-0">
                © 2026 Café Sativa®. All rights reserved. A registered U.S. LLC.
              </p>
              <div className="flex space-x-6 text-sm">
                <Link href="/privacy" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="text-[#F5E6D3] hover:text-[#C9A961] transition-colors">Terms of Service</Link>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
