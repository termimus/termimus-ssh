import { useState, useEffect } from "react";
import {
  X,
  Key,
  Upload,
  Copy,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { api, KeychainKeyInput } from "../../lib/api";

export function KeyModal() {
  const { t } = useTranslation();
  const { isKeyModalOpen, editingKey, closeKeyModal, saveKey } =
    useKeychainStore();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPrivateKey, setCopiedPrivateKey] = useState(false);

  // Private key & passphrase visibility states
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loadingKey, setLoadingKey] = useState(false);

  useEffect(() => {
    if (editingKey) {
      setName(editingKey.name);
      setUsername(editingKey.username ?? "");
      setPublicKey(editingKey.public_key);
      setFingerprint(editingKey.fingerprint);

      setPrivateKeyPem("");
      setPassphrase("");
      setShowPrivateKey(false);
      setShowPassphrase(false);
      setLoadingKey(true);

      // Decrypt and load the private key and passphrase from the vault
      api
        .getKeychainPrivateKey(editingKey.id)
        .then((details) => {
          setPrivateKeyPem(details.private_key_pem);
          if (details.passphrase) {
            setPassphrase(details.passphrase);
          }
        })
        .catch((err) => {
          console.warn("Could not load private key from vault:", err);
        })
        .finally(() => {
          setLoadingKey(false);
        });
    } else {
      setName("");
      setUsername("");
      setPrivateKeyPem("");
      setPassphrase("");
      setPublicKey("");
      setFingerprint("");
      setShowPrivateKey(true);
      setShowPassphrase(false);
    }
    setError(null);
  }, [editingKey, isKeyModalOpen]);

  // Derive public key whenever PEM or passphrase changes
  useEffect(() => {
    if (!privateKeyPem.trim()) {
      if (!editingKey) {
        setPublicKey("");
        setFingerprint("");
      }
      return;
    }

    let cancelled = false;
    api
      .derivePublicKey(
        privateKeyPem,
        passphrase.trim() ? passphrase : undefined
      )
      .then((pub) => {
        if (!cancelled) {
          setPublicKey(pub);
        }
      })
      .catch(() => {
        if (!cancelled && !editingKey) {
          setPublicKey("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [privateKeyPem, passphrase, editingKey]);

  if (!isKeyModalOpen) return null;

  async function handleImportKeyFile() {
    setError(null);
    try {
      let defaultPath: string | undefined;
      try {
        const home = await api.getLocalHomeDir();
        if (home) {
          defaultPath = `${home}/.ssh`;
        }
      } catch {
        // ignore fallback
      }

      // Tauri's file filter only matches on the part after a dot, but common
      // SSH key filenames (id_rsa, id_ed25519, ...) have no extension at all —
      // filtering on those names would hide every real key file from the
      // explorer. So the picker stays unfiltered and the content checks below
      // enforce that only a valid private key is accepted.
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("keychain.keyModal.selectFileDialogTitle"),
        defaultPath,
      });

      if (!selected || typeof selected !== "string") return;

      if (selected.endsWith(".pub")) {
        setError(t("keychain.keyModal.errorPublicSelected"));
        return;
      }

      const content = await api.readLocalFile(selected);
      const trimmed = content.trim();

      if (
        trimmed.startsWith("ssh-") ||
        trimmed.startsWith("ecdsa-") ||
        trimmed.startsWith("sk-") ||
        trimmed.includes("PUBLIC KEY")
      ) {
        setError(t("keychain.keyModal.errorPublicContent"));
        return;
      }

      if (
        !trimmed.includes("PRIVATE KEY") &&
        !trimmed.includes("PuTTY-User-Key-File")
      ) {
        setError(t("keychain.keyModal.errorInvalidKey"));
        return;
      }

      setPrivateKeyPem(content);
      setShowPrivateKey(true);

      // Auto-fill name from filename if empty
      if (!name.trim()) {
        const parts = selected.split(/[\/\\]/);
        const fileName = parts[parts.length - 1] || "imported_key";
        setName(fileName);
      }
    } catch (err) {
      setError(t("keychain.keyModal.errorReadFile", { err: String(err) }));
    }
  }

  async function handleCopyPublicKey() {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(t("keychain.keyModal.errorCopy", { err: String(err) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("keychain.keyModal.errorNameRequired"));
      return;
    }

    if (!editingKey && !privateKeyPem.trim()) {
      setError(t("keychain.keyModal.errorKeyRequired"));
      return;
    }

    if (
      privateKeyPem.trim() &&
      (privateKeyPem.trim().startsWith("ssh-") ||
        privateKeyPem.trim().startsWith("ecdsa-") ||
        privateKeyPem.trim().startsWith("sk-"))
    ) {
      setError(t("keychain.keyModal.errorLooksLikePublic"));
      return;
    }

    const input: KeychainKeyInput = {
      name: name.trim(),
      key_type: "SSH",
      private_key_pem: privateKeyPem.trim(),
      public_key: publicKey.trim(),
      fingerprint: fingerprint.trim(),
      passphrase: passphrase.trim() ? passphrase : undefined,
      username: username.trim() ? username.trim() : undefined,
    };

    setSubmitting(true);
    try {
      await saveKey(input, editingKey?.id);
      closeKeyModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {editingKey ? t("keychain.keyModal.titleEdit") : t("keychain.keyModal.titleNew")}
          </h2>
          <button
            onClick={closeKeyModal}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("keychain.keyModal.nameField")}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("keychain.keyModal.namePlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("keychain.keyModal.usernameField")}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("keychain.keyModal.usernamePlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="font-medium text-[var(--text-muted)]">
                  {t("keychain.keyModal.privateKeyField")}
                </label>
                {editingKey && privateKeyPem && (
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="flex items-center gap-1 rounded bg-[var(--surface-high)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] border border-[var(--border)] transition-colors cursor-pointer"
                    title={showPrivateKey ? t("keychain.keyModal.hideKeyTooltip") : t("keychain.keyModal.revealKeyTooltip")}
                  >
                    {showPrivateKey ? <EyeOff size={11} /> : <Eye size={11} />}
                    <span>{showPrivateKey ? t("keychain.keyModal.hidePrivateKey") : t("keychain.keyModal.revealPrivateKey")}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {privateKeyPem && (
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(privateKeyPem);
                      setCopiedPrivateKey(true);
                      setTimeout(() => setCopiedPrivateKey(false), 2000);
                    }}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition cursor-pointer ${
                      copiedPrivateKey
                        ? "bg-[var(--success)] text-black font-semibold"
                        : "bg-[var(--surface-high)] text-[var(--text-primary)] hover:bg-[var(--surface-highest)] border border-[var(--border)]"
                    }`}
                    title={t("keychain.keyModal.copyPrivateKeyTooltip")}
                  >
                    {copiedPrivateKey ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedPrivateKey ? t("keychain.keyModal.copiedPrivateKey") : t("keychain.keyModal.copyPrivateKey")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleImportKeyFile}
                  className="flex items-center gap-1 rounded bg-[var(--surface-high)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] border border-[var(--border)] transition cursor-pointer"
                  title={t("keychain.keyModal.importFileTooltip")}
                >
                  <Upload size={11} /> {t("keychain.keyModal.importFile")}
                </button>
              </div>
            </div>

            <textarea
              rows={5}
              value={privateKeyPem}
              onChange={(e) => {
                setPrivateKeyPem(e.target.value);
                setShowPrivateKey(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (file.name.endsWith(".pub")) {
                    setError(t("keychain.keyModal.errorPublicDropped"));
                    return;
                  }
                  const text = await file.text();
                  const trimmed = text.trim();
                  if (
                    trimmed.startsWith("ssh-") ||
                    trimmed.startsWith("ecdsa-") ||
                    trimmed.startsWith("sk-") ||
                    trimmed.includes("PUBLIC KEY")
                  ) {
                    setError(t("keychain.keyModal.errorPublicContentDropped"));
                    return;
                  }
                  setPrivateKeyPem(text);
                  setShowPrivateKey(true);
                  if (!name.trim()) {
                    setName(file.name);
                  }
                }
              }}
              placeholder={
                loadingKey
                  ? t("keychain.keyModal.decryptingPrivateKey")
                  : t("keychain.keyModal.pasteKeyPlaceholder")
              }
              className={`w-full font-mono rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none transition-all ${
                editingKey && !showPrivateKey && privateKeyPem
                  ? "filter blur-xs select-none"
                  : ""
              }`}
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("keychain.keyModal.passphraseField")}
            </label>
            <div className="relative">
              <input
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={t("keychain.keyModal.passphrasePlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
              {passphrase && (
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title={showPassphrase ? t("keychain.keyModal.hidePassphrase") : t("keychain.keyModal.showPassphrase")}
                >
                  {showPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          </div>

          {/* Public Key Display / Copy Box */}
          {publicKey && (
            <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--surface-low)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Key size={13} className="text-[var(--primary)]" />
                  <span className="font-semibold text-xs text-[var(--text-primary)]">
                    {t("keychain.keyModal.publicKeySection")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyPublicKey}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    copied
                      ? "bg-[var(--success)] text-black font-semibold"
                      : "bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)] font-semibold"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check size={12} /> {t("common.copied")}
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> {t("keychain.copyPublicKey")}
                    </>
                  )}
                </button>
              </div>
              <div className="rounded bg-[var(--canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] select-all break-all border border-[var(--border)] max-h-16 overflow-y-auto">
                {publicKey}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t("keychain.keyModal.publicKeyHint")}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={closeKeyModal}
              className="rounded-md px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? t("keychain.keyModal.saving") : editingKey ? t("keychain.keyModal.updateButton") : t("keychain.keyModal.saveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
