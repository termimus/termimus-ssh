import { useState, useEffect, useId, useRef } from "react";
import {
  X,
  Key,
  Upload,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { api, type KeychainItem, type KeychainKeyInput } from "../../lib/api";
import { copyText } from "../../lib/clipboard";

// Algorithms accepted by the backend's `sshkey::parse_algorithm`.
const GENERATE_ALGORITHMS = [
  { value: "ed25519", label: "Ed25519", defaultName: "id_ed25519" },
  { value: "rsa", label: "RSA", defaultName: "id_rsa" },
  { value: "ecdsa-p256", label: "ECDSA P-256", defaultName: "id_ecdsa" },
] as const;

function isSecurityKeyPublicKey(publicKey: string) {
  const algorithm = publicKey.trim().split(/\s+/, 1)[0];
  return algorithm === "sk-ssh-ed25519@openssh.com" || algorithm === "sk-ecdsa-sha2-nistp256@openssh.com";
}

async function getSshDirectory() {
  try {
    const home = await api.getLocalHomeDir();
    return home ? `${home}/.ssh` : undefined;
  } catch {
    return undefined;
  }
}

function isOpenKeyEditor(editingKey: KeychainItem | null) {
  const current = useKeychainStore.getState();
  return current.isKeyModalOpen && current.editingKey === editingKey;
}

export function KeyModal() {
  const { isKeyModalOpen, editingKey } = useKeychainStore(
    useShallow((s) => ({ isKeyModalOpen: s.isKeyModalOpen, editingKey: s.editingKey }))
  );
  if (!isKeyModalOpen) return null;
  // Keep each editor's secret drafts scoped to its own mount.
  return <KeyEditor key={editingKey?.id ?? "new"} editingKey={editingKey} />;
}

function KeyEditor({ editingKey }: { editingKey: KeychainItem | null }) {
  const { t } = useTranslation();
  const { closeKeyModal, saveKey } = useKeychainStore(
    useShallow((s) => ({ closeKeyModal: s.closeKeyModal, saveKey: s.saveKey }))
  );
  const certificateId = useId();
  const editorActive = useRef(false);
  const [name, setName] = useState(editingKey?.name ?? "");
  const [username, setUsername] = useState(editingKey?.username ?? "");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [userCertificate, setUserCertificate] = useState("");
  const [certificateEdited, setCertificateEdited] = useState(false);
  const [importingCertificate, setImportingCertificate] = useState(false);
  const [passphraseEdited, setPassphraseEdited] = useState(false);
  const [derivedKey, setDerivedKey] = useState<{ pem: string; publicKey: string } | null>(null);
  const [privateKeyChanged, setPrivateKeyChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPrivateKey, setCopiedPrivateKey] = useState(false);

  const [showPrivateKey, setShowPrivateKey] = useState(!editingKey);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loadingKey, setLoadingKey] = useState(Boolean(editingKey));

  // Key generation (new keys only)
  const [generateAlgorithm, setGenerateAlgorithm] = useState<string>("ed25519");
  const [generating, setGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);

  const hasPrivateKey = Boolean(privateKeyPem.trim());
  const derivedPublicKey = derivedKey?.pem === privateKeyPem ? derivedKey.publicKey : "";
  const publicKey = derivedPublicKey || (!privateKeyChanged || !hasPrivateKey ? editingKey?.public_key ?? "" : "");
  const editingKeyType = editingKey?.key_type.toUpperCase();
  const isSecurityKey = derivedPublicKey
    ? isSecurityKeyPublicKey(derivedPublicKey)
    : isSecurityKeyPublicKey(publicKey) || editingKeyType === "ED25519-SK" || editingKeyType === "ECDSA-SK";
  const certificate = userCertificate.trim();
  const showCertificate = Boolean(certificate) || isSecurityKey;

  useEffect(() => {
    let cancelled = false;
    editorActive.current = true;
    if (editingKey) {
      setLoadingKey(true);
      api.getKeychainPrivateKey(editingKey.id)
        .then((details) => {
          if (cancelled || !isOpenKeyEditor(editingKey)) return;
          setPrivateKeyPem(details.private_key_pem);
          setPassphrase(details.passphrase ?? "");
          setUserCertificate(details.user_certificate ?? "");
        })
        .catch(() => {
          // Metadata can still be updated if the vault secret is unavailable.
        })
        .finally(() => {
          if (!cancelled && isOpenKeyEditor(editingKey)) setLoadingKey(false);
        });
    }
    return () => {
      cancelled = true;
      editorActive.current = false;
    };
  }, [editingKey]);

  // Only use a derivation result for the PEM it was derived from.
  useEffect(() => {
    if (!privateKeyPem.trim()) return;
    let cancelled = false;
    api.derivePublicKey(privateKeyPem, passphrase.trim() ? passphrase : undefined)
      .then((pub) => {
        if (!cancelled) setDerivedKey({ pem: privateKeyPem, publicKey: pub });
      })
      .catch(() => {
        // A partial PEM or a missing passphrase must not discard a certificate.
      });
    return () => { cancelled = true; };
  }, [privateKeyPem, passphrase]);

  function isCurrentEditor() {
    return editorActive.current && isOpenKeyEditor(editingKey);
  }

  function replacePrivateKey(pem: string) {
    setPrivateKeyPem(pem);
    setPrivateKeyChanged(true);
    setShowPrivateKey(true);
    setJustGenerated(false);
  }

  async function handleImportKeyFile() {
    setError(null);
    try {
      const defaultPath = await getSshDirectory();
      if (!isCurrentEditor()) return;

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

      if (!isCurrentEditor() || typeof selected !== "string") return;

      if (selected.endsWith(".pub")) {
        setError(t("keychain.keyModal.errorPublicSelected"));
        return;
      }

      const content = await api.readLocalFile(selected);
      if (!isCurrentEditor()) return;
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

      replacePrivateKey(content);

      // Auto-fill name from filename if empty
      const fileName = selected.split(/[\/\\]/).pop() || "imported_key";
      setName((current) => current.trim() ? current : fileName);
    } catch (err) {
      if (isCurrentEditor()) setError(t("keychain.keyModal.errorReadFile", { err: String(err) }));
    }
  }

  async function handleImportCertificate() {
    setError(null);
    setImportingCertificate(true);
    try {
      const defaultPath = await getSshDirectory();
      if (!isCurrentEditor()) return;
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("keychain.keyModal.selectCertificateDialogTitle"),
        defaultPath,
        filters: [{ name: t("keychain.keyModal.certificateFileType"), extensions: ["pub"] }],
      });
      if (!isCurrentEditor() || typeof selected !== "string") return;
      const content = (await api.readLocalFile(selected)).trim();
      if (!isCurrentEditor()) return;
      if (!/^(?:sk-ssh-ed25519|sk-ecdsa-sha2-nistp256)-cert-v01@openssh\.com\s+\S/.test(content)) {
        setError(t("keychain.keyModal.errorInvalidCertificateFile"));
        return;
      }
      setUserCertificate(content);
      setCertificateEdited(true);
    } catch {
      if (isCurrentEditor()) setError(t("keychain.keyModal.errorReadCertificate"));
    } finally {
      if (isCurrentEditor()) setImportingCertificate(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const algo = GENERATE_ALGORITHMS.find((a) => a.value === generateAlgorithm) ?? GENERATE_ALGORITHMS[0];
      const keyName = name.trim() || algo.defaultName;
      const pair = await api.generateKeyPair(algo.value, keyName);
      if (!isCurrentEditor()) return;
      setName((current) => current.trim() ? current : keyName);
      // Generated keys are unencrypted and none of these algorithms use a security key.
      setPassphrase("");
      setUserCertificate("");
      replacePrivateKey(pair.private_key_pem);
      setDerivedKey({ pem: pair.private_key_pem, publicKey: pair.public_key_openssh });
      setShowPrivateKey(false);
      setJustGenerated(true);
    } catch (err) {
      if (isCurrentEditor()) setError(t("keychain.keyModal.errorGenerate", { err: String(err) }));
    } finally {
      if (isCurrentEditor()) setGenerating(false);
    }
  }

  async function handleCopyPrivateKey() {
    try {
      await copyText(privateKeyPem);
      setCopiedPrivateKey(true);
      setTimeout(() => setCopiedPrivateKey(false), 2000);
    } catch (err) {
      setError(t("keychain.keyModal.errorCopy", { err: String(err) }));
    }
  }

  async function handleCopyPublicKey() {
    if (!publicKey) return;
    try {
      await copyText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(t("keychain.keyModal.errorCopy", { err: String(err) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loadingKey || submitting || generating || importingCertificate) return;
    setError(null);

    if (!name.trim()) {
      setError(t("keychain.keyModal.errorNameRequired"));
      return;
    }

    const pem = privateKeyPem.trim();
    if (!editingKey && !pem) {
      setError(t("keychain.keyModal.errorKeyRequired"));
      return;
    }

    if (pem.startsWith("ssh-") || pem.startsWith("ecdsa-") || pem.startsWith("sk-")) {
      setError(t("keychain.keyModal.errorLooksLikePublic"));
      return;
    }

    if (pem && certificate && derivedPublicKey && !isSecurityKey) {
      setError(t("keychain.keyModal.errorCertificateNeedsSecurityKey"));
      return;
    }

    const input: KeychainKeyInput = {
      name: name.trim(),
      key_type: "SSH",
      private_key_pem: !editingKey || privateKeyChanged || passphraseEdited || certificateEdited ? pem : "",
      public_key: publicKey.trim(),
      fingerprint: editingKey?.fingerprint.trim() ?? "",
      passphrase: passphrase.trim() ? passphrase : undefined,
      username: username.trim() ? username.trim() : undefined,
      // Empty removes the certificate; an omitted value leaves it untouched.
      user_certificate: certificateEdited ? certificate : undefined,
    };

    setSubmitting(true);
    try {
      await saveKey(input, editingKey?.id);
      if (isCurrentEditor()) closeKeyModal();
    } catch (err) {
      if (isCurrentEditor()) setError(String(err));
    } finally {
      if (isCurrentEditor()) setSubmitting(false);
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
            aria-label={t("common.close")}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)]">
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
                {(editingKey || justGenerated) && privateKeyPem && (
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
                    onClick={handleCopyPrivateKey}
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
                  disabled={loadingKey}
                  className="flex items-center gap-1 rounded bg-[var(--surface-high)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] border border-[var(--border)] transition cursor-pointer disabled:opacity-50"
                  title={t("keychain.keyModal.importFileTooltip")}
                >
                  <Upload size={11} /> {t("keychain.keyModal.importFile")}
                </button>
              </div>
            </div>

            <textarea
              rows={5}
              value={privateKeyPem}
              disabled={loadingKey}
              onChange={(e) => replacePrivateKey(e.target.value)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                if (loadingKey) return;
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (file.name.endsWith(".pub")) {
                    setError(t("keychain.keyModal.errorPublicDropped"));
                    return;
                  }
                  const text = await file.text();
                  if (!isCurrentEditor()) return;
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
                  replacePrivateKey(text);
                  setName((current) => current.trim() ? current : file.name);
                }
              }}
              placeholder={
                loadingKey
                  ? t("keychain.keyModal.decryptingPrivateKey")
                  : t("keychain.keyModal.pasteKeyPlaceholder")
              }
              className={`w-full font-mono rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none transition-all ${
                (editingKey || justGenerated) && !showPrivateKey && privateKeyPem
                  ? "filter blur-xs select-none"
                  : ""
              }`}
            />

            {!editingKey && (
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="keychain-generate-algo" className="text-[11px] text-[var(--text-muted)]">
                  {t("keychain.keyModal.generateAlgorithm")}
                </label>
                <select
                  id="keychain-generate-algo"
                  value={generateAlgorithm}
                  onChange={(e) => setGenerateAlgorithm(e.target.value)}
                  disabled={generating}
                  className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none cursor-pointer"
                >
                  {GENERATE_ALGORITHMS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  title={t("keychain.keyModal.generateTooltip")}
                  className="flex items-center gap-1 rounded-md border border-[var(--primary)]/40 px-2.5 py-1 text-[11px] font-medium text-[var(--primary)] transition hover:bg-[var(--primary)]/10 disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles size={11} />
                  {generating ? t("keychain.keyModal.generating") : t("keychain.keyModal.generate")}
                </button>
              </div>
            )}

            {justGenerated && (
              <p className="mt-2 text-[11px] text-[var(--success)]">
                {t("keychain.keyModal.generatedHint")}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-muted)]">
              {t("keychain.keyModal.passphraseField")}
            </label>
            <div className="relative">
              <input
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                disabled={loadingKey}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setPassphraseEdited(true);
                }}
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

          {showCertificate && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={certificateId} className="font-medium text-[var(--text-muted)]">
                  {t("keychain.keyModal.certificateField")}
                </label>
                <button
                  type="button"
                  onClick={handleImportCertificate}
                  disabled={loadingKey || importingCertificate || !hasPrivateKey}
                  className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-high)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-highest)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-50 cursor-pointer"
                >
                  <Upload size={11} aria-hidden="true" />
                  {t("keychain.keyModal.importCertificate")}
                </button>
              </div>
              <textarea
                id={certificateId}
                aria-describedby={`${certificateId}-hint`}
                rows={3}
                value={userCertificate}
                disabled={loadingKey || importingCertificate || !hasPrivateKey}
                onChange={(e) => {
                  setUserCertificate(e.target.value);
                  setCertificateEdited(true);
                }}
                autoCapitalize="off"
                spellCheck={false}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-50"
              />
              <p id={`${certificateId}-hint`} className="mt-1 text-[11px] text-[var(--text-muted)]">
                {!loadingKey && !hasPrivateKey
                  ? t("keychain.keyModal.certificateRequiresPrivateKey")
                  : t("keychain.keyModal.certificateHint")}
              </p>
            </div>
          )}

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
              {!certificate && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  {t("keychain.keyModal.publicKeyHint")}
                </p>
              )}
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
              disabled={loadingKey || submitting || generating || importingCertificate}
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
