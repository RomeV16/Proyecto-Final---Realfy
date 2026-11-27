'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Root error boundary — catches unhandled JS errors and renders a fallback
 * instead of a white screen. Users can retry to recover.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          className="flex items-center justify-center min-h-[60vh] px-4"
        >
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] flex items-center justify-center mx-auto">
              <svg
                aria-hidden="true"
                className="w-7 h-7 text-[var(--color-danger)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              No pudimos mostrar esta pantalla
            </h2>
            <p className="text-sm text-[var(--color-muted)]">
              Probá de nuevo. Si sigue pasando, recargá la página.
            </p>
            {this.state.error && (
              <p className="text-xs text-[var(--color-muted)] font-mono bg-[var(--color-surface-sunken)] rounded-lg p-3 text-left break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-5 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
