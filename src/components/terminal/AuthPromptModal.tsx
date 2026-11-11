import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { KeyRound, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, AuthPromptRequest } from "../../lib/api";

/** Classifies a server prompt so the field can show a fitting placeholder and hint. */
function promptKind(prompt: string): "password" | "code" | "answer" {
  if (/code|otp|token|verification|2fa/i.test(prompt)) return "code";
  if (/password|passphrase/i.test(prompt)) return "password";
  return "answer";
}

/**
 * Answers SSH keyboard-interactive prompts (e.g. `AuthenticationMethods
 * publickey,keyboard-interactive` with PAM password + Google Authenticator).
 * Requests come from any in-flight terminal, SFTP or tunnel connection and are
 * queued so concurrent connections each get their own turn.
 */
export function AuthPromptModal() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<AuthPromptRequest[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const current = queue[0];

  useEffect(() => {
    const unlistenPrompt = listen<AuthPromptRequest>("ssh-auth-prompt", (e) =>
      setQueue((q) => [...q, e.payload]),
    );
    // Backend gave up waiting (timeout): drop the stale dialog.
    const unlistenClosed = listen<string>("ssh-auth-prompt-closed", (e) =>
      setQueue((q) => q.filter((r) => r.request_id !== e.payload)),
    );
    return () => {
      unlistenPrompt.then((f) => f());
      unlistenClosed.then((f) => f());
    };
  }, []);

  useEffect(() => {
    setAnswers(current ? current.prompts.map(() => "") : []);
  }, [current]);

  async function finish(responses: string[] | null) {
    if (!current) return;
    setSubmitting(true);
    try {
      await api.respondAuthPrompt(current.request_id, responses);
    } catch (e) {
      console.error("Auth prompt response failed:", e);
    } finally {
      setSubmitting(false);
      setQueue((q) => q.slice(1));
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && current && !submitting) finish(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <form
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting) finish(answers);
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
              <KeyRound size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {current.name || t("terminal.authPrompt.title")}
              </h3>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {t("terminal.authPrompt.subtitle", { target: current.target })}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => finish(null)}
            aria-label={t("common.cancel")}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {current.instructions && (
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3 whitespace-pre-wrap">
            {current.instructions}
          </p>
        )}

        <div className="space-y-3 mb-5">
          {current.prompts.map((p, i) => {
            const kind = promptKind(p.prompt);
            return (
              <label key={`${current.request_id}-${i}`} className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  {p.prompt.trim().replace(/:$/, "")}
                </span>
                <input
                  type={p.echo ? "text" : "password"}
                  autoFocus={i === 0}
                  autoComplete={kind === "code" ? "one-time-code" : "off"}
                  inputMode={kind === "code" ? "numeric" : undefined}
                  placeholder={t(`terminal.authPrompt.${kind}Placeholder`)}
                  value={answers[i] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono outline-none placeholder:font-sans placeholder:text-[var(--text-muted)] focus:border-[var(--primary)]"
                />
                {kind !== "answer" && (
                  <span className="mt-1 block text-[11px] leading-snug text-[var(--text-muted)]">
                    {t(`terminal.authPrompt.${kind}Hint`)}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3.5">
          <button
            type="button"
            disabled={submitting}
            onClick={() => finish(null)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-white transition disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition shadow-sm disabled:opacity-50 bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)]"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            <span>{t("terminal.authPrompt.submit")}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
