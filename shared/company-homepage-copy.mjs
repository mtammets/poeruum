// Only plain text belongs here. Prices and product links remain live shop data.
export const companyCopyFields = {
  brand: ['Brändi nimi', 120],
  navStory: ['Menüü: lugu', 80], navWork: ['Menüü: looming', 80], navContact: ['Menüü: kontakt', 80],
  headerShop: ['Päise e-poe link', 80], heroEyebrow: ['Avaploki ülarida', 180],
  heroTitle: ['Pealkirja esimene rida', 100], heroAccent: ['Pealkirja teine rida', 100],
  heroIntro: ['Avaploki tutvustus', 1000], heroShop: ['Avaploki nupp', 100], location: ['Asukoht', 120],
  storyLabel: ['Loo jaotise nimi', 100], storyTitle: ['Loo pealkiri', 180],
  portraitCaption: ['Portree allkiri', 180], portraitCredit: ['Portree lisatekst', 180],
  storyStatement: ['Iseloomustus', 180], storyIntro: ['Enesetutvustus', 5000],
  nameTitle: ['Nime loo pealkiri', 180], nameStory: ['Nime lugu', 5000], nameOutro: ['Nime loo lõpetus', 2000],
  sketchesLink: ['Visandite nupp', 100], sketchesLabel: ['Visandite jaotise nimi', 100],
  sketchesTitle: ['Visandite pealkiri', 180], sketchesIntro: ['Visandite esimene lõik', 5000],
  sketchesOutro: ['Visandite teine lõik', 5000], sketchesShop: ['Visandite e-poe link', 100],
  sketchesCaption: ['Visandifoto allkiri', 180], sketchesCredit: ['Visandifoto lisatekst', 180],
  workLabel: ['Loomingu jaotise nimi', 100], workHeading: ['Loomingu sissejuhatus', 180],
  productEdition: ['Tootepildi suur tekst', 80], productCaption: ['Tootepildi allkiri', 180],
  productEyebrow: ['Toote ülarida', 180], productTitle: ['Toote pealkiri kodulehel', 180],
  productStory: ['Toote lugu kodulehel', 5000], productButton: ['Toote nupp', 100], allProducts: ['Kõigi toodete link', 100],
  contactLabel: ['Kontakti ülarida', 120], contactTitle: ['Kontakti pealkiri', 180],
  email: ['E-post', 254], phone: ['Telefon', 80], company: ['Ettevõtte nimi', 180],
  registryLabel: ['Registrikoodi silt', 80], registry: ['Registrikood', 40], address: ['Aadress', 300],
  instagramLabel: ['Instagrami lingi tekst', 80], facebookLabel: ['Facebooki lingi tekst', 80], tiktokLabel: ['TikToki lingi tekst', 80],
  footerWordmark: ['Jaluse suur nimi', 120], copyright: ['Autoriõiguse nimi', 180], footerShop: ['Jaluse e-poe link', 80],
  credit: ['Jaluse viide', 120],
}

export function normalizeCompanyCopy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(companyCopyFields).flatMap(([key, [, limit]]) =>
    typeof value[key] === 'string' ? [[key, value[key].replace(/\r\n?/g, '\n').slice(0, limit)]] : []))
}

export function companyCopyDefaults(settings = {}, name = 'Krük-Krük', product) {
  const string = (key) => typeof settings[key] === 'string' ? settings[key].trim() : ''
  const brand = string('editableStoreName') || name
  const hat = product?.slug === 'nokkmuts'
  return {
    brand, navStory: 'Lugu', navWork: 'Looming', navContact: 'Kontakt', headerShop: 'E-poodi',
    heroEyebrow: 'Krük-Krük / Lugu ja looming', heroTitle: 'Töö mingu', heroAccent: 'metsa.',
    heroIntro: 'Hooldan metsi, pügan hekke ja joonistan.', heroShop: 'Vaata e-poodi', location: 'Kuusalu, Eesti',
    storyLabel: 'Lugu', storyTitle: 'Loodusest\nnokk ees.', portraitCaption: 'Krük-Krük', portraitCredit: 'Musta rähni kampaania',
    storyStatement: 'Otsekohene.\nPõhjalik.',
    storyIntro: 'Olen Kuusalust pärit tavaline mees. Ütlen, mida mõtlen, ja tööd teen põhjalikult. Metsade hooldus ja hekkide pügamine on osa igapäevatööst.',
    nameTitle: 'Nimi tuli rähni häälest.', nameStory: 'Mulle meeldivad mustad rähnid ja nende hääl. Krük-krük — nii see kõlab. Looduses olles tuligi sellest nimi.',
    nameOutro: 'Nüüd on need samad rähnid joonistustel ja Krük-Krüki märgil.', sketchesLink: 'Vaata visandeid',
    sketchesLabel: 'Visandid', sketchesTitle: 'Joonistan nii,\nnagu tahan.',
    sketchesIntro: 'Sellel paberil proovisin, milline võiks kahe rähni märk välja näha.',
    sketchesOutro: 'Ühele linnupaarile tõmbasin ringi ümber. Selle märgi panin ka nokkmütsile.',
    sketchesShop: hat ? 'Vaata märki mütsil' : 'Vaata e-poodi', sketchesCaption: 'Kahe rähni märgi visandid', sketchesCredit: 'Käsitsi joonistatud',
    workLabel: 'Looming', workHeading: hat ? 'Kaks rähni. Must nokkmüts.' : 'Looming e-poes.', productEdition: '2rähn',
    productCaption: `${brand} / ${hat ? '2rähn' : 'Looming'}`, productEyebrow: `${brand} / E-pood`, productTitle: product?.name || '',
    productStory: hat ? 'Selle musta nokkmütsi esipaneelil on kahe rähni märk. Sama joonistus, mille valisin paberil tehtud visandite hulgast.' : product?.description || '',
    productButton: 'Vaata toodet e-poes', allProducts: 'Kõik tooted', contactLabel: 'Kontakt / Madis', contactTitle: 'Võta\nühendust.',
    email: string('contactEmail'), phone: string('contactPhone'), company: string('businessName') || brand,
    registryLabel: 'Registrikood', registry: string('registryCode'), address: string('businessAddress'),
    instagramLabel: 'Instagram', facebookLabel: 'Facebook', tiktokLabel: 'TikTok',
    footerWordmark: brand, copyright: brand, footerShop: 'E-pood', credit: 'Loodud Poeruumis',
  }
}

export function companyCopyEqual(a, b) {
  const left = normalizeCompanyCopy(a)
  const right = normalizeCompanyCopy(b)
  return Object.keys(companyCopyFields).every(key => left[key] === right[key])
}
