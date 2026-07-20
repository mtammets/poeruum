import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DemoApp from './DemoApp'
import ComingSoon from './ComingSoon'
import './styles.css'
import './brand.css'
import './demo.css'

const isPoeruumHomepage = /^(?:www\.)?poeruum\.ee$/i.test(window.location.hostname)
  && window.location.pathname === '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPoeruumHomepage ? <ComingSoon /> : <DemoApp />}</StrictMode>,
)
