import { Component } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    import('../services/analytics.js').then(({ reportError }) => {
      reportError(error, errorInfo?.componentStack?.split('\n')?.[1]?.trim())
    }).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            Something went wrong
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 max-w-sm">
            {this.state.error?.message || 'An unexpected error occurred. Please try refreshing.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
