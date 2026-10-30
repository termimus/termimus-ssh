import { useState, useEffect } from "react";
import { X, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostStore } from "../../stores/useHostStore";

export function FolderModal() {
  const { t } = useTranslation();
  const { isFolderModalOpen, editingFolder, closeFolderModal, saveFolder } = useHostStore();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(editingFolder?.name ?? "");
    setError(null);
  }, [editingFolder, isFolderModalOpen]);

  if (!isFolderModalOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("hosts.folderModal.nameRequired"));
      return;
    }

    setSubmitting(true);
    try {
      await saveFolder(name.trim(), editingFolder?.parent_id ?? undefined, editingFolder?.id);
      closeFolderModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <FolderPlus size={17} className="text-[var(--primary)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {editingFolder ? t("hosts.folderModal.titleEdit") : t("hosts.folderModal.titleNew")}
            </h2>
          </div>
          <button
            onClick={closeFolderModal}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              {t("hosts.folderModal.nameField")}
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("hosts.folderModal.namePlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeFolderModal}
              className="rounded-md px-3.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? t("hosts.folderModal.saving") : editingFolder ? t("hosts.folderModal.saveButton") : t("hosts.folderModal.createButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
