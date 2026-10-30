import { useState, useEffect } from "react";
import { Lock, ShieldCheck, KeyRound, Cloud, Server, Eye, EyeOff, Fingerprint, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "../../stores/useVaultStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
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
  const { t } = useTranslation();
  const {
    isInitialized,
    isUnlocked,
    isUnlockPromptOpen,
    isUnlockPromptDismissable,
    setup,
    unlock,
    unlockWithBiometric,
    isBiometricSupported,
    refresh,
    error,
    closeUnlockPrompt,
  } = useVaultStore();
  const { useBiometrics } = useSettingsStore();
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
  const [biometricUnlocking, setBiometricUnlocking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleBiometricUnlock() {
    setLocalError(null);
    setBiometricUnlocking(true);
    try {
      const success = await unlockWithBiometric();
      if (!success) {
        setLocalError("Biometric authentication was cancelled or not recognized.");
      }
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBiometricUnlocking(false);
    }
  }

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
        setLocalError(t("vault.modal.errorMinLength"));
        return;
      }
      if (password !== confirmPassword) {
        setLocalError(t("vault.modal.errorMismatch"));
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
      setLocalError(t("vault.modal.errorSyncUrl"));
      return;
    }
    if (!syncPassphrase.trim()) {
      setLocalError(t("vault.modal.errorSyncPassphrase"));
      return;
    }
    if (!syncMasterPassword) {
      setLocalError(t("vault.modal.errorSyncMasterPassword"));
      return;
    }

    setSubmitting(true);
    try {
      // Native Rust HTTP pull (CSP blocks webview fetch to arbitrary hosts).
      // replace_all = true so vault salt and verifiers are adopted.
      await api.syncPull(cleanUrl, syncPassphrase.trim(), syncAuthToken.trim(), true);

      // Save sync configuration
      const syncStore = useSyncStore.getState();
      syncStore.setServerUrl(cleanUrl);
      syncStore.setAuthToken(syncAuthToken.trim());
      syncStore.setSyncPassword(syncPassphrase.trim());
      syncStore.setAutoSync(true);
      useSyncStore.setState({
        syncStatus: "connected",
        lastSyncAt: new Date().toISOString(),
        latestServerVersion: null,
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
                  ? t("vault.modal.unlockTitle")
                  : setupMode === "sync"
                  ? t("vault.modal.syncOnboardingTitle")
                  : t("vault.modal.createTitle")}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {isInitialized
                  ? t("vault.modal.unlockDesc")
                  : setupMode === "sync"
                  ? t("vault.modal.syncOnboardingDesc")
                  : t("vault.modal.createDesc")}
              </p>
            </div>
          </div>
          {isInitialized && isUnlockPromptDismissable && (
            <button
              type="button"
              onClick={closeUnlockPrompt}
              title={t("vault.modal.cancelStayLockedTooltip")}
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition-colors shrink-0 cursor-pointer"
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
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                setupMode === "new"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <ShieldCheck size={13} />
              <span>{t("vault.modal.tabCreateNew")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSetupMode("sync");
                setLocalError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                setupMode === "sync"
                  ? "bg-[var(--primary)] text-[var(--on-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Cloud size={13} />
              <span>{t("vault.modal.tabRestoreSync")}</span>
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
            {isInitialized && isBiometricSupported && useBiometrics && (
              <div className="space-y-3 pb-1">
                <button
                  type="button"
                  disabled={biometricUnlocking || submitting}
                  onClick={handleBiometricUnlock}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/18 text-[var(--primary)] py-2.5 px-4 text-sm font-semibold transition shadow-sm hover:shadow active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                >
                  <Fingerprint size={18} className={biometricUnlocking ? "animate-pulse" : ""} />
                  <span>{biometricUnlocking ? t("vault.waitingForTouchId") : t("vault.unlockWithTouchId")}</span>
                </button>

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
                    {t("vault.orEnterPassword")}
                  </span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                {t("vault.masterPassword")}
              </label>
              <div className="relative">
                <input
                  type="password"
                  autoFocus={!useBiometrics}
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("vault.modal.enterPasswordPlaceholder")}
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
                  {t("vault.modal.confirmMasterPassword")}
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoComplete="off"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("vault.modal.repeatPasswordPlaceholder")}
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
              className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
            >
              {submitting
                ? t("vault.modal.verifying")
                : isInitialized
                ? t("vault.modal.unlockVaultBtn")
                : t("vault.modal.createVaultBtn")}
            </button>

            {isInitialized && (
              <div className="pt-2 text-center border-t border-[var(--border)]/50">
                <button
                  type="button"
                  onClick={() => {
                    useConfirmStore.getState().confirm({
                      title: t("vault.modal.resetConfirm.title"),
                      message: t("vault.modal.resetConfirm.message"),
                      confirmLabel: t("vault.modal.resetConfirm.confirmLabel"),
                      isDanger: true,
                      onConfirm: async () => {
                        await api.resetVault();
                        await refresh();
                      },
                    });
                  }}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors underline cursor-pointer"
                >
                  {t("vault.modal.forgotPasswordBtn")}
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
                {t("vault.modal.syncServerUrl")}
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={syncServerUrl}
                  onChange={(e) => setSyncServerUrl(e.target.value)}
                  placeholder={t("vault.modal.syncServerUrlPlaceholder")}
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
                {t("vault.modal.syncAuthToken")}
              </label>
              <div className="relative">
                <input
                  type={showSyncToken ? "text" : "password"}
                  value={syncAuthToken}
                  onChange={(e) => setSyncAuthToken(e.target.value)}
                  placeholder={t("vault.modal.syncAuthTokenPlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncToken(!showSyncToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
                >
                  {showSyncToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t("vault.modal.syncAuthTokenHint")}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                {t("vault.modal.syncPassphrase")}
              </label>
              <div className="relative">
                <input
                  type={showSyncPassphrase ? "text" : "password"}
                  autoComplete="off"
                  value={syncPassphrase}
                  onChange={(e) => setSyncPassphrase(e.target.value)}
                  placeholder={t("vault.modal.syncPassphrasePlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncPassphrase(!showSyncPassphrase)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
                >
                  {showSyncPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t("vault.modal.syncPassphraseHint")}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                {t("vault.modal.syncMasterPassword")}
              </label>
              <div className="relative">
                <input
                  type={showSyncMasterPassword ? "text" : "password"}
                  autoComplete="off"
                  value={syncMasterPassword}
                  onChange={(e) => setSyncMasterPassword(e.target.value)}
                  placeholder={t("vault.modal.syncMasterPasswordPlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pl-9 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <KeyRound
                  size={15}
                  className="absolute left-3 top-2.5 text-[var(--text-muted)]"
                />
                <button
                  type="button"
                  onClick={() => setShowSyncMasterPassword(!showSyncMasterPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
                >
                  {showSyncMasterPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t("vault.modal.syncMasterPasswordHint")}
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || !syncServerUrl || !syncPassphrase || !syncMasterPassword}
              className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Cloud size={14} />
              <span>{submitting ? t("vault.modal.connectingAndRestoring") : t("vault.modal.restoreAndUnlockBtn")}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
