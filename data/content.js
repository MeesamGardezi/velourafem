module.exports = {
  brand: {
    name: 'CLOTHING',
    tagScript: 'Co.',
    tagline: 'Style Defined, Quality Delivered',
    established: '2026',
    description: 'Modern fashion for the discerning individual.',
  },

  nav: [
    { label: 'Shop', href: '/products' },
    { label: 'Collection', href: '#collection' },
    { label: 'Philosophy', href: '#philosophy' },
    { label: 'Story', href: '#story' },
    { label: 'Contact', href: '#contact' },
  ],

  hero: {
    eyebrow: 'Established 2026',
    headline: 'She does not chase trends.',
    headlineAccent: 'She sets the standard.',
    subheadline: 'A curated world of quiet luxury, editorial elegance, and intentional design — for the woman who has always known exactly who she is.',
    ctaPrimary: { label: 'Explore Collection', href: '#collection' },
    ctaSecondary: { label: 'Our Philosophy', href: '#philosophy' },
    scrollLabel: 'Scroll to discover',
  },

  marquee: [
    'Quiet Luxury',
    'Editorial Elegance',
    'Intentional Design',
    'Soft Power',
    'Timeless Craft',
    'Refined Always',
  ],

  stats: [
    { value: '200+', label: 'Curated Pieces' },
    { value: '12', label: 'Collections' },
    { value: '4', label: 'Years Crafting' },
    { value: '98%', label: 'Client Retention' },
  ],

  philosophy: {
    eyebrow: 'Brand Ethos',
    title: 'The Art of',
    titleAccent: 'Restraint',
    subtitle: 'Every stitch, every pixel — deliberate. Luxury without coldness, confidence without noise.',
    pillars: [
      {
        icon: '◈',
        title: 'Quiet',
        body: 'Never loud. True confidence whispers. Our pieces speak volumes through silence.',
      },
      {
        icon: '◇',
        title: 'Intentional',
        body: 'Every detail is a decision. Nothing is accidental. Nothing is excess.',
      },
      {
        icon: '◉',
        title: 'Warm',
        body: 'Luxury without coldness. Elegance that embraces rather than excludes.',
      },
      {
        icon: '◎',
        title: 'Timeless',
        body: 'No trends. Only principles. Built to outlast the season and the cycle.',
      },
    ],
  },

  collection: {
    eyebrow: 'Curated Pieces',
    title: 'The Collection',
    subtitle: 'Each piece is a statement — not of wealth, but of discernment.',
    items: [
      {
        id: 1,
        title: 'Velvet Drape',
        meta: 'Emerald · Bespoke',
        price: 'PKR 24,500',
        priceNum: 24500,
        badge: { label: 'New Arrival', style: 'green' },
        color: 'green',
        image: 'https://images.unsplash.com/photo-1539008835657-9e8e9680c956?w=600&h=750&fit=crop',
        desc: 'Sculptural silhouette, hand-finished edges, forest-green velvet.',
      },
      {
        id: 2,
        title: 'Elysian Cape',
        meta: 'Ivory · Limited Edition',
        price: 'PKR 38,000',
        priceNum: 38000,
        badge: { label: 'Limited', style: 'terracotta' },
        color: 'sage',
        image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop',
        desc: 'A cape that commands the room. Ivory silk. Twelve pieces only.',
      },
      {
        id: 3,
        title: "The Founder's Set",
        meta: 'Curated · Archive',
        price: 'PKR 12,900',
        priceNum: 12900,
        badge: { label: 'Archive', style: 'muted' },
        color: 'taupe',
        image: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&h=750&fit=crop',
        desc: 'The original trinity. Where Clothing Co. began its quiet revolution.',
      },
      {
        id: 4,
        title: 'Obsidian Line',
        meta: 'Noir · Signature',
        price: 'PKR 52,000',
        priceNum: 52000,
        badge: { label: 'Signature', style: 'green' },
        color: 'dark',
        image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&h=750&fit=crop',
        desc: 'Deep charcoal, structured shoulders, uncompromising confidence.',
      },
      {
        id: 5,
        title: 'Blush Ritual',
        meta: 'Dusty Rose · Soft',
        price: 'PKR 18,700',
        priceNum: 18700,
        badge: { label: 'Bestseller', style: 'terracotta' },
        color: 'blush',
        image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&h=750&fit=crop',
        desc: 'The balance of strength and softness captured in dusty rose.',
      },
      {
        id: 6,
        title: 'Celadon Story',
        meta: 'Sage · Ethereal',
        price: 'PKR 29,000',
        priceNum: 29000,
        badge: { label: 'New', style: 'muted' },
        color: 'celadon',
        image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&h=750&fit=crop',
        desc: 'Sage-toned layers that move with intention. Morning light in textile form.',
      },
    ],
  },

  testimonials: [
    {
      quote: 'I put on a Clothing piece and I don\'t need to say a word. The room understands.',
      author: 'Nadia R.',
      title: 'Creative Director, Karachi',
    },
    {
      quote: 'Every collection is a lesson in restraint. I\'ve stopped shopping anywhere else.',
      author: 'Sara M.',
      title: 'Architect & Collector',
    },
    {
      quote: 'This is what fashion feels like when it respects the woman wearing it.',
      author: 'Zara A.',
      title: 'Founder, MENA Studio',
    },
  ],

  lookbook: {
    eyebrow: 'The Lookbook',
    title: 'A Visual Diary',
    items: [
      { title: 'Forest Reverie', season: 'AW 2026', color: 'green' },
      { title: 'Ivory Morning', season: 'SS 2026', color: 'ivory' },
      { title: 'Obsidian Hour', season: 'AW 2026', color: 'dark' },
      { title: 'Blush at Dusk', season: 'Resort 2026', color: 'blush' },
      { title: 'Celadon Mist', season: 'SS 2026', color: 'celadon' },
    ],
  },

  editorial: {
    eyebrow: 'Brand Voice',
    quote: '"Style is not what you wear. It is how you wear it."',
    cite: '— Clothing Co.',
    body: 'Born from a belief that true elegance is never announced — it is simply felt. Clothing Co. exists for those who have always known exactly who they are.',
  },

  process: {
    eyebrow: 'How We Work',
    title: 'Crafted with',
    titleAccent: 'Purpose',
    steps: [
      { num: '01', title: 'Vision', body: 'Every collection begins as an emotion — a feeling we want to give the woman who wears us.' },
      { num: '02', title: 'Design', body: 'Silhouettes are drawn by hand. Proportions are refined until nothing is left to remove.' },
      { num: '03', title: 'Craft', body: 'Selected fabrics, artisan hands, and unhurried attention. Made to last a decade, at least.' },
      { num: '04', title: 'Deliver', body: 'Packaged as a gift to yourself. Because you deserve the unboxing to feel like a moment.' },
    ],
  },

  newsletter: {
    eyebrow: 'Stay Connected',
    title: 'Join the Inner Circle',
    subtitle: 'Receive early access to new collections, editorial stories, and exclusive invitations. No noise — only what matters.',
    placeholder: 'Your email address',
    cta: 'Subscribe',
  },

  footer: {
    columns: [
      {
        heading: 'Shop',
        links: [
          { label: 'All Products', href: '/products' },
          { label: 'New Arrivals', href: '/products?filter=new' },
          { label: 'Bestsellers', href: '/products?filter=bestseller' },
          { label: 'Archive', href: '/products?filter=archive' },
        ],
      },
      {
        heading: 'Brand',
        links: [
          { label: 'Our Story', href: '#story' },
          { label: 'Philosophy', href: '#philosophy' },
          { label: 'Press', href: '#' },
          { label: 'Careers', href: '#' },
        ],
      },
      {
        heading: 'Help',
        links: [
          { label: 'Cart', href: '/cart' },
          { label: 'Contact', href: '#contact' },
          { label: 'Shipping Info', href: '#' },
          { label: 'Returns', href: '#' },
        ],
      },
    ],
    legal: '© 2026 Clothing Co. All rights reserved.',
  },
};
