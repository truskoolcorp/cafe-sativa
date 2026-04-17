import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cafe Sativa | Virtual-First Hospitality Brand',
  description:
    'Cafe Sativa is a virtual-first hospitality brand blending cuisine, music, fashion, art, and smoke culture into a curated lounge experience.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
