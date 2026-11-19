import { Component, type ReactNode } from 'react'

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="shell-width main-content" role="alert">
          <h1 className="text-3xl font-semibold">The app could not open</h1>
          <p className="mt-4 text-muted">Reload the page to try again.</p>
          <button
            className="text-link mt-6 min-h-12 cursor-pointer"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
