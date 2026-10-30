import { useState, useEffect, useRef } from "react";
import {
  Archive,
  Lock,
  LockOpen,
  ShieldCheck,
  KeyRound,
  Fingerprint,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Server,
  RotateCw,
  Trash2,
  ShieldAlert,
  Palette,
  Cloud,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { GeneralTab } from "./GeneralTab";
import { BackupRestoreSection } from "../vault/BackupRestoreSection";
import { SyncSection } from "../sync/SyncSection";
import { TerminalThemeTab } from "./TerminalThemeTab";
import { useVaultStore } from "../../stores/useVaultStore";
import { useKnownHostsStore } from "../../stores/useKnownHostsStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { useUpdateStore } from "../../stores/useUpdateStore";
import {
  useSettingsStore,
  AutoLockPolicy,
} from "../../stores/useSettingsStore";
import { CustomSelect } from "../ui/CustomSelect";
import { api } from "../../lib/api";

type SettingsTab = "general" | "security" | "terminal" | "sync" | "known_hosts" | "backup";

export function SettingsView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { knownHosts } = useKnownHostsStore();
  const { hasUpdate } = useUpdateStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const tabs: {
    id: SettingsTab;
    label: string;
    icon: typeof Lock | typeof SlidersHorizontal;
    badge?: number;
    badgeDot?: boolean;
  }[] = [
    { id: "general", label: t("settings.tabs.general"), icon: SlidersHorizontal, badgeDot: hasUpdate },
    { id: "security", label: t("settings.tabs.security"), icon: Lock },
    { id: "terminal", label: t("settings.tabs.terminal"), icon: Palette },
    { id: "sync", label: t("settings.tabs.sync"), icon: Cloud },
    {
      id: "known_hosts",
      label: t("settings.tabs.knownHosts"),
      icon: ShieldCheck,
      badge: knownHosts.length || undefined,
    },
    { id: "backup", label: t("settings.tabs.backup"), icon: Archive },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)] select-none overflow-hidden">
      {/* ── Fixed Top Header & Navigation ─────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-container)]/30 px-6 pt-5 pb-4 backdrop-blur-xs">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
                {t("settings.title")}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t("settings.subtitle")}
              </p>
            </div>
          </div>

          {/* ── Native Segmented Tab Control ──────────────────────────────── */}
          <div className="flex items-center overflow-x-auto py-0.5">
            <nav
              role="tablist"
              aria-label="Settings sections"
              className="inline-flex items-center gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--surface-low)] shrink-0"
            >
              {tabs.map(({ id, label, icon: Icon, badge, badgeDot }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => {
                      if (activeTab !== id) {
                        setActiveTab(id);
                        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "instant" });
                      }
                    }}
                    className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer select-none transition-colors duration-150 border ${
                      active
                        ? "bg-[var(--surface-high)] text-[var(--text-primary)] shadow-xs border-[var(--border-subtle)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container)]/60 border-transparent"
                    }`}
                  >
                    <Icon
                      size={14}
                      className={`shrink-0 transition-colors duration-150 ${
                        active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
                      }`}
                    />
                    <span className="whitespace-nowrap">{label}</span>
                    {badge !== undefined && (
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono leading-none transition-colors duration-150 ${
                          active
                            ? "bg-[var(--primary)]/20 text-[var(--primary)] font-semibold"
                            : "bg-[var(--surface-highest)] text-[var(--text-muted)]"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                    {badgeDot && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* ── Scrollable Tab Content ────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]"
      >
        <div className="w-full">
          {activeTab === "general" && <GeneralTab />}
          {activeTab === "security" && <SecurityVaultTab />}
          {activeTab === "terminal" && <TerminalThemeTab />}
          {activeTab === "sync" && <SyncSection />}
          {activeTab === "known_hosts" && <KnownHostsTab />}
          {activeTab === "backup" && <BackupRestoreSection />}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: SECURITY & VAULT
// ══════════════════════════════════════════════════════════════════════════════

function SecurityVaultTab() {
  const { t } = useTranslation();
  const { isUnlocked, isInitialized, lock: lockVault, refresh: refreshVault, isBiometricSupported, openUnlockPrompt } = useVaultStore();
  const { useOsKeyring, setUseOsKeyring, useBiometrics, setUseBiometrics, autoLockPolicy, setAutoLockPolicy } = useSettingsStore();

  const [keyringLoading, setKeyringLoading] = useState(false);
  const [keyringError, setKeyringError] = useState<string | null>(null);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  async function handleToggleKeyring(enable: boolean) {
    setKeyringError(null);
    setKeyringLoading(true);
    try {
      if (enable) {
        if (!isUnlocked) {
          setKeyringError("Please unlock the vault first to save the key to OS Keyring.");
          return;
        }
        await api.saveVaultKeyring();
        setUseOsKeyring(true);
      } else {
        await api.clearVaultKeyring();
        setUseOsKeyring(false);
      }
    } catch (e) {
      setKeyringError(`Keyring error: ${String(e)}`);
    } finally {
      setKeyringLoading(false);
    }
  }

  async function handleToggleBiometric(enable: boolean) {
    setBiometricError(null);
    setBiometricLoading(true);
    try {
      if (enable) {
        if (!isUnlocked) {
          setBiometricError("Please unlock the vault first to enable biometric unlock.");
          return;
        }
        await api.saveVaultKeyring();
        setUseBiometrics(true);
      } else {
        setUseBiometrics(false);
      }
    } catch (e) {
      setBiometricError(`Biometric setup error: ${String(e)}`);
    } finally {
      setBiometricLoading(false);
    }
  }

  function handleResetVault() {
    useConfirmStore.getState().confirm({
      title: t("settings.security.resetConfirm.title"),
      message: t("settings.security.resetConfirm.message"),
      confirmLabel: t("settings.security.resetConfirm.confirmLabel"),
      isDanger: true,
      onConfirm: async () => {
        try {
          await api.resetVault();
          setUseOsKeyring(false);
          setUseBiometrics(false);
          await refreshVault();
        } catch (e) {
          alert(`Failed to reset vault: ${e}`);
        }
      },
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Vault State Card ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${
                isUnlocked
                  ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                  : "bg-[var(--surface-container)] text-[var(--text-muted)]"
              }`}
            >
              <Lock size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {isUnlocked ? t("vault.unlocked") : t("vault.locked")}
                </h3>
                <span
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium ${
                    isUnlocked
                      ? "bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/20"
                      : "bg-[var(--surface-high)] text-[var(--text-muted)] border border-[var(--border)]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isUnlocked ? "bg-[var(--success)] animate-pulse" : "bg-[var(--text-muted)]"
                    }`}
                  />
                  {isUnlocked ? t("vault.activeInMemory") : "LOCKED"}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {isUnlocked
                  ? t("settings.security.activeInMemoryDesc")
                  : t("settings.security.lockedDesc")}
              </p>
            </div>
          </div>

          {isUnlocked ? (
            <button
              onClick={lockVault}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--warning)] hover:bg-[var(--surface-highest)] transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
            >
              <Lock size={13} />
              {t("vault.lockVault")}
            </button>
          ) : (
            <button
              onClick={openUnlockPrompt}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3.5 py-2 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
            >
              <LockOpen size={13} />
              {t("vault.unlockVault")}
            </button>
          )}
        </div>
      </div>

      {/* ── Vault Behavior Settings Card ──────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden shadow-sm">
        <div className="border-b border-[var(--border)] px-5 py-3.5 bg-[var(--surface-container)]/30">
          <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <KeyRound size={15} className="text-[var(--secondary)]" />
            {t("settings.security.vaultBehaviorTitle")}
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {t("settings.security.vaultBehaviorDesc")}
          </p>
        </div>

        <div className="divide-y divide-[var(--border)] text-xs">
          {/* A. Biometric (Touch ID) Authentication */}
          <div className="p-5 flex items-start justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Fingerprint size={16} className="text-[var(--accent)]" />
                <span>{t("settings.security.biometricsTitle")}</span>
                {isBiometricSupported && (
                  <span className="rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                    {t("settings.security.biometricsAvailable")}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {t("settings.security.biometricsDesc")}
                {!isBiometricSupported && (
                  <span className="block text-[var(--warning)] font-medium mt-1">
                    {t("settings.security.biometricsNotDetected")}
                  </span>
                )}
              </p>
              {biometricError && (
                <p className="text-[11px] text-[var(--danger)] flex items-center gap-1.5 pt-1.5 font-medium">
                  <AlertTriangle size={13} /> {biometricError}
                </p>
              )}
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={useBiometrics}
                disabled={biometricLoading || !isInitialized || !isBiometricSupported}
                onChange={(e) => handleToggleBiometric(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5.5 bg-[var(--surface-container)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
            </label>
          </div>

          {/* B. OS Keyring Integration */}
          <div className="p-5 flex items-start justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <KeyRound size={16} className="text-[var(--primary)]" />
                <span>{t("settings.security.keyringTitle")}</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {t("settings.security.keyringDesc")}
              </p>
              {keyringError && (
                <p className="text-[11px] text-[var(--danger)] flex items-center gap-1.5 pt-1.5 font-medium">
                  <AlertTriangle size={13} /> {keyringError}
                </p>
              )}
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={useOsKeyring}
                disabled={keyringLoading || !isInitialized}
                onChange={(e) => handleToggleKeyring(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5.5 bg-[var(--surface-container)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-[var(--primary)]"></div>
            </label>
          </div>

          {/* B. Auto-Lock Policy */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Timer size={16} className="text-[var(--secondary)]" />
                <span>{t("settings.security.autoLockTitle")}</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t("settings.security.autoLockDesc")}
              </p>
            </div>

            <div className="w-56 shrink-0">
              <CustomSelect
                value={autoLockPolicy}
                onChange={(val) => setAutoLockPolicy(val as AutoLockPolicy)}
                options={[
                  { value: "never", label: t("settings.security.autoLockNever") },
                  { value: "on_close", label: t("settings.security.autoLockOnClose") },
                  { value: "15min", label: t("settings.security.autoLock15Min") },
                  { value: "1hour", label: t("settings.security.autoLock1Hour") },
                  { value: "on_focus_loss", label: t("settings.security.autoLockOnFocusLoss") },
                ]}
              />
            </div>
          </div>

          {/* C. Master Password Rotation & Danger Zone */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="font-semibold text-[var(--text-primary)]">{t("settings.security.masterPasswordSection")}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t("settings.security.masterPasswordDesc")}
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => setIsChangePasswordOpen(true)}
                disabled={!isUnlocked}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {t("settings.security.changePasswordBtn")}...
              </button>

              <button
                onClick={handleResetVault}
                className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors cursor-pointer"
              >
                {t("settings.security.resetVaultBtn")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Change Password Modal Dialog ──────────────────────────────────── */}
      {isChangePasswordOpen && (
        <ChangePasswordModal onClose={() => setIsChangePasswordOpen(false)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: TRUSTED HOST KEYS (TOFU)
// ══════════════════════════════════════════════════════════════════════════════

function KnownHostsTab() {
  const { t } = useTranslation();
  const { knownHosts, isLoading, refresh, resetKnownHost } = useKnownHostsStore();

  useEffect(() => {
    if (knownHosts.length === 0) {
      refresh();
    }
  }, [knownHosts.length, refresh]);

  function handleReset(address: string, port: number) {
    useConfirmStore.getState().confirm({
      title: "Reset Trusted Host Key",
      message: `Reset trusted host key for ${address}:${port}? Termimus will accept the server's new key on your next connection (Trust On First Use).`,
      confirmLabel: "Reset Key",
      isDanger: false,
      onConfirm: async () => {
        await resetKnownHost(address, port);
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden shadow-sm">
        {/* toolbar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-container)]/30">
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--primary)]" />
              {t("settings.knownHosts.title")}
            </h4>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {t("settings.knownHosts.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              {knownHosts.length} host{knownHosts.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => refresh()}
              disabled={isLoading}
              title="Refresh known hosts"
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-white transition-colors cursor-pointer"
            >
              <RotateCw size={14} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {knownHosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center text-[var(--text-muted)]">
            <Server size={36} className="mb-2 opacity-30" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">{t("settings.knownHosts.emptyHosts")}</p>
            <p className="text-[11px] mt-1 max-w-sm text-[var(--text-muted)]">
              {t("settings.knownHosts.subtitle")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface-container)] text-[10px] uppercase font-mono text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="py-2.5 pl-5">{t("settings.knownHosts.colHost")}</th>
                  <th className="py-2.5 px-3">{t("settings.knownHosts.colKeyType")}</th>
                  <th className="py-2.5 px-3">{t("settings.knownHosts.colFingerprint")}</th>
                  <th className="py-2.5 pr-5 text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/40 font-mono">
                {knownHosts.map((kh) => (
                  <tr
                    key={`${kh.address}:${kh.port}`}
                    className="hover:bg-[var(--surface-container)]/50 transition-colors"
                  >
                    <td className="py-3 pl-5 font-semibold text-[var(--text-primary)]">
                      {kh.address}:{kh.port}
                    </td>
                    <td className="py-3 px-3 text-[var(--secondary)]">{kh.key_type}</td>
                    <td className="py-3 px-3 text-[11px] text-[var(--primary)] font-mono select-all">
                      {kh.fingerprint}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <button
                        onClick={() => handleReset(kh.address, kh.port)}
                        title="Reset host key"
                        className="inline-flex items-center gap-1 rounded bg-[var(--danger)]/10 px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors border border-[var(--danger)]/20 cursor-pointer"
                      >
                        <Trash2 size={11} />
                        <span>Reset</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MITM Security notice */}
        <div className="flex items-start gap-2.5 border-t border-[var(--border)] bg-[var(--surface-container)]/30 px-5 py-3 text-[11px] text-[var(--text-secondary)]">
          <ShieldAlert size={15} className="shrink-0 mt-0.5 text-[var(--warning)]" />
          <span>
            {t("settings.knownHosts.antiMitmNotice")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL: CHANGE MASTER PASSWORD
// ══════════════════════════════════════════════════════════════════════════════

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError(t("settings.security.changePasswordModal.errorMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.security.changePasswordModal.errorMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await api.changeVaultPassword(oldPassword, newPassword);
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-[var(--primary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("settings.security.changePasswordModal.title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[var(--text-muted)] hover:text-white cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-[var(--danger)] flex items-center gap-2">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-3 py-3 text-[var(--success)] flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} />
            <span>{t("settings.security.changePasswordModal.success")}</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.security.changePasswordModal.currentPassword")}
              </label>
              <input
                type="password"
                required
                autoFocus
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={t("settings.security.changePasswordModal.currentPasswordPlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.security.changePasswordModal.newPassword")}
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("settings.security.changePasswordModal.newPasswordPlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.security.changePasswordModal.confirmPassword")}
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("settings.security.changePasswordModal.confirmPasswordPlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.security.changePasswordModal.reEncryptNotice")}
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-white cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                {submitting ? t("settings.security.changePasswordModal.updating") : t("settings.security.changePasswordModal.updateButton")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
