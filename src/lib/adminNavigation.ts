// Keep swipe navigation in the same order as the admin menu, with settings last.
export const adminViewConfig = {
  overview: { path: '/admin', title: 'Ülevaade' },
  analytics: { path: '/admin/analytics', title: 'Külastatavus' },
  users: { path: '/admin/users', title: 'Kasutajad' },
  campaigns: { path: '/admin/campaigns', title: 'Kampaaniad' },
  seo: { path: '/admin/seo', title: 'SEO' },
  'business-card': { path: '/admin/business-card', title: 'Visiitkaart' },
  leads: { path: '/admin/leads', title: 'Kliendiotsing' },
  support: { path: '/admin/support', title: 'Klienditugi' },
  directory: { path: '/admin/kaubamaja', title: 'Kaubamaja' },
  settings: { path: '/admin/settings', title: 'Seaded' },
}

export type AdminView = keyof typeof adminViewConfig
export const adminViewOrder = Object.keys(adminViewConfig) as AdminView[]
