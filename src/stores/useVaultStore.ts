import { create } from "zustand";
import { api } from "../lib/api";
import { useSettingsStore } from "./useSettingsStore";

interface VaultState {
  isInitialized: boolean;
  isUnlocked: boolean;
  /** Whether the setup/unlock prompt is shown. Cancellable once the vault
   *  exists; the user can reopen it from Settings > Security & Vault. */
  isUnlockPromptOpen: boolean;
  /** Whether the open prompt may be cancelled. The app-startup prompt is
   *  mandatory (the vault must be unlocked to use the app); prompts raised
   *  in-session (manual lock, reopened from Settings) are cancellable. */
  isUnlockPromptDismissable: boolean;
  /** Full app lock (Header padlock): the UI is covered by the AppLockScreen
   *  overlay until the user re-authenticates. SSH/SFTP sessions and terminal
   *  buffers stay alive underneath; only the vault key is zeroized. */
  isAppLocked: boolean;
  isLoading: boolean;
  error: string | null;
  isBiometricSupported: boolean;
  refresh: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: () => Promise<void>;
  lockApp: () => Promise<void>;
  autoLock: () => Promise<void>;
  openUnlockPrompt: () => void;
  closeUnlockPrompt: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  isInitialized: false,
  isUnlocked: false,
  isUnlockPromptOpen: true,
  isUnlockPromptDismissable: false,
  isAppLocked: false,
  isLoading: true,
  error: null,
  isBiometricSupported: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [status, biometricSupported] = await Promise.all([
        api.getVaultStatus(),
        api.isVaultBiometricSupported().catch(() => false),
      ]);

      // If vault is initialized but locked, attempt silent unlock via OS keyring
      // before surfacing the password modal to the user. Skipped while the app
      // is manually locked: returning from the lock screen must be a conscious
      // authentication (password/biometric), never a silent keyring hit.
      if (status.is_initialized && !status.is_unlocked && !get().isAppLocked) {
        const { useOsKeyring } = useSettingsStore.getState();
        if (useOsKeyring) {
          try {
            const unlocked = await api.unlockVaultKeyring();
            if (unlocked) {
              set({
                isInitialized: true,
                isUnlocked: true,
                isUnlockPromptOpen: false,
                isLoading: false,
                error: null,
                isBiometricSupported: biometricSupported,
              });
              return;
            }
          } catch {
            // Keyring unavailable or entry missing — fall through to password modal.
          }
        }
      }

      set((state) => ({
        isInitialized: status.is_initialized,
        isUnlocked: status.is_unlocked,
        // A missing vault can only be created through the setup prompt, so
        // force it open even if the user dismissed the prompt earlier.
        isUnlockPromptOpen: !status.is_initialized || state.isUnlockPromptOpen,
        isLoading: false,
        error: null,
        isBiometricSupported: biometricSupported,
      }));
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  setup: async (password: string) => {
    set({ error: null });
    try {
      await api.setupVault(password);
      set({ isInitialized: true, isUnlocked: true, isUnlockPromptOpen: false });

      // Auto-save to keyring if the user has keyring or biometrics enabled.
      const { useOsKeyring, useBiometrics } = useSettingsStore.getState();
      if (useOsKeyring || useBiometrics) {
        try {
          await api.saveVaultKeyring();
        } catch {
          // Non-fatal — keyring save failure shouldn't block vault setup.
        }
      }
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  unlock: async (password: string) => {
    set({ error: null });
    try {
      await api.unlockVault(password);
      set({ isUnlocked: true, isAppLocked: false, isUnlockPromptOpen: false });

      // Refresh keyring entry after a successful manual unlock.
      const { useOsKeyring, useBiometrics } = useSettingsStore.getState();
      if (useOsKeyring || useBiometrics) {
        try {
          await api.saveVaultKeyring();
        } catch {
          // Non-fatal.
        }
      }
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  unlockWithBiometric: async () => {
    set({ error: null });
    try {
      const unlocked = await api.unlockVaultBiometric();
      if (unlocked) {
        set({ isUnlocked: true, isAppLocked: false, isUnlockPromptOpen: false, error: null });
        return true;
      }
      return false;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  // Manual lock from the UI buttons: the vault locks immediately and the app
  // returns to normal view. The unlock prompt opens only on demand.
  lock: async () => {
    await api.lockVault();
    set({ isUnlocked: false, isUnlockPromptOpen: false });
  },

  // Full app lock (Header padlock): zeroize the vault key AND cover the UI
  // with the AppLockScreen until re-authentication. Deliberately does NOT
  // touch SSH/SFTP/tunnel sessions or terminal buffers — remote tasks keep
  // running while the user is away.
  lockApp: async () => {
    await api.lockVault();
    set({ isAppLocked: true, isUnlocked: false, isUnlockPromptOpen: false });
  },

  // System-initiated lock (idle timeout, focus loss): the user is away, so
  // surface the unlock prompt for when they return. Still cancellable in
  // session; secrets stay locked either way.
  autoLock: async () => {
    await api.lockVault();
    set({
      isUnlocked: false,
      isUnlockPromptOpen: true,
      isUnlockPromptDismissable: true,
    });
  },

  openUnlockPrompt: () =>
    set({ isUnlockPromptOpen: true, isUnlockPromptDismissable: true }),
  closeUnlockPrompt: () => set({ isUnlockPromptOpen: false }),
}));
