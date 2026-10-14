import { useState } from "react";
import { Lock, KeyRound, Fingerprint } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useVaultStore } from "../../stores/useVaultStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSessionStore } from "../../stores/useSessionStore";

/**
 * Full-screen app lock (Header padlock). Covers the whole window with a
 * translucent blurred surface — the layout of the last page stays visible
 * but terminal text is unreadable. SSH/SFTP sessions and terminal buffers
 * keep running underneath — nothing unmounts, so unlocking returns to the
 * exact previous state. Unlike VaultModal this screen is mandatory: no
 * dismiss button, no Escape, and no silent OS-keyring unlock; returning
 * requires a conscious authentication (master password or biometrics).
 */
export function AppLockScreen() {
  const {
    isAppLocked,
    isUnlocked,
    unlock,
    unlockWithBiometric,
    isBiometricSupported,
    error,
  } = useVaultStore(
    useShallow((s) => ({
      isAppLocked: s.isAppLocked,
      isUnlocked: s.isUnlocked,
      unlock: s.unlock,
      unlockWithBiometric: s.unlockWithBiometric,
      isBiometricSupported: s.isBiometricSupported,
      error: s.error,
    }))
  );
  const { useBiometrics } = useSettingsStore();
  // Primitive result — no useShallow needed.
  const activeSessions = useSessionStore((s) => s.tabs.filter((t) => t.connected).length);

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [biometricUnlocking, setBiometricUnlocking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isAppLocked || isUnlocked) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await unlock(password);
      setPassword("");
    } catch (err) {
      // Clear the password on failure so it is never left sitting in the DOM.
      setPassword("");
      setLocalError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

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

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
    >
      {/* inner panel: explicitly opt out of drag so clicks/inputs work normally */}
      <div
        data-tauri-drag-region="false"
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-2xl"
      >
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)] shrink-0">
            <Lock size={22} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Termimus is Locked
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              {activeSessions > 0
                ? `${activeSessions} active session${activeSessions === 1 ? "" : "s"} kept alive — remote tasks are still running.`
                : "Enter your master password to unlock the app."}
            </p>
          </div>
        </div>

        {(localError || error) && (
          <div className="mb-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] leading-relaxed">
            {localError || error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isBiometricSupported && useBiometrics && (
            <div className="space-y-3 pb-1">
              <button
                type="button"
                disabled={biometricUnlocking || submitting}
                onClick={handleBiometricUnlock}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/18 text-[var(--primary)] py-2.5 px-4 text-sm font-semibold transition shadow-sm hover:shadow active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                <Fingerprint size={18} className={biometricUnlocking ? "animate-pulse" : ""} />
                <span>{biometricUnlocking ? "Waiting for Touch ID..." : "Unlock with Touch ID"}</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
                  or enter master password
                </span>
                <div className="h-px flex-1 bg-[var(--border)]" />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              Master Password
            </label>
            <div className="relative">
              <input
                type="password"
                autoFocus={!useBiometrics}
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

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {submitting ? "Verifying..." : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
