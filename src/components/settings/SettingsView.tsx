import { useState, useEffect, useRef } from "react";
import {
  Archive,
  Lock,
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
  Info,
  Shield,
  Palette,
  Cpu,
  Layers,
  Cloud,
  ExternalLink,
  ArrowUpCircle,
} from "lucide-react";
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
  AUTO_LOCK_LABELS,
} from "../../stores/useSettingsStore";
import { CustomSelect } from "../ui/CustomSelect";
import { api } from "../../lib/api";
import { openExternalUrl } from "../../lib/openUrl";
import kofiIcon from "../../assets/kofi.png";

type SettingsTab = "security" | "terminal" | "sync" | "known_hosts" | "backup" | "about";

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("security");
  const { knownHosts } = useKnownHostsStore();
  const { hasUpdate } = useUpdateStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const tabs: {
    id: SettingsTab;
    label: string;
    icon: typeof Lock;
    badge?: number;
    badgeDot?: boolean;
  }[] = [
    { id: "security", label: "Security & Vault", icon: Lock },
    { id: "terminal", label: "Terminal & Theme", icon: Palette },
    { id: "sync", label: "Self-Hosted Sync", icon: Cloud },
    {
      id: "known_hosts",
      label: "Trusted Host Keys",
      icon: ShieldCheck,
      badge: knownHosts.length || undefined,
    },
    { id: "backup", label: "Backup & Restore", icon: Archive },
    { id: "about", label: "About & Architecture", icon: Info, badgeDot: hasUpdate },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)] select-none overflow-hidden">
      {/* ── Fixed Top Header & Navigation ─────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-container)]/30 px-6 pt-5 pb-4 backdrop-blur-xs">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">Settings</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Manage your local security vault, trusted hosts, backup bundles, and application preferences.
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
          {activeTab === "security" && <SecurityVaultTab />}
          {activeTab === "terminal" && <TerminalThemeTab />}
          {activeTab === "sync" && <SyncSection />}
          {activeTab === "known_hosts" && <KnownHostsTab />}
          {activeTab === "backup" && <BackupRestoreSection />}
          {activeTab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: SECURITY & VAULT
// ══════════════════════════════════════════════════════════════════════════════

function SecurityVaultTab() {
  const { isUnlocked, isInitialized, lock: lockVault, refresh: refreshVault } = useVaultStore();
  const { useOsKeyring, setUseOsKeyring, autoLockPolicy, setAutoLockPolicy } = useSettingsStore();

  const [keyringLoading, setKeyringLoading] = useState(false);
  const [keyringError, setKeyringError] = useState<string | null>(null);
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

  function handleResetVault() {
    useConfirmStore.getState().confirm({
      title: "Reset Entire Vault?",
      message:
        "WARNING: This will permanently delete all stored credentials, SSH private keys, and passwords. Your hosts and snippets will remain, but credentials will need to be re-entered. This cannot be undone.",
      confirmLabel: "Reset Vault",
      isDanger: true,
      onConfirm: async () => {
        try {
          await api.resetVault();
          setUseOsKeyring(false);
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
                  {isUnlocked ? "Vault is Unlocked" : "Vault is Locked"}
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
                  {isUnlocked ? "ACTIVE IN MEMORY" : "LOCKED"}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {isUnlocked
                  ? "Zero-knowledge AES-256-GCM key derived via Argon2id is loaded in memory. All sensitive credentials are ready."
                  : "All private keys and passwords remain encrypted on disk. Unlock with your master password to begin."}
              </p>
            </div>
          </div>

          {isUnlocked && (
            <button
              onClick={lockVault}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--warning)] hover:bg-[var(--surface-highest)] transition-colors shrink-0 self-start sm:self-auto"
            >
              <Lock size={13} />
              Lock Vault
            </button>
          )}
        </div>
      </div>

      {/* ── Vault Behavior Settings Card ──────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden shadow-sm">
        <div className="border-b border-[var(--border)] px-5 py-3.5 bg-[var(--surface-container)]/30">
          <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <KeyRound size={15} className="text-[var(--secondary)]" />
            Vault Behavior &amp; Login Preferences
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Configure how and when Termimus unlocks your vault on this machine.
          </p>
        </div>

        <div className="divide-y divide-[var(--border)] text-xs">
          {/* A. OS Keyring Integration */}
          <div className="p-5 flex items-start justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Fingerprint size={16} className="text-[var(--primary)]" />
                <span>Remember on this device (OS Keyring)</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                Automatically unlocks the vault silently on app launch using your desktop's secure credential
                store (<strong>KWallet / GNOME Secret Service</strong> on Linux, <strong>macOS Keychain</strong>, or <strong>Windows Credential Manager</strong>).
                Your master password is never stored — only the derived AES-256 encryption key.
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
                <span>Auto-Lock Timeout</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Automatically zeros memory and locks the vault when you are away from the computer.
              </p>
            </div>

            <div className="w-56 shrink-0">
              <CustomSelect
                value={autoLockPolicy}
                onChange={(val) => setAutoLockPolicy(val as AutoLockPolicy)}
                options={(Object.keys(AUTO_LOCK_LABELS) as AutoLockPolicy[]).map((key) => ({
                  value: key,
                  label: AUTO_LOCK_LABELS[key],
                }))}
              />
            </div>
          </div>

          {/* C. Master Password Rotation & Danger Zone */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="font-semibold text-[var(--text-primary)]">Master Password &amp; Maintenance</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Rotate your master password (all credentials will be re-encrypted) or reset the vault.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => setIsChangePasswordOpen(true)}
                disabled={!isUnlocked}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50"
              >
                Change Master Password...
              </button>

              <button
                onClick={handleResetVault}
                className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors"
              >
                Reset Vault
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
              Trusted Host Key Fingerprints (TOFU)
            </h4>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Termimus verifies remote server public keys on every connection to prevent Man-in-the-Middle (MITM) attacks.
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
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-white transition-colors"
            >
              <RotateCw size={14} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {knownHosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center text-[var(--text-muted)]">
            <Server size={36} className="mb-2 opacity-30" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">No trusted hosts recorded yet</p>
            <p className="text-[11px] mt-1 max-w-sm text-[var(--text-muted)]">
              When you establish your first SSH connection to a server, its cryptographic public key fingerprint is safely remembered here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface-container)] text-[10px] uppercase font-mono text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="py-2.5 pl-5">Server Address</th>
                  <th className="py-2.5 px-3">Algorithm</th>
                  <th className="py-2.5 px-3">SHA256 Fingerprint</th>
                  <th className="py-2.5 pr-5 text-right">Actions</th>
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
                        className="inline-flex items-center gap-1 rounded bg-[var(--danger)]/10 px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors border border-[var(--danger)]/20"
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
            <strong>Anti-MITM Protection:</strong> If a server's fingerprint changes unexpectedly, Termimus aborts the connection immediately with a security alert. Only reset a key if you intentionally reinstalled or replaced the remote server.
          </span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: ABOUT & ARCHITECTURE
