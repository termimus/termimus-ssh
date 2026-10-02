import { useState, useEffect } from "react";
import { Lock, ShieldCheck, KeyRound, Cloud, Server, Eye, EyeOff, X } from "lucide-react";
import { useVaultStore } from "../../stores/useVaultStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { useSyncStore } from "../../stores/useSyncStore";
import { useHostStore } from "../../stores/useHostStore";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useKnownHostsStore } from "../../stores/useKnownHostsStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { api } from "../../lib/api";

export function VaultModal() {
  const {
    isInitialized,
    isUnlocked,
    isUnlockPromptOpen,
    isUnlockPromptDismissable,
    setup,
    unlock,
    refresh,
    error,
    closeUnlockPrompt,
  } = useVaultStore();
  const [setupMode, setSetupMode] = useState<"new" | "sync">("new");

  // New Vault state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Sync Onboarding state
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncAuthToken, setSyncAuthToken] = useState("");
  const [syncPassphrase, setSyncPassphrase] = useState("");
  const [syncMasterPassword, setSyncMasterPassword] = useState("");
  const [showSyncToken, setShowSyncToken] = useState(false);
  const [showSyncPassphrase, setShowSyncPassphrase] = useState(false);
  const [showSyncMasterPassword, setShowSyncMasterPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Clear credentials whenever the vault locks or unlocks
  useEffect(() => {
    if (!isUnlocked) {
      setPassword("");
      setConfirmPassword("");
      setSyncPassphrase("");
      setSyncMasterPassword("");
      setLocalError(null);
    }
  }, [isUnlocked]);

  // Escape cancels the prompt, same convention as the other app modals. Only
  // allowed on in-session prompts: the app-startup prompt and first-run setup
  // are mandatory, the app is unusable until the vault is unlocked.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "Escape" &&
        isInitialized &&
        isUnlockPromptDismissable &&
        isUnlockPromptOpen &&
        !submitting
      ) {
        closeUnlockPrompt();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isInitialized,
    isUnlockPromptDismissable,
    isUnlockPromptOpen,
    submitting,
    closeUnlockPrompt,
  ]);

  if (isUnlocked || !isUnlockPromptOpen) return null;

  async function handleSubmitNew(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!isInitialized) {
      if (password.length < 6) {
        setLocalError("Master password must be at least 6 characters");
        return;
      }
      if (password !== confirmPassword) {
        setLocalError("Passwords do not match");
        return;
      }
      setSubmitting(true);
      try {
        await setup(password);
        setPassword("");
        setConfirmPassword("");
      } catch (err) {
        setLocalError(String(err));
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await unlock(password);
        setPassword("");
      } catch (err) {
        setLocalError(String(err));
      } finally {
        setSubmitting(false);
      }
    }
  }

  async function handleSyncSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    const cleanUrl = syncServerUrl.trim().replace(/\/+$/, "");
    if (!cleanUrl) {
      setLocalError("Sync Server URL is required");
      return;
    }
    if (!syncPassphrase.trim()) {
      setLocalError("Sync Passphrase is required to decrypt the sync bundle");
      return;
    }
    if (!syncMasterPassword) {
      setLocalError("Master Password from original device is required");
      return;
    }

    setSubmitting(true);
    try {
      const headers: HeadersInit = {};
      if (syncAuthToken.trim()) {
        headers["Authorization"] = `Bearer ${syncAuthToken.trim()}`;
      }

      const res = await fetch(`${cleanUrl}/api/v1/sync/bundle`, { headers });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Authentication failed: invalid or missing Auth Token (configured via TERMIMUS_AUTH_TOKEN on your server).");
        }
        if (res.status === 404) {
          throw new Error("No sync data found on server. Please push from your original device first.");
        }
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Sync server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.encrypted_blob) {
        throw new Error("Received empty sync bundle from server");
      }

      // Import into local database with replace_all = true so vault salt and verifiers are adopted
      await api.importBackup(data.encrypted_blob, true, syncPassphrase.trim());

      // Save sync configuration
      const syncStore = useSyncStore.getState();
      syncStore.setServerUrl(cleanUrl);
      syncStore.setAuthToken(syncAuthToken.trim());
      syncStore.setSyncPassword(syncPassphrase.trim());
      syncStore.setAutoSync(true);
      useSyncStore.setState({
        syncStatus: "connected",
        lastSyncAt: new Date().toISOString(),
        latestServerVersion: data.version,
        lastError: null,
      });

      // Unlock vault with master password from original device
      await unlock(syncMasterPassword);
      setSyncPassphrase("");
      setSyncMasterPassword("");

      // Refresh all domain stores
      useHostStore.getState().refresh();
      useKeychainStore.getState().refresh();
      useSnippetStore.getState().refresh();
      useTunnelStore.getState().refresh();
      useKnownHostsStore.getState().refresh();
      useWorkspaceStore.getState().refresh();
    } catch (err) {
      setLocalError(String(err));
      // Refresh vault status in case import succeeded but unlock failed
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      {/* inner panel: explicitly opt out of drag so clicks/inputs work normally */}
      <div
        data-tauri-drag-region="false"
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] shrink-0">
              {isInitialized ? <Lock size={22} /> : setupMode === "sync" ? <Cloud size={22} /> : <ShieldCheck size={22} />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {isInitialized
                  ? "Unlock Termimus Vault"
                  : setupMode === "sync"
                  ? "Sync from Existing Relay"
                  : "Create Master Password"}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {isInitialized
                  ? "Enter your master password to decrypt your credentials."
                  : setupMode === "sync"
                  ? "Connect to your self-hosted relay to restore your vault and credentials."
                  : "Your master password protects all SSH keys and secrets with zero-knowledge AES-256."}
              </p>
            </div>
          </div>
          {isInitialized && isUnlockPromptDismissable && (
            <button
              type="button"
              onClick={closeUnlockPrompt}
              title="Cancel (vault stays locked)"
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Tab switcher for uninitialized vault */}
        {!isInitialized && (
          <div className="mb-4 flex rounded-xl bg-[var(--surface-container)] p-1 border border-[var(--border)] text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setSetupMode("new");
                setLocalError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors ${
                setupMode === "new"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <ShieldCheck size={13} />
              <span>Create New Vault</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSetupMode("sync");
                setLocalError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors ${
                setupMode === "sync"
                  ? "bg-[var(--primary)] text-[var(--on-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Cloud size={13} />
              <span>Restore from Sync</span>
            </button>
          </div>
        )}

        {(localError || error) && (
          <div className="mb-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] leading-relaxed">
            {localError || error}
          </div>
        )}

        {/* Form: Standard Setup / Unlock */}
        {(isInitialized || setupMode === "new") && (
          <form onSubmit={handleSubmitNew} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Master Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  autoFocus
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
                />
                <KeyRound
                  size={16}
                  className="absolute left-3 top-2.5 text-[var(--text-muted)]"
                />
              </div>
            </div>

            {!isInitialized && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Confirm Master Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoComplete="off"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password..."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
                  />
                  <KeyRound
                    size={16}
                    className="absolute left-3 top-2.5 text-[var(--text-muted)]"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password}
              className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {submitting
                ? "Verifying..."
                : isInitialized
                ? "Unlock Vault"
                : "Create Vault"}
            </button>

            {isInitialized && (
              <div className="pt-2 text-center border-t border-[var(--border)]/50">
                <button
                  type="button"
                  onClick={() => {
                    useConfirmStore.getState().confirm({
                      title: "Reset Master Password & Vault?",
                      message:
                        "Forgot your master password? You can reset the vault to start fresh. WARNING: All stored credentials, passwords, and SSH keys will be permanently deleted.",
                      confirmLabel: "Reset Vault",
                      isDanger: true,
                      onConfirm: async () => {
                        await api.resetVault();
                        await refresh();
                      },
                    });
                  }}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors underline"
                >
                  Forgot Master Password? Reset Vault
                </button>
              </div>
            )}
          </form>
        )}

        {/* Form: Restore from Sync Relay */}
        {!isInitialized && setupMode === "sync" && (
          <form onSubmit={handleSyncSubmit} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Sync Server URL *
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={syncServerUrl}
                  onChange={(e) => setSyncServerUrl(e.target.value)}
                  placeholder="e.g. https://sync.yourdomain.com or http://192.168.1.50:8080"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pl-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <Server
                  size={15}
                  className="absolute left-3 top-2.5 text-[var(--text-muted)]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Auth Token (If configured on server)
              </label>
              <div className="relative">
                <input
                  type={showSyncToken ? "text" : "password"}
                  value={syncAuthToken}
                  onChange={(e) => setSyncAuthToken(e.target.value)}
                  placeholder="Bearer token if set via TERMIMUS_AUTH_TOKEN..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncToken(!showSyncToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
                >
                  {showSyncToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Leave blank if your relay runs in open mode without a token.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Sync Passphrase (E2E Encryption) *
              </label>
              <div className="relative">
                <input
                  type={showSyncPassphrase ? "text" : "password"}
                  autoComplete="off"
                  value={syncPassphrase}
                  onChange={(e) => setSyncPassphrase(e.target.value)}
                  placeholder="Passphrase used to encrypt the backup..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncPassphrase(!showSyncPassphrase)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
                >
                  {showSyncPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Decrypts the snapshot bundle sent by your primary device.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Master Password (from Primary Device) *
              </label>
              <div className="relative">
                <input
                  type={showSyncMasterPassword ? "text" : "password"}
                  autoComplete="off"
                  value={syncMasterPassword}
                  onChange={(e) => setSyncMasterPassword(e.target.value)}
                  placeholder="Enter original vault password..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pl-9 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <KeyRound
                  size={15}
                  className="absolute left-3 top-2.5 text-[var(--text-muted)]"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncMasterPassword(!showSyncMasterPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
                >
                  {showSyncMasterPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Unlocks the restored vault and decrypts your SSH keys.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || !syncServerUrl || !syncPassphrase || !syncMasterPassword}
              className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Cloud size={14} />
              <span>{submitting ? "Connecting & Restoring..." : "Restore & Unlock Vault"}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
