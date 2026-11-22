import type { Metadata } from 'next'

const venueOrigin = 'https://www.cafe-sativa.com'

type PublicStageListing = {
  slug: string
  title: string
  description: string
  // Previously approved public still. Never use a performance, relay or replay URL.
  artwork: { fileName: string; alt: string; width: number; height: number }
}

export function publicStageMetadata({ slug, title, description, artwork }: PublicStageListing): Metadata {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid public Stage slug')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.(webp|jpg|jpeg|png)$/.test(artwork.fileName)) {
    throw new Error('Invalid public Stage artwork filename')
  }

  const canonical = `${venueOrigin}/events/${slug}`
  const url = `${venueOrigin}/events/${artwork.fileName}`
  const shareTitle = `${title} | Café Sativa`
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website', siteName: 'Café Sativa', title: shareTitle, description, url: canonical,
      images: [{ url, alt: artwork.alt, width: artwork.width, height: artwork.height }],
    },
    twitter: {
      card: 'summary_large_image', title: shareTitle, description, images: [{ url, alt: artwork.alt }],
    },
  }
}
