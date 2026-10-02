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
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  autoLock: () => Promise<void>;
  openUnlockPrompt: () => void;
  closeUnlockPrompt: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  isInitialized: false,
  isUnlocked: false,
  isUnlockPromptOpen: true,
  isUnlockPromptDismissable: false,
  isLoading: true,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const status = await api.getVaultStatus();

      // If vault is initialized but locked, attempt silent unlock via OS keyring
      // before surfacing the password modal to the user.
      if (status.is_initialized && !status.is_unlocked) {
        const { useOsKeyring } = useSettingsStore.getState();
        if (useOsKeyring) {
          try {
            const unlocked = await api.unlockVaultKeyring();
            if (unlocked) {
              set({ isInitialized: true, isUnlocked: true, isUnlockPromptOpen: false, isLoading: false, error: null });
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

      // Auto-save to keyring if the user has it enabled.
      const { useOsKeyring } = useSettingsStore.getState();
      if (useOsKeyring) {
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
      set({ isUnlocked: true, isUnlockPromptOpen: false });

      // Refresh keyring entry after a successful manual unlock.
      const { useOsKeyring } = useSettingsStore.getState();
      if (useOsKeyring) {
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

  // Manual lock from the UI buttons: the vault locks immediately and the app
  // returns to normal view. The unlock prompt opens only on demand.
  lock: async () => {
    await api.lockVault();
    set({ isUnlocked: false, isUnlockPromptOpen: false });
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
