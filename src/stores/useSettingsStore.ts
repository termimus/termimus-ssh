import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { SupportedLanguage } from "../i18n";

export type AutoLockPolicy =
  | "never"
  | "on_close"
  | "15min"
  | "1hour"
  | "on_focus_loss";

export const AUTO_LOCK_LABELS: Record<AutoLockPolicy, string> = {
  never: "Never (manual lock only)",
  on_close: "When app closes",
  "15min": "After 15 minutes idle",
  "1hour": "After 1 hour idle",
  on_focus_loss: "When app loses focus",
};

interface SettingsState {
  useOsKeyring: boolean;
  useBiometrics: boolean;
  autoLockPolicy: AutoLockPolicy;
  language: SupportedLanguage;
  setUseOsKeyring: (v: boolean) => void;
  setUseBiometrics: (v: boolean) => void;
  setAutoLockPolicy: (v: AutoLockPolicy) => void;
  setLanguage: (lang: SupportedLanguage) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      useOsKeyring: false,
      useBiometrics: false,
      autoLockPolicy: "on_close",
      language: "en",
      setUseOsKeyring: (v) => set({ useOsKeyring: v }),
      setUseBiometrics: (v) => set({ useBiometrics: v }),
      setAutoLockPolicy: (v) => set({ autoLockPolicy: v }),
      setLanguage: (lang) => {
        set({ language: lang });
        void i18n.changeLanguage(lang);
      },
    }),
    {
      name: "termimus_settings",
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          void i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
