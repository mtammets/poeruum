export const aboutPoeruumContent = {
  title: 'Mis on Poeruum ja kellele see sobib?',
  seoDescription: 'Eestis loodud e-poeplatvorm sinu toodetele. Tutvu Poeruumi võimaluste, pakettide ja alustamise sammudega: oma pood, maksed ja tellimused ühes kohas.',
  definition: 'Poeruum on Eestis loodud e-poeplatvorm, kus saad oma toodetele poe luua ning hallata tooteid, makseid ja tellimusi ühest kohast. Telefonis või arvutis, ilma programmeerimata.',
  workflowHeading: 'Tootepildist tellimuseni.',
  workflowIntro: 'Sina tunned oma tooteid. Poeruum annab sulle tööriistad, et need ostjani tuua ja igapäevast müüki ise juhtida.',
  capabilities: [
    {
      title: 'Oma näoga pood',
      text: 'Lisa nimi ja logo, vali poe ilme ning kasuta Poeruumi aadressi või oma domeeni. Tootele saad lisada pildid, hinna, valikud ja laoseisu.',
      detail: 'Soovi korral aitab AI koostada tootekirjelduse mustandi, mille saad ise üle vaadata.',
    },
    {
      title: 'Sujuv ostuteekond',
      text: 'Ostja valib tooted ja tarne ning tasub Stripe’i kaudu. Eraldi ostjakontot pole vaja. Lisaks kaardile saab sobivas seadmes kasutada Apple Payd või Google Payd.',
      detail: 'Paku pakiautomaati, kullerit või ise järele tulemist ning määra tarnehinnad.',
    },
    {
      title: 'Tellimused kontrolli all',
      text: 'Näed tasutud tellimusi, ostja andmeid ja valitud tarnet ühes vaates. Saad hallata tellimuse täitmist, arveid, kreeditarveid ja tagasimakseid.',
      detail: 'Paki teelepaneku korraldad sina. Ostjale saadetakse tellimuse kinnitus e-postiga.',
    },
  ],
  audienceHeading: 'Kellele Poeruum sobib?',
  audienceIntro: 'Ettevõtjale, kes müüb füüsilisi tooteid ja tahab oma e-poodi ise hallata. Nii esimese toote müügiks kui ka olemasoleva valiku veebi toomiseks.',
  audiences: [
    {
      title: 'Käsitööle ja oma loomingule',
      text: 'Keraamika, ehted või disain — anna oma töödele müügikoht, kus tootepildid ja sinu lugu saavad esile tulla.',
      image: '/images/kaubamaja-example-ceramics.webp',
      imageAlt: 'Käsitöökeraamika heledal puidust laual',
      label: 'Ise loodud',
    },
    {
      title: 'Oma tootevalikuga brändile',
      text: 'Koonda kollektsioon oma nime alla. Lisa toodete valikud, uuenda hindu ja jälgi laoseisu samas keskkonnas.',
      image: '/images/kaubamaja-example-jewelry.webp',
      imageAlt: 'Lähivaade kantavatest kõrvarõngastest',
      label: 'Oma bränd',
    },
    {
      title: 'Ainueksemplaridele',
      text: 'Kunst, vintage ja muud ainulaadsed leiud. Märgi toode ainueksemplariks ning müü seda ühe kaupa.',
      image: '/images/kaubamaja-example-art.webp',
      imageAlt: 'Värviline kunstiteos koduses interjööris',
      label: 'Üks ja ainus',
    },
  ],
  alternativeHeading: 'Millal tasub valida muu lahendus?',
  alternativeText: 'Kui sinu müük vajab mitme lao juhtimist, hulgimüügi hinnakirju, keerukaid välisriikide maksureegleid või eritellimusel ostuteekonda, kontrolli nende võimaluste olemasolu enne alustamist. Poeruum keskendub füüsiliste toodete e-poe loomisele ja igapäevasele haldusele.',
  stepsHeading: 'Neli sammu oma poeni.',
  stepsIntro: 'Võid alustada ühest tootest. Poe avamiseks vajad ka ettevõtte- ja kontaktandmeid ning maksete vastuvõtmiseks ühendatud Stripe’i kontot.',
  steps: [
    { title: 'Loo konto ja nimeta pood', text: 'Vali sobiv pakett ning oma poe nimi ja veebiaadress.' },
    { title: 'Lisa tooted ja poe ilme', text: 'Laadi üles fotod, lisa kirjeldused, hinnad ja laoseis. Kohanda logo, värve ja kujundust.' },
    { title: 'Ühenda maksed ja seadista tarne', text: 'Täida ettevõtteandmed, lõpeta Stripe’i liitumine ning vali tarneviisid ja nende hinnad.' },
    { title: 'Vaata üle ja avalda', text: 'Kontrolli tooteid, kontakte ja müügitingimusi. Avalda pood ning jaga selle aadressi oma ostjatega.' },
  ],
  faqHeading: 'Hea teada enne alustamist.',
  faqs: [
    {
      question: 'Kas poe saab telefonis valmis teha?',
      answer: 'Jah. Telefonis saad konto luua, tooted pildistada ja lisada, poe ilmet muuta ning tellimusi hallata. Programmeerimisoskust ega eraldi rakenduse paigaldamist pole vaja — Poeruum töötab veebibrauseris.',
    },
    {
      question: 'Kas saan kasutada oma domeeni?',
      answer: 'Jah. Iga pood saab Poeruumi alamdomeeni. Soovi korral saad ühendada oma domeeni, mille ühendamise eest Poeruum lisatasu ei küsi. Domeeni registreerimise ja pikendamise eest tasud oma domeenipakkujale.',
    },
    {
      question: 'Kuidas saan ostjate maksed kätte?',
      answer: 'Ühendad oma poe Stripe’i kontoga ja läbid Stripe’i nõutud ettevõtte kontrolli. Stripe töötleb ostjate makseid ning kannab raha sinu pangakontole oma väljamaksegraafiku järgi. Stripe’i maksetöötlustasu lisandub mõlemas Poeruumi paketis.',
    },
    {
      question: 'Kes korraldab pakkide saatmise?',
      answer: 'Sina määrad tarneviisid ja hinnad ning korraldad saatmise. Poeruumis saab pakkuda Omniva, DPD ja SmartPosti pakiautomaate, kullerit või ise järele tulemist. Ostja valitud tarneinfo jõuab tellimusse; pakisilti Poeruum automaatselt ei telli.',
    },
    {
      question: 'Kes suhtleb ostjaga ja lahendab tagastused?',
      answer: 'Oma poe müüjana vastutad sina toodete, müügitingimuste, ostja küsimuste ja tagastuste eest. Poeruum annab tellimuste ja müügidokumentide haldamise tööriistad ning võimaldab teha Stripe’i kaudu tagasimakseid.',
    },
    {
      question: 'Kas ostjal on Poeruumi kontot vaja?',
      answer: 'Ei. Ostja valib tooted, sisestab kassas kontakt-, arve- ja tarneandmed ning tasub ostu eest ilma kontot loomata. Tellimuse kinnitus saadetakse tema e-posti aadressile.',
    },
  ],
}
