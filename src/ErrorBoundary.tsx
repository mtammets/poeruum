import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from './lib/errorMonitoring'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, 'react-boundary', info.componentStack ?? '')
  }

  render() {
    if (this.state.failed) {
      return <main className="fatal-error" role="alert">
        <span>POERUUM</span>
        <h1>Midagi läks valesti</h1>
        <p>Viga saadeti automaatselt Poeruumi tehnilisele toele. Palun laadi leht uuesti.</p>
        <button type="button" onClick={() => {
          if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
          window.location.reload()
        }}>Laadi uuesti</button>
      </main>
    }
    return this.props.children
  }
}
