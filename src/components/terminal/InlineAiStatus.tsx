import { useEffect } from "react";
import {
  Sparkles,
  Loader2,
  X,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Ban,
  PanelRightOpen,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useAiStore } from "../../stores/useAiStore";

/** How long each finished state stays visible before auto-dismissing (ms). */
const AUTO_HIDE_MS = {
  inserted: 7000,
  review: 9000,
  error: 6000,
  cancelled: 2500,
} as const;

/**
 * Small overlay in the terminal's corner reporting the inline `# prompt`
 * flow: progress (Esc to cancel), the inserted command's risk + explanation,
 * or why it was routed to the Copilot sidebar instead.
 */
export function InlineAiStatus({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const state = useAiStore((s) => s.inline[sessionId]);
  const setInline = useAiStore((s) => s.setInline);
  const openSidebar = useAiStore((s) => s.openSidebar);
  const streaming = useAiStore((s) =>
    state?.status === "generating" ? s.streamingCommand.length : 0
  );

  useEffect(() => {
    if (!state || state.status === "generating") return;
    const timer = setTimeout(() => setInline(sessionId, null), AUTO_HIDE_MS[state.status]);
    return () => clearTimeout(timer);
  }, [state, sessionId, setInline]);

  if (!state) return null;

  const cmd = state.command;
  const tone =
    state.status === "error" || cmd?.risk === "destructive"
      ? "danger"
      : state.status === "review" || cmd?.risk === "modifying"
      ? "warning"
      : "primary";
  const toneClass = {
    danger: "border-[var(--danger)]/40 text-[var(--danger)]",
    warning: "border-[var(--warning)]/40 text-[var(--warning)]",
    primary: "border-[var(--primary)]/40 text-[var(--primary)]",
  }[tone];

  return (
    <div
      className={`absolute bottom-3 right-3 z-30 w-[min(340px,calc(100%-24px))] rounded-xl border bg-[var(--surface-high)]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150 ${toneClass}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {state.status === "generating" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : state.status === "error" ? (
            <AlertTriangle size={13} />
          ) : state.status === "cancelled" ? (
            <Ban size={13} />
          ) : cmd?.risk === "destructive" ? (
            <ShieldAlert size={13} />
          ) : cmd?.risk === "modifying" ? (
            <AlertTriangle size={13} />
          ) : cmd ? (
            <ShieldCheck size={13} />
          ) : (
            <Sparkles size={13} />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <span>
              {state.status === "generating"
                ? streaming > 0
                  ? t("ai.inline.writing")
                  : t("ai.inline.generating")
                : state.status === "inserted"
                ? cmd?.risk === "modifying"
                  ? t("ai.inline.insertedModifying")
                  : t("ai.inline.inserted")
                : state.status === "review"
                ? t("ai.inline.needsReview")
                : state.status === "cancelled"
                ? t("ai.inline.cancelled")
                : t("ai.inline.error")}
            </span>
            {cmd?.needs_sudo && state.status === "inserted" && (
              <span className="rounded-full border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-1.5 text-[9px] text-[var(--warning)]">
                sudo
              </span>
            )}
          </div>

          <div className="truncate font-mono text-[11px] text-[var(--text-secondary)]" title={state.prompt}>
            # {state.prompt}
          </div>

          {state.status === "inserted" && cmd?.explanation && (
            <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {cmd.explanation}
            </div>
          )}

          {state.message && (
            <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {state.message}
            </div>
          )}

          {state.status === "generating" && (
            <div className="text-[10px] text-[var(--text-muted)]">
              <Trans
                i18nKey="ai.inline.escToCancel"
                components={{ kbd: <kbd className="rounded bg-[var(--surface-container-high)] px-1 font-mono" /> }}
              />
            </div>
          )}

          {state.status === "review" && (
            <button
              type="button"
              onClick={() => {
                openSidebar(sessionId);
                setInline(sessionId, null);
              }}
              className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-current/30 px-1.5 py-0.5 text-[10px] font-medium hover:bg-[var(--surface-container-high)] cursor-pointer"
            >
              <PanelRightOpen size={11} /> {t("ai.inline.openCopilot")}
            </button>
          )}
        </div>

        {state.status !== "generating" && (
          <button
            type="button"
            onClick={() => setInline(sessionId, null)}
            className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            title={t("ai.inline.dismiss")}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
