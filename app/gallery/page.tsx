import Link from 'next/link'

// Mock exhibition data
const currentExhibition = {
  title: "Digital Dreams",
  artist: "Curated Collection",
  description: "25 artists exploring the intersection of technology, nature, and consciousness",
  endDate: "March 15, 2026",
  artworksCount: 25,
  featured: true
}

const artworks = [
  {
    id: 1,
    title: "Neon Genesis",
    artist: "Yuki Tanaka",
    medium: "Digital Art / NFT",
    price: 850,
    image: "/gallery/placeholder1.jpg",
    sold: false,
    dimensions: "3000 x 4000px",
    edition: "1/1"
  },
  {
    id: 2,
    title: "Urban Mythology",
    artist: "Sofia Martinez",
    medium: "Mixed Media",
    price: 1200,
    image: "/gallery/placeholder2.jpg",
    sold: false,
    dimensions: "24\" x 36\"",
    edition: "Original"
  },
  {
    id: 3,
    title: "Cyber Garden",
    artist: "Alex Chen",
    medium: "3D Render / Print",
    price: 650,
    image: "/gallery/placeholder3.jpg",
    sold: true,
    dimensions: "18\" x 24\"",
    edition: "3/10"
  },
  {
    id: 4,
    title: "Ethereal Moments",
    artist: "Maya Rodriguez",
    medium: "Photography",
    price: 480,
    image: "/gallery/placeholder4.jpg",
    sold: false,
    dimensions: "20\" x 30\"",
    edition: "5/25"
  },
  {
    id: 5,
    title: "Digital Bloom",
    artist: "Jin Park",
    medium: "Generative Art",
    price: 920,
    image: "/gallery/placeholder5.jpg",
    sold: false,
    dimensions: "4096 x 4096px",
    edition: "1/5"
  },
  {
    id: 6,
    title: "Synthetic Sunset",
    artist: "Elena Volkov",
    medium: "AI-Assisted Painting",
    price: 1500,
    image: "/gallery/placeholder6.jpg",
    sold: false,
    dimensions: "30\" x 40\"",
    edition: "Original"
  }
]

const upcomingExhibitions = [
  {
    title: "Abstract Realities",
    openingDate: "March 16, 2026",
    artistCount: 15
  },
  {
    title: "Canary Island Visions",
    openingDate: "April 1, 2026",
    artistCount: 20
  }
]

