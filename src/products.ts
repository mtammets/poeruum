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
}

export const products: Product[] = [
  {
    id: 'product-1',
    name: 'Isekastuv taimepott',
    image: '/images/plant.JPG',
    gallery: ['/images/plant.JPG', '/images/art.JPG', '/images/poster.JPG'],
    alt: 'Taim kollases isekastuvas potis',
    description: 'Kollane isekastuv taimepott koos veetaseme näidikuga.',
    price: 24,
    objectPosition: 'center 44%',
  },
  {
    id: 'product-2',
    name: 'Abstraktne maal',
    image: '/images/art.JPG',
    gallery: ['/images/art.JPG', '/images/poster.JPG', '/images/plant.JPG'],
    alt: 'Abstraktne maal',
    description: 'Käsitsi maalitud abstraktne teos lõuendil. Ainueksemplar.',
    price: 95,
    objectPosition: 'center 47%',
  },
  {
    id: 'product-3',
    name: 'Taksi padi',
    image: '/images/dog.JPG',
    gallery: ['/images/dog.JPG', '/images/plant.JPG', '/images/art.JPG'],
    alt: 'Taksi portree',
    description: 'Taksi portree pehmel tekstiilil. Sobib padjaks või seinadekooriks.',
    price: 39,
    objectPosition: 'center 42%',
  },
  {
    id: 'product-4',
    name: 'Popkunsti poster',
    image: '/images/poster.JPG',
    gallery: ['/images/poster.JPG', '/images/art.JPG', '/images/dog.JPG'],
    alt: 'Popkunsti poster',
    description: 'Raamitud popkunsti poster kollaste päikeseprillidega.',
    price: 48,
    objectPosition: 'center 44%',
  },
]
