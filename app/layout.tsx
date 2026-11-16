import './globals.css'
import './fonts.css'
import type { Metadata } from 'next'
import Script from 'next/script'
import { Navbar } from '@/components/site/Navbar'
import { Footer } from '@/components/site/Footer'

// Pinned local WOFF2 files keep builds independent of Google CSS URL formats.
// fonts.css preserves the existing families, weights, subsets and variables.

export const metadata: Metadata = {
  title: {
    default: 'Café Sativa — Where Culture Gathers',
    template: '%s | Café Sativa',
  },
  description:
    'Café Sativa is a virtual-first cultural venue. Live events, cooking classes, cigar tastings, art, and community — where Nordic wellness meets Canary Island culture. Physical venue planned for Tenerife, Spain in 2027; opening date to be confirmed.',
  openGraph: {
    title: 'Café Sativa — Where Culture Gathers',
    description:
      'A virtual-first cultural venue. Live events, cooking classes, cigar tastings, art, and community. Physical venue planned for Tenerife in 2027; date to be confirmed.',
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
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/playfair-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
        <Script
          id="metricool-cafe-sativa"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=document.createElement('script');s.src='https://tracker.metricool.com/resources/be.js';s.onload=function(){if(window.beTracker)window.beTracker.t({hash:'a0d4d05a33de207c57b5029ffc12d1e0'});};document.head.appendChild(s);})();`,
          }}
        />
      </body>
    </html>
  )
}
