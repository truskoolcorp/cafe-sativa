import './globals.css'
import type { Metadata } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import { Navbar } from '@/components/site/Navbar'
import { Footer } from '@/components/site/Footer'

// Load fonts at build time, scoped to CSS variables that our Tailwind
// config consumes via --font-playfair / --font-inter. `display: 'swap'`
// means we show fallback fonts immediately and swap when the real ones
// load, rather than blocking render. subsets:'latin' is all we need for
// English copy; add 'latin-ext' later if we introduce Spanish characters
// with accents that aren't in the base set (we mostly don't).
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Café Sativa — Where Culture Gathers',
    template: '%s | Café Sativa',
  },
  description:
    'Café Sativa is a virtual-first cultural venue. Live events, cooking classes, cigar tastings, art, and community — where Nordic wellness meets Canary Island culture. Physical location opening Tenerife, Spain 2026.',
  openGraph: {
    title: 'Café Sativa — Where Culture Gathers',
    description:
      'A virtual-first cultural venue. Live events, cooking classes, cigar tastings, art, and community. Tenerife 2026.',
    type: 'website',
    url: 'https://www.cafe-sativa.com',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
