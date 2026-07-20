export type ProductImageTransform = {
  x: number
  y: number
  scale: number
}

export type Product = {
  id: string
  name: string
  image: string
  gallery?: string[]
  alt: string
  description?: string
  price?: number
  salePrice?: number
  objectPosition?: string
  imageTransforms?: Record<string, ProductImageTransform>
  slug?: string
  seoTitle?: string
  searchVisible?: boolean
  stock?: number
  oneOfAKind?: boolean
  options?: Array<{
    name: string
    values: string[]
  }>
}

export const products: Product[] = [
  {
    id: 'product-1',
    name: 'Klaasist mullipiip',
    image: '/images/demo/bong_1.jpg',
    gallery: ['/images/demo/bong_1.jpg', '/images/demo/bong_2.jpg'],
    alt: 'Klaasist mullipiip',
    description: 'Minimalistlik läbipaistvast klaasist mullipiip pika varrega.',
    price: 18,
    stock: 1,
    oneOfAKind: true,
    objectPosition: 'center 52%',
  },
  {
    id: 'product-2',
    name: 'Kaktusekuju',
    image: '/images/demo/kaktus_1.jpg',
    gallery: ['/images/demo/kaktus_1.jpg', '/images/demo/kaktus_2.jpg'],
    alt: 'Tume metalliktoonides kaktusekuju',
    description: 'Skulptuurne kaktus tumedas potis. Taim, mida ei pea kunagi kastma.',
    price: 32,
    stock: 8,
    options: [{ name: 'Värv', values: ['Grafiit', 'Roheline', 'Liiv'] }],
    objectPosition: 'center 55%',
  },
  {
    id: 'product-3',
    name: 'Puidust kass',
    image: '/images/demo/kass_1.jpg',
    gallery: ['/images/demo/kass_1.jpg', '/images/demo/kass_2.jpg'],
    alt: 'Kõrge käsitsi maalitud puidust kassikuju',
    description: 'Kõrge ja väärikas käsitsi maalitud puidust kassikuju.',
    price: 45,
    stock: 0,
    objectPosition: 'center 48%',
  },
  {
    id: 'product-4',
    name: 'Valge ornament',
    image: '/images/demo/mingiasi_1.jpg',
    gallery: ['/images/demo/mingiasi_1.jpg', '/images/demo/mingiasi_2.jpg'],
    alt: 'Valge ažuurne ornament alusel',
    description: 'Ažuurne valge lauakaunistus südame- ja lillemotiividega.',
    price: 28,
    stock: 6,
    options: [{ name: 'Suurus', values: ['Väike', 'Keskmine', 'Suur'] }],
    objectPosition: 'center 50%',
  },
  {
    id: 'product-5',
    name: 'Hõbedane pildiraam',
    image: '/images/demo/padar_1.jpg',
    gallery: ['/images/demo/padar_1.jpg', '/images/demo/padar_2.jpg'],
    alt: 'Läikiv hõbedane pildiraam',
    description: 'Detailse mustriga läikiv metallraam erilisele portreele.',
    price: 22,
    stock: 1,
    objectPosition: 'center 48%',
  },
  {
    id: 'product-6',
    name: 'Inglitega taldrik',
    image: '/images/demo/taldrik_1.jpg',
    gallery: ['/images/demo/taldrik_1.jpg'],
    alt: 'Kuldne dekoratiivtaldrik kolme ingliga',
    description: 'Kuldne dekoratiivtaldrik kolme ruumilise ingliga.',
    price: 36,
    salePrice: 29,
    stock: 5,
    options: [{ name: 'Värv', values: ['Kuldne', 'Hõbedane'] }],
    objectPosition: 'center 50%',
  },
  {
    id: 'product-7',
    name: 'Sõnumiga pitsid',
    image: '/images/demo/viinapitsid_1.jpg',
    gallery: ['/images/demo/viinapitsid_1.jpg'],
    alt: 'Neli pika sangaga keraamilist pitsi',
    description: 'Neljane keraamiliste pika sangaga pitside komplekt humoorikate sõnumitega.',
    price: 34,
    stock: 1,
    oneOfAKind: true,
    objectPosition: 'center 50%',
  },
]
