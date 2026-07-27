import type { SettingsSection } from './storefrontModel'

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'store', label: 'Pood', description: 'Põhiandmed ja nähtavus' },
  { id: 'appearance', label: 'Kujundus', description: 'Logo, värvid ja stiil' },
  { id: 'payments', label: 'Maksed', description: 'Makseviisid ja ühendused' },
  { id: 'delivery', label: 'Tarne', description: 'Pakiautomaadid ja hinnad' },
  { id: 'business', label: 'Müüja', description: 'Ettevõtte andmed' },
  { id: 'links', label: 'Lingid', description: 'Kontakt ja sotsiaalmeedia' },
  { id: 'notifications', label: 'Teavitused', description: 'E-kirjad ja märguanded' },
  { id: 'billing', label: 'Plaan ja tasud', description: 'Pakett ja tasude arvestus' },
  { id: 'account', label: 'Konto', description: 'Väljalogimine ja kustutamine' },
]

export function SettingsSectionIcon({ section }: { section: SettingsSection }) {
  const paths: Record<SettingsSection, string> = {
    store: 'M3 10 12 3l9 7v10H3V10Zm6 10v-6h6v6',
    appearance: 'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5.5A3.5 3.5 0 0 0 21 9.5C21 5.9 17 3 12 3Z',
    payments: 'M3 6h18v12H3V6Zm0 4h18M7 15h4',
    delivery: 'M3 7h11v10H3V7Zm11 4h4l3 3v3h-7v-6ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    business: 'M4 21V7l8-4 8 4v14M8 10h2m4 0h2m-8 4h2m4 0h2m-5 7v-4h2v4',
    links: 'M10 13a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.2 6M14 11a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.6-1.5',
    notifications: 'M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4',
    billing: 'M5 3h14v18l-2-1.5L15 21l-3-1.5L9 21l-2-1.5L5 21V3Zm4 5h6m-6 4h6m-6 4h4',
    account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[section]} /></svg>
}
