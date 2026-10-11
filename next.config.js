/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/api/content/social/delivery': ['./node_modules/@ffmpeg-installer/linux-x64/ffmpeg'],
      '/api/content/site': ['./node_modules/@ffmpeg-installer/linux-x64/ffmpeg'],
      '/api/content/cron': ['./node_modules/@ffmpeg-installer/linux-x64/ffmpeg'],
    },
  },
  images: {
    // Remote patterns for image sources. Unsplash is used for the
    // visual hero + room cards while we build out the photography
    // library. Using `remotePatterns` rather than the legacy `domains`
    // list is the Next 14+ recommended pattern — it allows us to be
    // specific about the path and protocol.
    remotePatterns: [
      { protocol: 'https', hostname: 'nwfxvhqbjtfvoopcadff.supabase.co', pathname: '/storage/v1/object/public/cafe-sativa-canon/**' },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'qtrypzzcjebvfcihiynt.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

module.exports = nextConfig
