import { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfirmStore } from "../../stores/useConfirmStore";

export function ConfirmModal() {
  const { t } = useTranslation();
  const { isOpen, options, close } = useConfirmStore();
  const [submitting, setSubmitting] = useState(false);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !submitting) {
        close();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, close]);

  if (!isOpen || !options) return null;

  const {
    title,
    message,
    confirmLabel = t("common.delete"),
    cancelLabel = t("common.cancel"),
    isDanger = true,
    onConfirm,
  } = options;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
      close();
    } catch (e) {
      console.error("Confirm action failed:", e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) close();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Icon + Title */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isDanger
                  ? "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/30"
                  : "bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30"
              }`}
            >
              {isDanger ? <Trash2 size={18} /> : <AlertTriangle size={18} />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={close}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-5 pl-0.5">
          {message}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3.5">
          <button
            type="button"
            disabled={submitting}
            onClick={close}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-white transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirm}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition shadow-sm disabled:opacity-50 ${
              isDanger
                ? "bg-[var(--danger)] hover:bg-red-600"
                : "bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)]"
            }`}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

