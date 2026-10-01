import type { ITheme, Terminal } from "@xterm/xterm";

export interface TerminalSemanticColors {
  error: string;
  warning: string;
  success: string;
  info: string;
  debug: string;
  ip: string;
  mac: string;
  command: string;
}

export interface TerminalTheme {
  id: string;
  label: string;
  description: string;
  /** Full xterm theme (16 ANSI + chrome colors). */
  xterm: ITheme;
  /** Semantic colors used for keyword highlighting + settings preview. */
  semantic: TerminalSemanticColors;
  /**
   * Recommended font pairing for this theme. `familyLabel` must match one of
   * TERMINAL_FONT_LABELS in the theme store. Shown as a one-click suggestion
   * in Settings — never applied automatically.
   */
  suggestedFont?: {
    familyLabel: string;
    size: number;
    lineHeight: number;
  };
}

const OBSIDIAN: TerminalTheme = {
  id: "obsidian",
  label: "Terminal Obsidian",
  description: "Default Termimus theme",
  xterm: {
    background: "#0a0e14",
    foreground: "#f0f6fc",
    cursor: "#00d2b4",
    cursorAccent: "#0a0e14",
    selectionBackground: "#00d2b433",
    black: "#161b22",
    red: "#f85149",
    green: "#3fb950",
    yellow: "#e3b341",
    blue: "#38bdf8",
    magenta: "#cbacff",
    cyan: "#2adec0",
    white: "#f0f6fc",
    brightBlack: "#6e7681",
    brightRed: "#ff7b72",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
  semantic: {
    error: "#f85149",
    warning: "#e3b341",
    success: "#3fb950",
    info: "#38bdf8",
    debug: "#cbacff",
    ip: "#2adec0",
    mac: "#56d4dd",
    command: "#00d2b4",
  },
};

export const TERMINAL_THEMES: TerminalTheme[] = [
  OBSIDIAN,
  {
    id: "termius-green",
    label: "Termius Green",
    description: "Termius-style dark with green phosphor text",
    xterm: {
      background: "#14171c",
      foreground: "#5eeaa0",
      cursor: "#5eeaa0",
      cursorAccent: "#14171c",
      selectionBackground: "#5eeaa055",
      black: "#14171c",
      red: "#ff6b6b",
      green: "#5eeaa0",
      yellow: "#e5c07b",
      blue: "#7dd3fc",
      magenta: "#c4b5fd",
      cyan: "#5eead4",
      white: "#c9e8d6",
      brightBlack: "#566164",
      brightRed: "#ff8080",
      brightGreen: "#7dffa9",
      brightYellow: "#e5c07b",
      brightBlue: "#7dd3fc",
      brightMagenta: "#c4b5fd",
      brightCyan: "#5eead4",
      brightWhite: "#e6f7ec",
    },
    semantic: {
      error: "#ff6b6b",
      warning: "#e5c07b",
      success: "#5eeaa0",
      info: "#7dd3fc",
      debug: "#c4b5fd",
      ip: "#5eead4",
      mac: "#5eead4",
      command: "#7dffa9",
    },
    suggestedFont: {
      familyLabel: "JetBrains Mono",
      size: 13.5,
      lineHeight: 1.4,
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    description: "Warm, low-contrast, easy on the eyes",
    xterm: {
      background: "#2b3339",
      foreground: "#d3c6aa",
      cursor: "#a7c080",
      cursorAccent: "#2b3339",
      selectionBackground: "#a7c08055",
      black: "#2b3339",
      red: "#e67e80",
      green: "#a7c080",
      yellow: "#dbbc7f",
      blue: "#7fbbb3",
      magenta: "#d699b6",
      cyan: "#83c092",
      white: "#d3c6aa",
      brightBlack: "#4a555c",
      brightRed: "#e67e80",
      brightGreen: "#a7c080",
      brightYellow: "#dbbc7f",
      brightBlue: "#7fbbb3",
      brightMagenta: "#d699b6",
      brightCyan: "#83c092",
      brightWhite: "#ede5d0",
    },
    semantic: {
      error: "#e67e80",
      warning: "#dbbc7f",
      success: "#a7c080",
      info: "#7fbbb3",
      debug: "#d699b6",
      ip: "#83c092",
      mac: "#83c092",
      command: "#a7c080",
    },
    suggestedFont: {
      familyLabel: "JetBrains Mono",
      size: 14,
      lineHeight: 1.45,
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    description: "Atom-inspired neutral dark",
    xterm: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "#528bff55",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
    semantic: {
      error: "#e06c75",
      warning: "#e5c07b",
      success: "#98c379",
      info: "#61afef",
      debug: "#c678dd",
      ip: "#56b6c2",
      mac: "#56b6c2",
      command: "#61afef",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    description: "High-contrast purple dark",
    xterm: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#ff79c6",
      cursorAccent: "#282a36",
      selectionBackground: "#ff79c655",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
    semantic: {
      error: "#ff5555",
      warning: "#f1fa8c",
      success: "#50fa7b",
      info: "#8be9fd",
      debug: "#bd93f9",
      ip: "#8be9fd",
      mac: "#8be9fd",
      command: "#ff79c6",
    },
  },
  {
    id: "nord",
    label: "Nord",
    description: "Cool low-contrast arctic",
    xterm: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      cursorAccent: "#2e3440",
      selectionBackground: "#88c0d055",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
    semantic: {
      error: "#bf616a",
      warning: "#ebcb8b",
      success: "#a3be8c",
      info: "#81a1c1",
      debug: "#b48ead",
      ip: "#88c0d0",
      mac: "#8fbcbb",
      command: "#88c0d0",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    description: "Classic sysadmin palette",
    xterm: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#2aa198",
      cursorAccent: "#002b36",
      selectionBackground: "#2aa19855",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
    semantic: {
      error: "#dc322f",
      warning: "#b58900",
      success: "#859900",
      info: "#268bd2",
      debug: "#6c71c4",
      ip: "#2aa198",
      mac: "#93a1a1",
      command: "#2aa198",
    },
  },
  {
    id: "light",
    label: "Paper Light",
    description: "Light theme for bright rooms",
    xterm: {
      background: "#ffffff",
      foreground: "#1a1a1a",
      cursor: "#007acc",
      cursorAccent: "#ffffff",
      selectionBackground: "#007acc33",
      black: "#1a1a1a",
      red: "#c1272d",
      green: "#1a7f37",
      yellow: "#9a6700",
      blue: "#007acc",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#f5f5f5",
      brightBlack: "#59636e",
      brightRed: "#d1242c",
      brightGreen: "#1a7f37",
      brightYellow: "#9a6700",
      brightBlue: "#007acc",
      brightMagenta: "#8250df",
      brightCyan: "#1b7c83",
      brightWhite: "#ffffff",
    },
    semantic: {
      error: "#c1272d",
      warning: "#9a6700",
      success: "#1a7f37",
      info: "#007acc",
      debug: "#8250df",
      ip: "#1b7c83",
      mac: "#1b7c83",
      command: "#007acc",
    },
  },
];

export const DEFAULT_TERMINAL_THEME_ID = "obsidian";

export function getTerminalTheme(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0];
}

export interface TerminalAppearance {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
}

/**
 * Applies theme + font to a live xterm instance without reconnecting.
 * Never touches the buffer — safe for curses apps.
 */
export function applyTerminalAppearance(
  term: Terminal,
  theme: TerminalTheme,
  font: TerminalAppearance
): void {
  term.options.theme = { ...theme.xterm };
  term.options.fontFamily = font.fontFamily;
  term.options.fontSize = font.fontSize;
  term.options.lineHeight = font.lineHeight;
  term.options.cursorStyle = font.cursorStyle;
  term.options.cursorBlink = font.cursorBlink;
}