export default function GalleryPage() {
  return (
    <main className="min-h-screen bg-[#2B1810]">
      
      {/* Hero/Gallery Header */}
      <section className="relative py-20 px-4 bg-gradient-to-b from-[#5C4033] to-[#2B1810] border-b border-[#C9A961]">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-[#C9A961] text-6xl md:text-7xl font-serif mb-4">
                The Gallery
              </h1>
              <p className="text-[#F5E6D3] text-xl mb-6">
                Virtual Art Exhibitions • Buy & Sell Original Work
              </p>
              <p className="text-[#F5E6D3] leading-relaxed mb-8">
                Discover emerging and established artists. Purchase original artwork with direct artist support. 
                Café Sativa takes 20% commission - artists keep 80%.
              </p>
              <div className="flex gap-4">
                <Link 
                  href="/gallery/submit" 
                  className="bg-[#C9A961] text-[#2B1810] px-8 py-3 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider"
                >
                  Submit Your Art
                </Link>
                <Link 
                  href="/gallery/artists" 
                  className="border-2 border-[#C9A961] text-[#C9A961] px-8 py-3 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider"
                >
                  All Artists
                </Link>
              </div>
            </div>

            {/* Current Exhibition Info */}
            <div className="bg-[#2B1810] border-2 border-[#C9A961] rounded-lg p-8">
              <div className="bg-[#C9A961] text-[#2B1810] px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block mb-4">
                NOW SHOWING
              </div>
              <h2 className="text-[#F5E6D3] text-3xl font-serif mb-2">{currentExhibition.title}</h2>
              <p className="text-[#C9A961] text-lg mb-4">{currentExhibition.artist}</p>
              <p className="text-[#F5E6D3] mb-6 leading-relaxed">
                {currentExhibition.description}
              </p>
              <div className="flex justify-between items-center pt-4 border-t border-[#5C4033]">
                <div>
                  <p className="text-[#C9A961] text-sm">Exhibition closes</p>
                  <p className="text-[#F5E6D3] font-semibold">{currentExhibition.endDate}</p>
                </div>
                <div className="text-right">
                  <p className="text-[#C9A961] text-sm">Available works</p>
                  <p className="text-[#F5E6D3] font-semibold text-2xl">{artworks.filter(a => !a.sold).length}/{currentExhibition.artworksCount}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Filter/Sort Bar */}
      <section className="py-6 px-4 bg-[#5C4033] border-b border-[#C9A961] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex gap-3">
            <button className="bg-[#C9A961] text-[#2B1810] px-4 py-2 rounded-sm text-sm font-semibold uppercase tracking-wider">
              All Works
            </button>
            <button className="bg-[#2B1810] border border-[#C9A961] text-[#C9A961] px-4 py-2 rounded-sm text-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider">
              Available
            </button>
            <button className="bg-[#2B1810] border border-[#C9A961] text-[#C9A961] px-4 py-2 rounded-sm text-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider">
              Sold
            </button>
          </div>
          
          <div className="flex gap-3 items-center">
            <span className="text-[#F5E6D3] text-sm">Sort by:</span>
            <select className="bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] px-4 py-2 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A961]">
              <option>Recently Added</option>
              <option>Price: Low to High</option>
              <option>Price: High to Low</option>
              <option>Artist Name</option>
            </select>
          </div>
        </div>
      </section>

      {/* Artworks Grid */}
      <section className="py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {artworks.map((artwork) => (
              <Link 
                key={artwork.id} 
                href={`/gallery/artwork/${artwork.id}`}
                className="group"
              >
                <div className="bg-[#5C4033] rounded-lg overflow-hidden hover:transform hover:scale-105 transition-all duration-300">
                  {/* Artwork Image Placeholder */}
                  <div className="relative h-80 bg-gradient-to-br from-[#C9A961] to-[#C07855] flex items-center justify-center overflow-hidden">
                    {artwork.sold && (
                      <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase z-10">
                        SOLD
                      </div>
                    )}
                    <div className="text-center p-8">
                      <p className="text-[#2B1810] text-xl font-serif mb-2">{artwork.title}</p>
                      <p className="text-[#2B1810] opacity-75">{artwork.medium}</p>
                    </div>
                  </div>

                  {/* Artwork Info */}
                  <div className="p-6">
                    <h3 className="text-[#F5E6D3] text-xl font-serif mb-1 group-hover:text-[#C9A961] transition-colors">
                      {artwork.title}
                    </h3>
                    <p className="text-[#C9A961] text-sm mb-3">by {artwork.artist}</p>
                    
                    <div className="grid grid-cols-2 gap-3 text-sm mb-4 pb-4 border-b border-[#2B1810]">
                      <div>
                        <p className="text-[#C9A961] text-xs">Medium</p>
                        <p className="text-[#F5E6D3]">{artwork.medium}</p>
                      </div>
                      <div>
                        <p className="text-[#C9A961] text-xs">Edition</p>
                        <p className="text-[#F5E6D3]">{artwork.edition}</p>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[#C9A961] text-xs">Price</p>
                        <p className="text-[#F5E6D3] text-2xl font-bold">${artwork.price}</p>
                      </div>
                      {!artwork.sold ? (
                        <button className="bg-[#C9A961] text-[#2B1810] px-6 py-2 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase text-sm tracking-wider">
                          View
                        </button>
                      ) : (
                        <button disabled className="bg-gray-600 text-gray-400 px-6 py-2 rounded-sm font-semibold cursor-not-allowed uppercase text-sm tracking-wider">
                          Sold
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-12 px-4 bg-[#5C4033]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">156</p>
              <p className="text-[#F5E6D3]">Artworks Sold</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">78</p>
              <p className="text-[#F5E6D3]">Featured Artists</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">$127K</p>
              <p className="text-[#F5E6D3]">Total Sales</p>
            </div>
            <div>
              <p className="text-[#C9A961] text-4xl font-bold mb-2">12</p>
              <p className="text-[#F5E6D3]">Exhibitions Hosted</p>
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Exhibitions */}
      <section className="py-16 px-4 bg-[#2B1810]">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-[#C9A961] text-4xl font-serif mb-8 text-center">
            Coming Soon
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {upcomingExhibitions.map((exhibition, index) => (
              <div key={index} className="bg-[#5C4033] rounded-lg p-8 text-center border-2 border-transparent hover:border-[#C9A961] transition-all">
                <div className="bg-[#2B1810] border border-[#C9A961] text-[#C9A961] px-3 py-1 rounded-full text-xs uppercase tracking-wider inline-block mb-4">
                  UPCOMING
                </div>
                <h3 className="text-[#F5E6D3] text-2xl font-serif mb-2">{exhibition.title}</h3>
                <p className="text-[#C9A961] mb-4">Opening {exhibition.openingDate}</p>
                <p className="text-[#F5E6D3] text-sm">{exhibition.artistCount} Artists</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Artist Submission CTA */}
      <section className="py-16 px-4 bg-[#5C4033]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-[#C9A961] text-4xl font-serif mb-4">
            Are You an Artist?
          </h2>
          <p className="text-[#F5E6D3] text-lg mb-8 max-w-2xl mx-auto">
            Submit your work for consideration in upcoming exhibitions. 
            We feature emerging and established artists across all mediums.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              href="/gallery/submit" 
              className="bg-[#C9A961] text-[#2B1810] px-10 py-4 rounded-sm font-semibold hover:bg-[#F5E6D3] transition-colors uppercase tracking-wider"
            >
              Submit Your Art
            </Link>
            <Link 
              href="/gallery/guidelines" 
              className="border-2 border-[#C9A961] text-[#C9A961] px-10 py-4 rounded-sm font-semibold hover:bg-[#C9A961] hover:text-[#2B1810] transition-colors uppercase tracking-wider"
            >
              Submission Guidelines
            </Link>
          </div>
        </div>
      </section>

    </main>
  )
}
