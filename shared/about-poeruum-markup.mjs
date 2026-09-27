import { aboutPoeruumContent as content } from './about-poeruum-content.mjs'
import {
  FIXED_PLAN_MONTHLY_FEE, FIXED_PLAN_MONTHLY_TOTAL, FIXED_PLAN_TRIAL_DAYS,
  PLATFORM_FEE_RATE, PLATFORM_FEE_NET_CAP, PLATFORM_FEE_GROSS_CAP, VAT_RATE,
  formatPricingEuro as euro, formatPricingPercent as percent,
} from './platform-pricing.mjs'

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const arrow = '<span aria-hidden="true">↗</span>'
const brand = `<span class="platform-brand"><span class="platform-brand__mark" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="1" y="1" width="38" height="38" rx="11"/><path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z"/><path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18"/><path d="M15.5 22.2h9"/></svg></span><strong>Poe<span>ruum</span></strong></span>`
const icons = [
  '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 10v10M8 5V3m8 2V3"/>',
  '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7.5 5.5l9 5"/>',
]
const icon = (index) => `<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[index]}</svg>`

// Share the escaped content between React and build-time HTML so it also works
// without JavaScript. React mounts the shared homepage phone into the empty slot.
export const renderAboutPoeruumContent = () => `
<div class="about-poeruum">
  <a class="about-poeruum__skip" href="#tutvustus">Liigu lehe sisu juurde</a>
  <nav class="about-poeruum__nav about-poeruum__container" aria-label="Põhinavigatsioon">
    <a href="/" aria-label="Poeruumi avaleht">${brand}</a>
    <div class="about-poeruum__nav-links"><a href="#voimalused">Võimalused</a><a href="#kellele">Kellele?</a><a href="#paketid">Hinnad</a></div>
    <a class="about-poeruum__button about-poeruum__button--small" href="/#hind">Loo oma pood ${arrow}</a>
  </nav>

  <main id="tutvustus" class="about-poeruum__container" tabindex="-1">
    <header class="about-poeruum__hero">
      <div class="about-poeruum__hero-copy">
        <p class="about-poeruum__eyebrow"><span aria-hidden="true"></span>Mis on Poeruum?</p>
        <h1>Sinu tooted.<br><span>Sinu e-pood.</span></h1>
        <p class="about-poeruum__intro">${escapeHtml(content.definition)}</p>
        <div class="about-poeruum__actions">
          <a class="about-poeruum__button" href="/#hind">Loo oma pood ${arrow}</a>
          <a class="about-poeruum__text-link" href="https://kaubamaja.poeruum.ee/">Vaata Poeruumi poode <span aria-hidden="true">→</span></a>
        </div>
        <ul class="about-poeruum__hero-points"><li>Oma veebiaadress</li><li>Telefonis hallatav</li><li>Nähtav Kaubamajas</li></ul>
      </div>
      <div class="about-poeruum__phone" id="about-poeruum-phone"></div>
    </header>

    <section id="voimalused" class="about-poeruum__section about-poeruum__workflow" aria-labelledby="about-workflow-title">
      <header class="about-poeruum__section-heading"><div><p class="about-poeruum__eyebrow">Üks koht igapäevaseks müügiks</p><h2 id="about-workflow-title">${escapeHtml(content.workflowHeading)}</h2></div><p>${escapeHtml(content.workflowIntro)}</p></header>
      <div class="about-poeruum__capabilities">${content.capabilities.map((item, index) => `
        <article><div class="about-poeruum__capability-top">${icon(index)}<span>0${index + 1}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p><p class="about-poeruum__detail">${escapeHtml(item.detail)}</p></article>`).join('')}
      </div>
      <aside class="about-poeruum__directory" aria-labelledby="about-directory-title">
        <h3 id="about-directory-title">${escapeHtml(content.directoryHeading)}</h3>
        <div><p>${escapeHtml(content.directoryText)}</p><a class="about-poeruum__text-link" href="https://kaubamaja.poeruum.ee/">Tutvu Poeruumi Kaubamajaga ${arrow}</a></div>
      </aside>
    </section>

    <section id="kellele" class="about-poeruum__section about-poeruum__audience" aria-labelledby="about-audience-title">
      <header class="about-poeruum__section-heading"><div><p class="about-poeruum__eyebrow">Ruum sinu ideele</p><h2 id="about-audience-title">${escapeHtml(content.audienceHeading)}</h2></div><p>${escapeHtml(content.audienceIntro)}</p></header>
      <div class="about-poeruum__audience-grid">${content.audiences.map((item) => `
        <article><div class="about-poeruum__audience-image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.imageAlt)}" width="1536" height="1024" loading="lazy" decoding="async"><span>${escapeHtml(item.label)}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p></article>`).join('')}
      </div>
      <aside class="about-poeruum__alternative" aria-labelledby="about-alternative-title"><h3 id="about-alternative-title">${escapeHtml(content.alternativeHeading)}</h3><div><p>${escapeHtml(content.alternativeText)}</p><a class="about-poeruum__text-link" href="mailto:info@poeruum.ee">Küsi oma vajaduse kohta ${arrow}</a></div></aside>
    </section>

    <section id="paketid" class="about-poeruum__pricing" aria-labelledby="about-pricing-title">
      <header class="about-poeruum__section-heading"><div><p class="about-poeruum__eyebrow">Kaks viisi alustamiseks</p><h2 id="about-pricing-title">Vali oma müügile<br>sobiv pakett.</h2></div><p>Mõlemas paketis saad luua oma poe, lisada tooteid ning hallata makseid ja tellimusi. Vali, kas eelistad müügipõhist tasu või kindlat kuumakset.</p></header>
      <div class="about-poeruum__plans">
        <article><div class="about-poeruum__plan-heading"><h3>Paindlik</h3><span>Müügipõhine</span></div><p class="about-poeruum__price"><strong>0 €</strong><span>kuutasu</span></p><p class="about-poeruum__plan-rate">${percent(PLATFORM_FEE_RATE)} müügilt + km</p><ul><li>Koos käibemaksuga ${percent(PLATFORM_FEE_RATE * (1 + VAT_RATE))} toodete müügisummalt</li><li>Kuni ${euro(PLATFORM_FEE_NET_CAP)} + km kuus ehk ${euro(PLATFORM_FEE_GROSS_CAP)} koos km-ga</li><li>Müügi puudumisel Poeruumi tasu ei teki</li></ul></article>
        <article><div class="about-poeruum__plan-heading"><h3>Kindel</h3><span>${FIXED_PLAN_TRIAL_DAYS} päeva proovimiseks</span></div><p class="about-poeruum__price"><strong>${euro(FIXED_PLAN_MONTHLY_FEE)}</strong><span>kuus + km</span></p><p class="about-poeruum__plan-rate">${euro(FIXED_PLAN_MONTHLY_TOTAL)} kuus koos käibemaksuga</p><ul><li>Poeruumi müügitasu 0%</li><li>Esimesed ${FIXED_PLAN_TRIAL_DAYS} päeva Poeruumi kuutasuta</li><li>Sobib, kui eelistad ette teada kuutasu</li></ul></article>
      </div>
      <div class="about-poeruum__pricing-bottom"><p>Hindadele lisandub ${percent(VAT_RATE)} käibemaks; lõppsummad on näidatud ülal. Stripe’i maksetöötlustasud ning tarne- ja domeenikulud lisanduvad eraldi. <a href="/kasutustingimused#hinnad">Vaata tasude tingimusi</a>.</p><a class="about-poeruum__button about-poeruum__button--lime" href="/#hind">Vali pakett ja alusta ${arrow}</a></div>
    </section>

    <section id="alustamine" class="about-poeruum__section about-poeruum__steps" aria-labelledby="about-steps-title">
      <header><p class="about-poeruum__eyebrow">Ideest avatud poeni</p><h2 id="about-steps-title">${escapeHtml(content.stepsHeading)}</h2><p>${escapeHtml(content.stepsIntro)}</p><a class="about-poeruum__text-link" href="/#hind">Alusta poe loomist ${arrow}</a></header>
      <ol>${content.steps.map((step, index) => `<li><span aria-hidden="true">0${index + 1}</span><div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.text)}</p></div></li>`).join('')}</ol>
    </section>

    <section class="about-poeruum__section about-poeruum__faq" aria-labelledby="about-faq-title">
      <header><p class="about-poeruum__eyebrow">Korduma kippuvad küsimused</p><h2 id="about-faq-title">${escapeHtml(content.faqHeading)}</h2><p>Ei leidnud oma küsimusele vastust?<br><a href="mailto:info@poeruum.ee">Kirjuta info@poeruum.ee</a></p></header>
      <div>${content.faqs.map((faq, index) => `<details${index === 0 ? ' open' : ''}><summary>${escapeHtml(faq.question)}<span aria-hidden="true">+</span></summary><p>${escapeHtml(faq.answer)}</p></details>`).join('')}</div>
    </section>

    <section class="about-poeruum__closing" aria-labelledby="about-closing-title"><div><p class="about-poeruum__eyebrow">Sinu järgmine samm</p><h2 id="about-closing-title">Tee oma toodetele ruumi.</h2><p>Alusta poe loomist või vaata esmalt Poeruumi poode.</p></div><div class="about-poeruum__actions"><a class="about-poeruum__button" href="/#hind">Loo oma pood ${arrow}</a><a class="about-poeruum__text-link" href="https://kaubamaja.poeruum.ee/">Avasta Kaubamaja <span aria-hidden="true">→</span></a></div></section>
  </main>
  <footer class="about-poeruum__footer about-poeruum__container"><div><a href="/" aria-label="Poeruumi avaleht">${brand}</a><p>Eestis loodud. Sinu poe jaoks.</p></div><nav aria-label="Jaluse navigatsioon"><a href="mailto:info@poeruum.ee">Võta ühendust</a><a href="/kasutustingimused">Kasutustingimused</a><a href="/privaatsus">Privaatsuspoliitika</a></nav><small>© 2026 Poeruum · Animaator OÜ</small></footer>
</div>`
