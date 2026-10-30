import { useState, useEffect } from "react";
import { X, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { KeychainIdentityInput } from "../../lib/api";

export function IdentityModal() {
  const { t } = useTranslation();
  const {
    isIdentityModalOpen,
    editingIdentity,
    closeIdentityModal,
    saveIdentity,
  } = useKeychainStore();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingIdentity) {
      setName(editingIdentity.name);
      setUsername(editingIdentity.username ?? "");
      setPassword("");
    } else {
      setName("");
      setUsername("root");
      setPassword("");
    }
    setError(null);
  }, [editingIdentity, isIdentityModalOpen]);

  if (!isIdentityModalOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("keychain.identityModal.nameRequired"));
      return;
    }

    if (!editingIdentity && !password.trim()) {
      setError(t("keychain.identityModal.passwordRequired"));
      return;
    }

    const input: KeychainIdentityInput = {
      name: name.trim(),
      password: password,
      username: username.trim() ? username.trim() : undefined,
    };

    setSubmitting(true);
    try {
      await saveIdentity(input, editingIdentity?.id);
      closeIdentityModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <UserCheck size={18} className="text-[var(--primary)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {editingIdentity ? t("keychain.identityModal.titleEdit") : t("keychain.identityModal.titleNew")}
            </h2>
          </div>
          <button
            onClick={closeIdentityModal}
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
          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("keychain.identityModal.nameField")}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("keychain.identityModal.namePlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("keychain.identityModal.usernameField")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("keychain.identityModal.usernamePlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {editingIdentity
                ? t("keychain.identityModal.passwordFieldEdit")
                : t("keychain.identityModal.passwordField")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("keychain.identityModal.passwordPlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={closeIdentityModal}
              className="rounded-md px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50 cursor-pointer"
            >
              {submitting
                ? t("keychain.identityModal.saving")
                : editingIdentity
                ? t("keychain.identityModal.updateButton")
                : t("keychain.identityModal.saveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
