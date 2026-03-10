import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Receives the error and a reset function. */
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches render-time errors in its subtree and renders a
 * graceful fallback instead of crashing the entire page.
 *
 * Wrap route-level or widget-level components where isolated failure is
 * acceptable, e.g.:
 *
 *   <ErrorBoundary>
 *     <ChatPanel />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.resetError = this.resetError.bind(this);
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production, pipe this to your observability tool (e.g. Sentry)
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  resetError(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (!hasError || !error) return children;

    if (fallback) return fallback(error, this.resetError);

    // Default fallback UI
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] p-8 bg-white rounded-xl border border-danger/20 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-danger"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-800">Something went wrong</h2>
        </div>

        <p className="text-sm text-gray-500 text-center mb-2 max-w-md">
          An unexpected error occurred while rendering this section.
        </p>

        {import.meta.env.DEV && (
          <details className="mt-4 w-full max-w-lg">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Error details (dev only)
            </summary>
            <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-danger overflow-auto whitespace-pre-wrap border border-gray-200">
              {error.message}
              {'\n\n'}
              {error.stack}
            </pre>
          </details>
        )}

        <button
          onClick={this.resetError}
          className="mt-6 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
