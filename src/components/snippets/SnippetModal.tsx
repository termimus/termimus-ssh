import { useState, useEffect } from "react";
import { X, Terminal, Lock, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { SnippetInput } from "../../lib/api";

export function SnippetModal() {
  const { t } = useTranslation();
  const { isModalOpen, editingSnippet, closeModal, saveSnippet } = useSnippetStore();

  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [showCommandText, setShowCommandText] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingSnippet) {
      setTitle(editingSnippet.title);
      setCommand(editingSnippet.command);
      const isSec = editingSnippet.tags.some((t) => t.toLowerCase() === "secret");
      setIsSecret(isSec);
      setShowCommandText(!isSec);
      const cleanTags = editingSnippet.tags.filter((t) => t.toLowerCase() !== "secret");
      setTagInput(cleanTags.join(", "));
    } else {
      setTitle("");
      setCommand("");
      setTagInput("");
      setIsSecret(false);
      setShowCommandText(true);
    }
    setError(null);
  }, [editingSnippet, isModalOpen]);

  if (!isModalOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError(t("snippets.modal.titleRequired"));
      return;
    }
    if (!command.trim()) {
      setError(t("snippets.modal.commandRequired"));
      return;
    }

    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.toLowerCase() !== "secret");

    if (isSecret) {
      tags.push("secret");
    }

    const input: SnippetInput = {
      title: title.trim(),
      command: command.trim(),
      tags,
    };

    setSubmitting(true);
    try {
      await saveSnippet(input, editingSnippet?.id);
      closeModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-[var(--accent)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {editingSnippet ? t("snippets.modal.titleEdit") : t("snippets.modal.titleNew")}
            </h2>
          </div>
          <button
            onClick={closeModal}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Snippet Type Selector: Standard vs Secret */}
          <div>
            <label className="mb-1.5 block font-medium text-[var(--text-muted)]">
              {t("snippets.modal.typeField")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSecret(false);
                  setShowCommandText(true);
                }}
                className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
                  !isSecret
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] shadow-xs"
                    : "border-[var(--border)] bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Terminal size={16} className={!isSecret ? "text-[var(--primary)]" : "text-[var(--text-muted)]"} />
                <div>
                  <p className="font-semibold text-xs leading-none">{t("snippets.modal.typeStandard")}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{t("snippets.modal.typeStandardDesc")}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSecret(true);
                  setShowCommandText(false);
                }}
                className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
                  isSecret
                    ? "border-[var(--warning)] bg-[var(--warning)]/15 text-[var(--warning)] shadow-xs"
                    : "border-[var(--border)] bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Lock size={16} className={isSecret ? "text-[var(--warning)]" : "text-[var(--text-muted)]"} />
                <div>
                  <p className="font-semibold text-xs leading-none">{t("snippets.modal.typeSecret")}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{t("snippets.modal.typeSecretDesc")}</p>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("snippets.modal.titleField")}
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("snippets.modal.titlePlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-[var(--text-muted)]">
                {isSecret ? t("snippets.modal.commandSecretField") : t("snippets.modal.commandField")}
              </label>
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setShowCommandText((prev) => !prev)}
                  className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  {showCommandText ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{showCommandText ? t("snippets.modal.hideText") : t("snippets.modal.revealText")}</span>
                </button>
              )}
            </div>
            <textarea
              required
              rows={isSecret ? 3 : 6}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={
                isSecret
                  ? t("snippets.modal.commandSecretPlaceholder")
                  : t("snippets.modal.commandPlaceholder")
              }
              style={
                {
                  WebkitTextSecurity: isSecret && !showCommandText ? "disc" : "none",
                } as React.CSSProperties
              }
              className="w-full font-mono rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
            />
            {isSecret && (
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {t("snippets.modal.secretNotice")}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("snippets.modal.tagsField")}
            </label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={t("snippets.modal.tagsPlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-md px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? t("snippets.modal.saving") : editingSnippet ? t("snippets.modal.updateButton") : t("snippets.modal.saveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
