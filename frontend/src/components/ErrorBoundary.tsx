import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors anywhere in the tree so a throw in one
 * component (a chart with malformed data, say) degrades to a recovery
 * panel instead of white-screening the whole app.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center"
          style={{ background: '#0C0C0E', color: '#E8E6E1' }}
        >
          <p className="font-display text-lg" style={{ color: '#D4A843' }}>
            Something went wrong
          </p>
          <p className="text-sm" style={{ color: '#9A9A9D' }}>
            An unexpected error interrupted this view. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-4 py-2 rounded-lg mt-2"
            style={{ background: '#D4A84320', color: '#D4A843' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
