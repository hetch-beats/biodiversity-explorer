import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render errors anywhere below it. Without this, a bug triggered by
 * one species' data (a bad field, an unexpected null) would silently blank
 * the entire app with no clue why — React unmounts everything above the
 * failing component on an uncaught render error. This shows a visible
 * message and logs the full component stack instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-[rgb(var(--bg-primary))] text-[rgb(var(--text-primary))] p-6">
          <div className="max-w-md text-center space-y-3">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-[rgb(var(--text-secondary))]">{this.state.error.message}</p>
            <p className="text-xs text-[rgb(var(--text-secondary))]">
              Details were logged to the DevTools console.
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="h-control px-4 text-xs rounded-md border border-[rgb(var(--border))] hover:bg-[rgb(var(--bg-elevated))]"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
