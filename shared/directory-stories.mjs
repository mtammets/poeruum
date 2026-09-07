export const directoryStories = [{
  slug: 'see-uks-tass',
  title: 'See üks tass, mille järele käsi haarab',
  category: 'Igapäeva väikesed rõõmud',
  intro: 'Kapis võib olla terve rida tasse, aga hommikul valid ikka selle ühe. Mõni ese leiab meie päevas oma koha nii vaikselt, et märkame seda alles siis, kui ta on puudu.',
  image: '/images/poeruumi-lood-tass.webp',
  imageAlt: 'Hele keraamiline kohvitass puidust laual pehmes hommikuvalguses.',
  imageCaption: 'Üks tass, soe kohv ja hetk iseendale. Illustratiivne tehisintellektiga loodud pilt.',
  author: 'Poeruum',
  publishedAt: '2026-09-07',
  opening: [
    'Hommik algab vahel enne, kui oled selleks päriselt valmis. Veekeetja klõpsab, telefon annab endast märku ja akna taga on ilm, millega tuleb alles harjuda. Avad kapi ning võtad tassi. Sedasama, mille võtsid eile.',
    'Võib-olla mahub selle sang täpselt sõrmede vahele. Võib-olla on serv just parajalt õhuke või on glasuuris väike sinine laik, mis meenutab merd. Sa ei pea seda iga kord endale seletama. Käsi juba teab.',
  ],
  quote: 'Lemmikuks saab ese siis, kui ta leiab koha sinu päris elus.',
  sections: [{
    title: 'Oma koht tekib kasutades',
    paragraphs: [
      'Uut asja vaadates jääb kõigepealt silma selle välimus. Päris tuttavaks saab ta hiljem: nõusid kuivatades, lauda kattes, kiiruga viimast kohvilonksu võttes. Tasapisi selgub, kas tass püsib mõnusalt käes ja kas tahad selle ka järgmisel hommikul kapist võtta.',
      'Nii kogunevadki koju väikesed lemmikud. Linane rätik, mis on pesudega pehmeks läinud. Kauss, millest sööd nii suviseid maasikaid kui ka talvist suppi. Kott, mille taskust leiad võtmed isegi pimedas. Nende väärtus on neis kordades, mil nad teevad päeva natuke mõnusamaks.',
    ],
  }, {
    title: 'Enne sinu hommikut oli kellegi tööpäev',
    paragraphs: [
      'Käsitsi tehtud tassi vaadates võib mõte liikuda korraks tagasi selle valmimise juurde. Keegi valis savi, proovis kuju, kinnitas sanga ja otsustas, millist glasuuri kasutada. Ese, millest sina hommikul kohvi jood, algas teise inimese mõttest ja tööst.',
      'Sellepärast on tore lugeda ka tegijast. Kuidas ta oma materjalini jõudis? Mida talle teha meeldib? Milline detail nõudis kõige rohkem katsetamist? Kui tead natuke eseme saamisloost, oskad ehk märgata midagi, millest muidu pilk üle libiseks.',
      'Väikese poe juures tasub vahel avada ka leht „Meist”. Seal võib olla foto töötoast, paar rida poe algusest või selgitus, miks just sellised esemed valikusse jõuavad. See on võimalus tutvuda inimesega, kelle tööd sa vaatad.',
    ],
  }, {
    title: 'Järgmine lemmik võib juba kodus olla',
    paragraphs: [
      'Vaata täna oma kodus ringi. Millist eset kasutad peaaegu mõtlemata? Kust see tuli? Võib-olla meenub üks reis, kingitus või juhuslik sisseastumine väikesesse poodi. Võib-olla meeldib sulle lihtsalt selle kuju. Sellest täiesti piisab.',
      'Ja kui satud järgmisel korral midagi uut valima, kujuta seda ette oma tavalises päevas. Tass köögilaual, kauss pere keskel, kott esikus järgmist käiku ootamas. Kas sellel oleks sinu juures oma koht?',
      'Praegu aga kalla kohv valmis. Võta see oma tass ja istu korraks. Kõik muu võib mõne minuti oodata.',
    ],
  }],
}]

export const featuredDirectoryStory = directoryStories[0]
export const directoryStoryPath = (story) => `/lood/${story.slug}/`
export const getDirectoryStory = (pathname) => directoryStories.find((story) =>
  pathname === directoryStoryPath(story) || pathname === directoryStoryPath(story).slice(0, -1))

export const directoryStoryReadingMinutes = (story) => Math.max(1, Math.ceil([
  story.intro, ...story.opening, story.quote,
  ...story.sections.flatMap((section) => [section.title, ...section.paragraphs]),
].join(' ').split(/\s+/).length / 180))

export const directoryStorySchema = (story, origin = 'https://kaubamaja.poeruum.ee') => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: story.title,
  description: story.intro,
  image: `${origin}${story.image}`,
  url: `${origin}${directoryStoryPath(story)}`,
  mainEntityOfPage: `${origin}${directoryStoryPath(story)}`,
  inLanguage: 'et',
  datePublished: story.publishedAt,
  author: { '@type': 'Organization', name: story.author, url: 'https://poeruum.ee/' },
  publisher: { '@type': 'Organization', name: 'Poeruum', url: 'https://poeruum.ee/' },
  isPartOf: { '@type': 'WebSite', name: 'Poeruumi Kaubamaja', url: `${origin}/` },
})