// ══════════════════════════════════════════════════════════════════════════════

function AboutTab() {
  const { currentVersion, latestVersion, hasUpdate, releaseUrl, isChecking, checkForUpdates } =
    useUpdateStore();

  return (
    <div className="space-y-5">
      {/* App banner */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)] shrink-0">
            <Cpu size={26} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Termimus</h3>
              <span className="rounded bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--primary)] border border-[var(--primary)]/30">
                v{currentVersion}
              </span>
              {hasUpdate && (
                <span className="rounded bg-[var(--warning)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--warning)] border border-[var(--warning)]/30 animate-pulse">
                  Update v{latestVersion} available
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Self-hosted, Local-First SSH &amp; Server Manager desktop client.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Shield size={14} className="text-[var(--primary)]" />
              <span>Zero-Knowledge</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              All credentials are encrypted locally with AES-256-GCM. The encryption key never leaves this machine.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Layers size={14} className="text-[var(--secondary)]" />
              <span>Local-First</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Everything works 100% offline via embedded SQLite. No mandatory cloud accounts or tracking.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Server size={14} className="text-[var(--tertiary)]" />
              <span>Self-Hosted Sync</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Designed for future peer sync via self-hosted Docker relay without third-party cloud lock-in.
            </p>
          </div>
        </div>
      </div>

      {/* Software Updates Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${
                hasUpdate
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30"
                  : "bg-[var(--surface-container)] text-[var(--text-muted)]"
              }`}
            >
              {hasUpdate ? (
                <ArrowUpCircle size={22} className="animate-bounce" />
              ) : (
                <CheckCircle2 size={22} className="text-[var(--success)]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  {hasUpdate ? `Update Available: v${latestVersion}` : "Termimus is up to date"}
                </h4>
                {hasUpdate && (
                  <span className="rounded bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--primary)] border border-[var(--primary)]/30 animate-pulse">
                    NEW
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {hasUpdate
                  ? `Version v${latestVersion} is available. You are currently on v${currentVersion}.`
                  : `You are currently running the latest release (v${currentVersion}).`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasUpdate ? (
              <button
                type="button"
                onClick={() => openExternalUrl(releaseUrl)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover,var(--primary))] text-[var(--canvas)] transition-all shadow-sm cursor-pointer hover:shadow-md active:scale-95"
              >
                <ArrowUpCircle size={14} />
                <span>Download v{latestVersion}</span>
                <ExternalLink size={12} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => checkForUpdates(true)}
                disabled={isChecking}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium border border-[var(--border)] bg-[var(--surface-container)]/70 hover:bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCw size={13} className={isChecking ? "animate-spin text-[var(--primary)]" : ""} />
                <span>{isChecking ? "Checking..." : "Check for Updates"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Support & Donation Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FF5E5B]/15 shrink-0 border border-[#FF5E5B]/20">
              <img src={kofiIcon} alt="Ko-fi" className="w-6 h-auto object-contain drop-shadow-xs" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Support Termimus</h4>
                <span className="rounded bg-[#FF5E5B]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FF5E5B] border border-[#FF5E5B]/30">
                  Ko-fi
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-xl">
                Termimus is completely free and open-source. Donations directly support ongoing development, domain/hosting costs, and maintenance.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openExternalUrl("https://ko-fi.com/termimus")}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5E5B] hover:bg-[#ff4743] text-white transition-all shadow-sm shrink-0 cursor-pointer hover:shadow-md active:scale-95"
          >
            <img src={kofiIcon} alt="" className="w-4 h-auto brightness-0 invert" />
            <span>Donate on Ko-fi</span>
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Tech specs card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 space-y-3 shadow-sm text-xs">
        <h4 className="font-semibold text-[var(--text-primary)]">Core Technologies</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-container)]/50 p-2.5">
            <span className="text-[var(--text-muted)] block text-[10px]">BACKEND</span>
            <span className="text-[var(--text-primary)] font-semibold">Tauri v2 + Rust</span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-container)]/50 p-2.5">
            <span className="text-[var(--text-muted)] block text-[10px]">FRONTEND</span>
            <span className="text-[var(--text-primary)] font-semibold">React 19 + Vite</span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-container)]/50 p-2.5">
            <span className="text-[var(--text-muted)] block text-[10px]">DATABASE</span>
            <span className="text-[var(--text-primary)] font-semibold">SQLite (rusqlite)</span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-container)]/50 p-2.5">
            <span className="text-[var(--text-muted)] block text-[10px]">TERMINAL</span>
            <span className="text-[var(--text-primary)] font-semibold">@xterm/xterm 6</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL: CHANGE MASTER PASSWORD
// ══════════════════════════════════════════════════════════════════════════════

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
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
              Change Master Password
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[var(--text-muted)] hover:text-white"
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
            <span>Master password changed successfully! All credentials re-encrypted.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                Current Master Password
              </label>
              <input
                type="password"
                required
                autoFocus
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter current password..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                New Master Password
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <p className="text-[11px] text-[var(--text-muted)]">
              Changing your master password will re-encrypt all stored SSH keys and passwords
              with the new key. OS Keyring will need to be re-enabled if in use.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                {submitting ? "Re-encrypting..." : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
