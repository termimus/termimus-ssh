// Keyword + address patterns for terminal highlighting.
// Decorations are overlays only — they never modify the buffer, so
// copy/paste stays clean and curses apps (htop/vim) are unaffected.

export type HighlightKey =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "debug"
  | "ip"
  | "mac";

export interface HighlightPattern {
  key: HighlightKey;
  label: string;
  regex: RegExp;
  /** Higher wins when matches overlap (IP inside an error line stays cyan). */
  priority: number;
  underline: boolean;
}

export const HIGHLIGHT_PATTERNS: HighlightPattern[] = [
  {
    key: "mac",
    label: "MAC address",
    regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
    priority: 70,
    underline: false,
  },
  {
    key: "ip",
    label: "IP address",
    // IPv4 (with optional :port) + compact IPv6 match
    regex: /\b(?:(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?|(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:.]+)\b/g,
    priority: 60,
    underline: true,
  },
  {
    key: "error",
    label: "Error",
    regex: /\b(error|failed|failure|fatal|exception|denied|refused|timeout|timed out)\b/gi,
    priority: 50,
    underline: false,
  },
  {
    key: "warning",
    label: "Warning",
    regex: /\b(warn(?:ing)?|deprecated|caution|unreachable)\b/gi,
    priority: 40,
    underline: false,
  },
  {
    key: "success",
    label: "Success / OK",
    regex: /\b(ok|success(?:ful)?|passed|done|completed|connected)\b/gi,
    priority: 30,
    underline: false,
  },
  {
    key: "info",
    label: "Info",
    regex: /\b(info|notice|listening|starting|started)\b/gi,
    priority: 20,
    underline: false,
  },
  {
    key: "debug",
    label: "Debug",
    regex: /\b(debug|trace)\b/gi,
    priority: 10,
    underline: false,
  },
];

export const HIGHLIGHT_LABELS: Record<HighlightKey, string> = {
  error: "Error",
  warning: "Warning",
  success: "Success / OK",
  info: "Info",
  debug: "Debug",
  ip: "IP address",
  mac: "MAC address",
};
