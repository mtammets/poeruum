import { DEFAULT_RETURNS_TEXT } from './storefrontConfig'

export default function StoreTermsContent({ returnsText, contactEmail }: { returnsText: string; contactEmail: string }) {
  return <div className="store-terms-content">
    <section><h3>Taganemine ja tagastamine</h3><p>{returnsText || DEFAULT_RETURNS_TEXT}</p></section>
    <section><h3>Tarne ja maksmine</h3><p>Tarneviis ja selle hind kuvatakse ostukorvis enne tellimuse kinnitamist. Väljasaatmise aeg on näha toote juures, kui müüja on selle määranud. Makseviisid kuvatakse kassas.</p></section>
    <section><h3>Pretensioonid</h3><p>Kaubaga seotud küsimuse või pretensiooni korral võta ühendust {contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : 'poe kontakt-e-postil'}. Tarbijal on õigus pöörduda vaidluse lahendamiseks <a href="https://ttja.ee/tarbijavaidluste-komisjon" target="_blank" rel="noreferrer">Tarbijavaidluste komisjoni</a>.</p></section>
  </div>
}
