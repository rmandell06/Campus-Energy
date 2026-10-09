import React from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useErrorReporter } from './ErrorBoundary';

interface BoundaryProps {
  children: React.ReactNode;
  onError?: (error: unknown) => void;
  onReset: () => void;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Real React error boundary (class component) — the only kind that can catch an
 * error thrown during a page's render. `ErrorReporterProvider` only forwards
 * errors reported by hand from event handlers; it does NOT stop a render crash
 * (e.g. a hooks-order violation) from white-screening the whole app. This
 * catches that crash, shows a recoverable fallback, and keeps the app chrome
 * (TopNav / SideNav) alive so the user can navigate away.
 */
class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[60vh] items-center justify-center p-8">
          <div className="panel max-w-md p-6 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--c3-style-basic-bg-accent)]">
              <AlertTriangle className="size-5 text-[var(--energy-on)]" aria-hidden />
            </div>
            <h2 className="font-display text-lg text-[var(--mono-ink)]">This page hit a snag</h2>
            <p className="mono mt-2 break-words text-xs text-[var(--mono-ink-2)]">
              {this.state.error.message || 'An unexpected error occurred while rendering.'}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset();
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--c3-style-border-radius-4)] border border-[var(--mono-hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--mono-ink)] hover:bg-[var(--c3-style-basic-bg-accent)]"
            >
              <RotateCcw className="size-3.5" /> Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Per-page wrapper. Keyed by pathname so navigating to any other route mounts a
 * fresh boundary (an errored page recovers simply by navigating away), and
 * forwards caught render errors to the Genesis error reporter.
 */
export default function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { reportError } = useErrorReporter();
  const [resetKey, setResetKey] = React.useState(0);
  return (
    <Boundary
      key={`${pathname}:${resetKey}`}
      onError={reportError}
      onReset={() => setResetKey((k) => k + 1)}
    >
      {children}
    </Boundary>
  );
}
