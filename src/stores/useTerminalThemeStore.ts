import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_TERMINAL_THEME_ID,
  getTerminalTheme,
  type TerminalTheme,
} from "../lib/terminalThemes";
import type { HighlightKey } from "../lib/highlightPatterns";

export const TERMINAL_FONT_FAMILIES = [
  "'JetBrains Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'Fira Code', monospace",
  "'Fira Code', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'JetBrains Mono', monospace",
  "'Ubuntu Mono', 'DejaVu Sans Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  "Consolas, 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'JetBrains Mono', monospace",
  "Menlo, Monaco, 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'JetBrains Mono', monospace",
] as const;

export const TERMINAL_FONT_LABELS = [
  "JetBrains Mono (Bundled)",
  "Fira Code (Bundled)",
  "Ubuntu / DejaVu Mono (Linux)",
  "Consolas (Windows)",
  "Menlo / Monaco (macOS)",
] as const;

export type TerminalCursorStyle = "bar" | "block" | "underline";

export interface TerminalFontSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

export const DEFAULT_TERMINAL_FONT: TerminalFontSettings = {
  fontFamily: TERMINAL_FONT_FAMILIES[0],
  fontSize: 13.5,
  lineHeight: 1.35,
  cursorStyle: "bar",
  cursorBlink: true,
};

export type HighlightToggles = Record<HighlightKey, boolean>;

export const DEFAULT_HIGHLIGHT_TOGGLES: HighlightToggles = {
  error: true,
  warning: true,
  success: true,
  info: true,
  debug: true,
  ip: true,
  mac: true,
};

interface TerminalThemeState {
  themeId: string;
  font: TerminalFontSettings;
  highlight: HighlightToggles;

  setThemeId: (id: string) => void;
  setFont: (patch: Partial<TerminalFontSettings>) => void;
  setHighlight: (key: HighlightKey, v: boolean) => void;
  resetDefaults: () => void;
  /** Resolved theme object for the current themeId (falls back to default). */
  getTheme: () => TerminalTheme;
}

export function normalizeFontFamily(family?: string): string {
  if (!family) return TERMINAL_FONT_FAMILIES[0];
  if (family.includes("Fira Code") && family.startsWith("'Fira Code'")) {
    return TERMINAL_FONT_FAMILIES[1];
  }
  if (family.includes("Ubuntu") || family.includes("DejaVu")) {
    return TERMINAL_FONT_FAMILIES[2];
  }
  if (family.includes("Consolas") && family.startsWith("Consolas")) {
    return TERMINAL_FONT_FAMILIES[3];
  }
  if (family.includes("Menlo") && family.startsWith("Menlo")) {
    return TERMINAL_FONT_FAMILIES[4];
  }
  if (family.includes("JetBrains Mono")) {
    return TERMINAL_FONT_FAMILIES[0];
  }
  return family;
}

function clampFont(patch: Partial<TerminalFontSettings>): Partial<TerminalFontSettings> {
  const out = { ...patch };
  if (out.fontFamily !== undefined) {
    out.fontFamily = normalizeFontFamily(out.fontFamily);
  }
  if (out.fontSize !== undefined) {
    out.fontSize = Math.min(Math.max(out.fontSize, 9), 24);
  }
  if (out.lineHeight !== undefined) {
    out.lineHeight = Math.min(Math.max(out.lineHeight, 1.0), 1.8);
  }
  return out;
}

export const useTerminalThemeStore = create<TerminalThemeState>()(
  persist(
    (set, get) => ({
      themeId: DEFAULT_TERMINAL_THEME_ID,
      font: { ...DEFAULT_TERMINAL_FONT },
      highlight: { ...DEFAULT_HIGHLIGHT_TOGGLES },

      setThemeId: (id) => set({ themeId: id }),
      setFont: (patch) =>
        set((s) => ({ font: { ...s.font, ...clampFont(patch) } })),
      setHighlight: (key, v) =>
        set((s) => ({ highlight: { ...s.highlight, [key]: v } })),
      resetDefaults: () =>
        set({
          themeId: DEFAULT_TERMINAL_THEME_ID,
          font: { ...DEFAULT_TERMINAL_FONT },
          highlight: { ...DEFAULT_HIGHLIGHT_TOGGLES },
        }),
      getTheme: () => getTerminalTheme(get().themeId),
    }),
    {
      name: "termimus_terminal_theme",
      version: 1,
    }
  )
);
