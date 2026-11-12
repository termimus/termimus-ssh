import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";
import i18n from "../../i18n";

interface ErrorBoundaryProps {
  /** Short name of the wrapped area, used in the console log. */
  scope: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors in one area of the app so a single broken page shows
 * a recoverable fallback instead of unmounting the whole window (which, for a
 * frameless Tauri window, leaves the user with a blank screen and no controls).
 *
 * Class component because React only supports error boundaries as classes;
 * strings come from the i18n instance directly for the same reason.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.scope}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const t = i18n.t.bind(i18n);
    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-auto bg-[var(--canvas)] p-6 text-center text-[var(--text-primary)]"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]">
          <AlertTriangle size={22} />
        </div>
        <div className="max-w-md">
          <h2 className="text-sm font-semibold">{t("common.errorBoundary.title")}</h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t("common.errorBoundary.description")}
          </p>
        </div>

        <details className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3 py-2 text-left">
          <summary className="cursor-pointer text-xs text-[var(--text-secondary)] select-none">
            {t("common.errorBoundary.details")}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-muted)]">
            {error.stack || String(error)}
          </pre>
        </details>

        <div className="flex items-center gap-2">
          <button
            onClick={this.reset}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-[var(--primary)]/90 transition-colors cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>{t("common.errorBoundary.retry")}</span>
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>{t("common.errorBoundary.reload")}</span>
          </button>
        </div>
      </div>
    );
  }
}
