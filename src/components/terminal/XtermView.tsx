import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Clipboard,
  CheckSquare,
  Trash2,
  Columns2,
  Rows2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Check,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../../lib/api";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useTerminalThemeStore } from "../../stores/useTerminalThemeStore";
import {
  applyTerminalAppearance,
  getTerminalTheme,
} from "../../lib/terminalThemes";
import { TerminalHighlighter } from "../../lib/terminalHighlighter";
import { findPaneContainingTab } from "../../lib/layoutTree";
import { ConnectionProgress, ConnectionLog } from "./ConnectionProgress";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { useAiStore, AI_COPILOT_SHORTCUT_LABEL, aiBusyMessage } from "../../stores/useAiStore";
import i18n from "../../i18n";
import { buildAiRequest, parseInlineQuery, isInsertableCommand } from "../../lib/aiContext";
import { InlineAiStatus } from "./InlineAiStatus";
import {
  trackInput,
  getInputTracker,
  setInputTracker,
  lineClearSequence,
  disposeInputTracker,
} from "../../lib/inputTracker";
import { runConfirmationFor, isProductionHost } from "./AiRunConfirmDialog";

interface XtermViewProps {
  sessionId: string;
  hostId: string;
  visible: boolean;
  isFocused?: boolean;
}

interface SshProgressEvent {
  step: number;
  step_name: string;
  message: string;
  timestamp: string;
  is_error: boolean;
}

interface TerminalSessionEntry {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  hasConnected: boolean;
  unlistenFns: Array<() => void>;
  dataDisposable: { dispose: () => void };
  lastSize: { cols: number; rows: number };
  lastPixelSize?: { width: number; height: number };
  // Keyword highlighting (decoration overlays — never touches the buffer).
  highlighter: TerminalHighlighter | null;
  // Persist connection progress state across remounts so logs are never lost
  // when the pane layout changes (e.g. split) while a connection is in progress.
  connectionLogs: ConnectionLog[];
  connectionStep: number;
  connectionError: string | null;
}

// Module-level persistent pool of active xterm instances.
// Keeps active SSH sessions, PTY streams, and terminal buffers alive across
// React layout reconciliations (splitting, moving tabs, un-splitting, resizing).
const terminalPool = new Map<string, TerminalSessionEntry>();

/**
 * Extracts the last N lines from the active buffer of a pooled terminal session.
 */
export function getTerminalBufferSlice(sessionId: string, maxLines = 50): string {
  const entry = terminalPool.get(sessionId);
  if (!entry?.term) return "";
  const buffer = entry.term.buffer.active;
  const end = buffer.baseY + buffer.cursorY;
  const start = Math.max(0, end - maxLines);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n").trim();
}

/**
 * Focuses the terminal instance for a given session.
 */
export function focusTerminalSession(sessionId: string) {
  const entry = terminalPool.get(sessionId);
  entry?.term?.focus();
}

// Shared module-level text encoder to prevent GC pressure during high-speed typing
const textEncoder = new TextEncoder();

// ── Inline `# prompt` AI ──────────────────────────────────────────────────────
// Typing `# find big log files` at the shell prompt and pressing the Copilot
// shortcut replaces that line with the generated command. The command is only
// *typed*, never executed: the user still reviews it and presses Enter.

interface InlineQuery {
  query: string;
  /** "typed" = from the input tracker (exact); "screen" = parsed from the buffer line. */
  source: "typed" | "screen";
}

/** Resolves the `# query` on the current input line, if any. */
function getInlineQuery(sessionId: string): InlineQuery | null {
  const entry = terminalPool.get(sessionId);
  // Full-screen apps (vim, htop, less) use the alternate screen: never inline there.
  if (!entry?.term || entry.term.buffer.active.type !== "normal") return null;

  const tracked = getInputTracker(sessionId);
  if (tracked?.reliable) {
    // We know exactly what was typed: it must itself start with `#` (not a `#!` shebang).
    const typed = tracked.text.trimStart();
    if (!typed.startsWith("#") || typed.startsWith("#!")) return null;
    const query = parseInlineQuery(tracked.text);
    return query ? { query, source: "typed" } : null;
  }
  const line = readCursorLine(sessionId);
  const query = line ? parseInlineQuery(line) : null;
  return query ? { query, source: "screen" } : null;
}

/**
 * Whether a plain Enter on a typed `# query` line may be intercepted for AI.
 * Enter is far more ambiguous than the explicit shortcut, so we only take it
 * when the line really looks like an interactive shell prompt:
 * - the typed text is echoed at the end of the screen line (rules out
 *   no-echo password prompts — a password starting with `#` must never be
 *   sent to the AI provider);
 * - something precedes it on the line (a prompt — rules out programs reading
 *   stdin such as `cat`);
 * - that prompt isn't a continuation / REPL prompt ending in `>` (heredoc and
 *   `\` continuation PS2, python `>>>`/`...`, mysql `->`, node, irb…), where a
 *   `#` line is real input.
 */
function isShellPromptLine(sessionId: string, typed: string): boolean {
  const line = readCursorLine(sessionId);
  if (line === null) return false;
  const screen = line.trimEnd();
  const text = typed.trimEnd();
  if (!text || !screen.endsWith(text)) return false;
  const prefix = screen.slice(0, screen.length - text.length).trimEnd();
  if (!prefix) return false;
  if (/(>|\.\.\.|\?)$/.test(prefix)) return false;
  return true;
}

let providersRequested = false;
/** Inline `#` needs to know whether a provider exists before the sidebar was ever opened. */
function ensureAiProvidersLoaded() {
  if (providersRequested) return;
  providersRequested = true;
  void useAiStore.getState().loadProviders();
}

/** Reads the logical (un-wrapped) line at the cursor on the normal screen. */
function readCursorLine(sessionId: string): string | null {
  const entry = terminalPool.get(sessionId);
  if (!entry?.term) return null;
  const buffer = entry.term.buffer.active;
  // Full-screen apps (vim, htop, less) use the alternate screen: never inline there.
  if (buffer.type !== "normal") return null;
  let row = buffer.baseY + buffer.cursorY;
  let text = buffer.getLine(row)?.translateToString(true) ?? "";
  while (row > 0 && buffer.getLine(row)?.isWrapped) {
    row--;
    text = (buffer.getLine(row)?.translateToString(false) ?? "") + text;
  }
  return text;
}

async function writeToSession(sessionId: string, text: string) {
  const tab = useSessionStore.getState().tabs.find((t) => t.id === sessionId);
  const writeFn = tab?.isLocal || sessionId.startsWith("local-") ? api.writeLocalPty : api.writeSsh;
  await writeFn(sessionId, Array.from(textEncoder.encode(text)));
}

async function runInlineAi(sessionId: string, query: string) {
  const ai = useAiStore.getState();
  if (ai.inline[sessionId]?.status === "generating") return;
  if (!ai.activeProvider) await ai.loadProviders();
  if (!useAiStore.getState().activeProvider) {
    ai.setInline(sessionId, {
      status: "error",
      prompt: query,
      message: i18n.t("ai.inline.noProvider"),
    });
    return;
  }

  // From here on everything up to generateCommand() is synchronous, so the
  // generate slot is claimed before any other request can start.
  if (useAiStore.getState().isGenerating) {
    ai.setInline(sessionId, { status: "error", prompt: query, message: aiBusyMessage() });
    return;
  }
  ai.setInline(sessionId, { status: "generating", prompt: query });

  // Context = recent output without the `# query` line itself.
  const context = getTerminalBufferSlice(sessionId, 51).split("\n").slice(0, -1).join("\n");
  const outcome = await useAiStore
    .getState()
    .generateCommand(buildAiRequest(sessionId, query, context));
  const result = outcome.value;

  const st = useAiStore.getState();
  if (st.inline[sessionId]?.status !== "generating") return; // dismissed meanwhile

  if (!result) {
    st.setInline(
      sessionId,
      outcome.cancelled
        ? { status: "cancelled", prompt: query }
        : { status: "error", prompt: query, message: outcome.error ?? i18n.t("ai.generationFailed") }
    );
    return;
  }

  // Never typed into the shell (review in the Copilot instead):
  // - destructive commands;
  // - multi-line ones (a newline would execute immediately);
  // - anything that would need a confirmation when run from the Copilot
  //   (e.g. modifying commands on a production host).
  const tab = useSessionStore.getState().tabs.find((t) => t.id === sessionId);
  const isLocal = !tab || !!tab.isLocal || sessionId.startsWith("local-");
  const host = tab ? useHostStore.getState().hosts.find((h) => h.id === tab.hostId) : undefined;
  const gate = runConfirmationFor(result.risk, !isLocal && isProductionHost(host?.tags));
  if (gate !== "none" || !isInsertableCommand(result.command)) {
    st.setInline(sessionId, {
      status: "review",
      prompt: query,
      command: result,
      message:
        result.risk === "destructive"
          ? i18n.t("ai.inline.reviewDestructive")
          : gate !== "none"
          ? i18n.t("ai.inline.reviewProduction")
          : i18n.t("ai.inline.reviewMultiline"),
    });
    st.openSidebar(sessionId);
    return;
  }

  // Only replace the line if it still holds the same query (the user may have
  // kept typing or run something else while we were generating).
  const current = getInlineQuery(sessionId);
  if (!current || current.query !== query) {
    st.setInline(sessionId, {
      status: "review",
      prompt: query,
      command: result,
      message: i18n.t("ai.inline.lineChanged"),
    });
    st.openSidebar(sessionId);
    return;
  }

  try {
    const clear = current.source === "typed" ? lineClearSequence(sessionId) : "\x05\x15";
    await writeToSession(sessionId, clear + result.command);
    setInputTracker(sessionId, result.command, current.source === "typed");
    st.setInline(sessionId, { status: "inserted", prompt: query, command: result });
  } catch (e) {
    st.setInline(sessionId, { status: "error", prompt: query, message: String(e) });
  }
  // Only reclaim focus if it is still in this terminal (don't steal it from
  // another split pane or input the user moved to meanwhile).
  const entry = terminalPool.get(sessionId);
  const active = document.activeElement;
  if (entry && (!active || active === document.body || entry.element.contains(active))) {
    entry.term.focus();
  }
}

/** Copilot shortcut: inline-generate when the line holds `# query`, else toggle the sidebar. */
function handleCopilotShortcut(sessionId: string) {
  const inline = getInlineQuery(sessionId);
  if (inline) {
    void runInlineAi(sessionId, inline.query);
  } else {
    useAiStore.getState().toggleSidebar(sessionId);
  }
}

/**
 * Applies the current theme + font settings from the store to a pooled
 * terminal instance. Never reconnects SSH and never touches the buffer.
 */
function applyAppearanceToEntry(entry: TerminalSessionEntry, sessionId?: string) {
  const store = useTerminalThemeStore.getState();
  const theme = getTerminalTheme(store.themeId);
  const themeBg = theme.xterm.background ?? "#0a0e14";
  applyTerminalAppearance(entry.term, theme, store.font);
  if (entry.element) {
    entry.element.style.backgroundColor = themeBg;
    if (entry.element.parentElement) {
      entry.element.parentElement.style.backgroundColor = themeBg;
    }
  }
  try {
    entry.fitAddon.fit();
    const cols = entry.term.cols;
    const rows = entry.term.rows;
    if (cols >= 20 && rows >= 5) {
      if (entry.lastSize.cols !== cols || entry.lastSize.rows !== rows) {
        entry.lastSize = { cols, rows };
        if (sessionId) {
          api.resizeSsh(sessionId, cols, rows).catch(() => {});
        }
      }
    }
  } catch {
    // ignore fit during layout animation
  }
  entry.highlighter?.refresh();
}

/**
 * Applies current theme/font/highlight settings to every live terminal.
 * Called whenever the user changes appearance in Settings.
 */
export function applyTerminalThemeToAll() {
  for (const [id, entry] of terminalPool.entries()) {
    try {
      applyAppearanceToEntry(entry, id);
    } catch {
      // one bad instance must not break the rest
    }
  }
}

function checkIsMac(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

async function handleCopyFromTerminal(
  term: Terminal,
  onNotify?: (msg: string) => void
) {
  const selection = term.getSelection();
  if (selection) {
    try {
      try {
        await writeText(selection);
      } catch {
        await navigator.clipboard.writeText(selection);
      }
      const count = selection.length;
      onNotify?.(count > 1 ? `Copied to clipboard (${count} chars)` : "Copied to clipboard");
    } catch (err) {
      console.warn("Clipboard copy failed:", err);
    }
  }
}

// Global timestamp and content tracking to prevent duplicate paste events
let lastPasteTimestamp = 0;
let lastPastedContent = "";

async function safePasteToTerminal(term: Terminal) {
  try {
    let text = "";
    try {
      text = await readText();
    } catch {
      text = await navigator.clipboard.readText();
    }
    if (!text) return;

    const now = Date.now();
    if (now - lastPasteTimestamp < 350 && lastPastedContent === text) {
      // Duplicate paste within 350ms window — ignore
      return;
    }

    lastPasteTimestamp = now;
    lastPastedContent = text;
    // Uses xterm's bracketed paste mode which emits cleanly through term.onData (with multi-terminal sync)
    term.paste(text);
  } catch (err) {
    console.warn("Clipboard paste failed:", err);
  }
}

function adjustTerminalFontSize(
  term: Terminal,
  fitAddon: FitAddon,
  targetSessionId: string,
  delta: number | "reset"
) {
  const currentSize = term.options.fontSize || 13.5;
  const defaultSize =
    useTerminalThemeStore.getState().font.fontSize || 13.5;
  const newSize =
    delta === "reset"
      ? defaultSize
      : Math.min(Math.max(currentSize + delta, 9), 24);
  term.options.fontSize = newSize;
  try {
    fitAddon.fit();
    const cols = term.cols;
    const rows = term.rows;
    if (cols >= 20 && rows >= 5) {
      const entry = terminalPool.get(targetSessionId);
      if (entry) entry.lastSize = { cols, rows };
      const isTargetLocal = targetSessionId.startsWith("local-") || Boolean(useSessionStore.getState().tabs.find((t) => t.id === targetSessionId)?.isLocal);
      (isTargetLocal ? api.resizeLocalPty : api.resizeSsh)(targetSessionId, cols, rows).catch(() => {});
    }
  } catch {
    // ignore
  }
}

function bindTerminalShortcuts(
  term: Terminal,
  fitAddon: FitAddon,
  targetSessionId: string,
  onCopyNotify?: (msg: string) => void,
  onOpenSearch?: () => void,
  onOpenCopilot?: () => void
) {
  ensureAiProvidersLoaded();
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== "keydown") return true;

    const isMac = checkIsMac();
    const modKey = isMac ? event.metaKey : event.ctrlKey;

    // Esc cancels an in-flight inline `# prompt` generation for this terminal.
    if (
      event.key === "Escape" &&
      useAiStore.getState().inline[targetSessionId]?.status === "generating"
    ) {
      event.preventDefault();
      void useAiStore.getState().cancelInFlight("generate");
      return false;
    }

    // Inline AI: Enter on a line the user typed as `# query` generates a command
    // instead of sending a no-op comment (zsh would print "command not found: #").
    // Only for exactly-tracked input, so a `# ` *prompt* (root sh in containers)
    // followed by a real command is never intercepted.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.isComposing
    ) {
      const inline = getInlineQuery(targetSessionId);
      if (
        inline?.source === "typed" &&
        useAiStore.getState().activeProvider &&
        isShellPromptLine(targetSessionId, getInputTracker(targetSessionId)?.text ?? "")
      ) {
        event.preventDefault();
        void runInlineAi(targetSessionId, inline.query);
        return false;
      }
    }

    // AI Copilot: Alt+I (Linux/Win) or Cmd+I (Mac). Ctrl+I is deliberately left
    // alone — it is the Tab control byte and must still reach the remote shell.
    if (
      !event.shiftKey &&
      event.key.toLowerCase() === "i" &&
      (isMac ? event.metaKey : event.altKey && !event.ctrlKey && !event.metaKey)
    ) {
      event.preventDefault();
      onOpenCopilot?.();
      return false;
    }

    // Find / Search: Ctrl+F (Linux/Win) or Cmd+F (Mac)
    if (
      (isMac && modKey && event.key.toLowerCase() === "f") ||
      (!isMac && (event.ctrlKey || modKey) && event.key.toLowerCase() === "f")
    ) {
      event.preventDefault();
      onOpenSearch?.();
      return false;
    }

    // Copy: Ctrl+Shift+C (Linux/Win), Ctrl+Insert, or Cmd+C (Mac with selection)
    if (
      (isMac && modKey && !event.shiftKey && event.key.toLowerCase() === "c" && term.hasSelection()) ||
      (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") ||
      (!isMac && event.ctrlKey && event.key === "Insert")
    ) {
      event.preventDefault();
      handleCopyFromTerminal(term, onCopyNotify);
      return false;
    }

    // Paste: Ctrl+Shift+V, Ctrl+V, Shift+Insert, or Cmd+V
    if (
      (isMac && modKey && !event.shiftKey && event.key.toLowerCase() === "v") ||
      (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") ||
      (!isMac && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "v") ||
      (event.shiftKey && event.key === "Insert")
    ) {
      event.preventDefault();
      event.stopPropagation();
      safePasteToTerminal(term);
      return false;
    }

    // Select All: Ctrl+Shift+A (Linux/Win) or Cmd+A (Mac)
    if (
      (isMac && modKey && event.key.toLowerCase() === "a") ||
      (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a")
    ) {
      event.preventDefault();
      term.selectAll();
      return false;
    }

    // Clear Buffer: Ctrl+Shift+K (Linux/Win) or Cmd+Shift+K (Mac)
    if (
      (isMac && modKey && event.shiftKey && event.key.toLowerCase() === "k") ||
      (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "k")
    ) {
      event.preventDefault();
      term.clear();
      return false;
    }

    // Zoom In: Ctrl+= or Ctrl++ / Cmd+= or Cmd++
    if (modKey && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      adjustTerminalFontSize(term, fitAddon, targetSessionId, 1);
      return false;
    }

    // Zoom Out: Ctrl+- / Cmd+-
    if (modKey && event.key === "-") {
      event.preventDefault();
      adjustTerminalFontSize(term, fitAddon, targetSessionId, -1);
      return false;
    }

    // Reset Zoom: Ctrl+0 / Cmd+0
    if (modKey && event.key === "0") {
      event.preventDefault();
      adjustTerminalFontSize(term, fitAddon, targetSessionId, "reset");
      return false;
    }

    // Scroll Page Up / Down: Shift+PageUp / Shift+PageDown
    if (event.shiftKey && event.key === "PageUp") {
      event.preventDefault();
      term.scrollPages(-1);
      return false;
    }
    if (event.shiftKey && event.key === "PageDown") {
      event.preventDefault();
      term.scrollPages(1);
      return false;
    }

    return true;
  });
}

/**
 * Cleanly disposes a terminal session when a tab is explicitly closed.
 */
export function disposeTerminalSession(sessionId: string) {
  const entry = terminalPool.get(sessionId);
  if (!entry) return;

  try {
    entry.highlighter?.detach();
  } catch {
    // ignore
  }
  entry.highlighter = null;

  try {
    entry.dataDisposable.dispose();
  } catch {
    // ignore
  }

  entry.unlistenFns.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });

  try {
    entry.term.dispose();
  } catch {
    // ignore
  }

  if (entry.element.parentElement) {
    try {
      entry.element.parentElement.removeChild(entry.element);
    } catch {
      // ignore
    }
  }

  terminalPool.delete(sessionId);
  disposeInputTracker(sessionId);
  useAiStore.getState().forgetSession(sessionId);
}

export function XtermView({ sessionId, hostId, visible, isFocused = true }: XtermViewProps) {
  const { t } = useTranslation();
  const themeId = useTerminalThemeStore((s) => s.themeId);
  const currentTheme = getTerminalTheme(themeId);
  const themeBg = currentTheme.xterm.background ?? "#0a0e14";

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });

  const setConnected = useSessionStore((s) => s.setSessionConnected);
  const setError = useSessionStore((s) => s.setSessionError);
  const closeSession = useSessionStore((s) => s.closeSession);
  const host = useHostStore((s) => s.hosts.find((h) => h.id === hostId));
  const tab = useSessionStore((s) => s.tabs.find((t) => t.id === sessionId));
  const isLocal = sessionId.startsWith("local-") || Boolean(tab?.isLocal);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [logs, setLogs] = useState<ConnectionLog[]>(
    () => terminalPool.get(sessionId)?.connectionLogs ?? []
  );
  const [currentStep, setCurrentStep] = useState(
    () => terminalPool.get(sessionId)?.connectionStep ?? 1
  );
  const [connectionError, setConnectionError] = useState<string | null>(
    () => terminalPool.get(sessionId)?.connectionError ?? null
  );
  // Initialize from the persistent pool synchronously (not in an effect) so a
  // remount of an already-connected session (e.g. moving into a new split
  // layout) doesn't flash the ConnectionProgress loading screen for a frame
  // before the effect corrects it.
  const [isConnected, setIsConnected] = useState(
    () => isLocal || (terminalPool.get(sessionId)?.hasConnected ?? false)
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const isMac = checkIsMac();

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // When select-to-copy / right-click-to-paste is on, right-click pastes
    // directly instead of opening the menu. Uses the same debounced paste
    // path as Ctrl+Shift+V / the menu's Paste action.
    if (useSettingsStore.getState().selectToCopyPaste) {
      if (termRef.current) {
        void safePasteToTerminal(termRef.current);
      }
      return;
    }
    const hasSel = Boolean(termRef.current?.hasSelection());
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setContextMenu({ x, y, hasSelection: hasSel });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleSplitRight = () => {
    const { rootPane, splitPane, openSessionInSplit, openLocalSessionInSplit } = useSessionStore.getState();
    if (!rootPane) return;
    const pane = findPaneContainingTab(rootPane, sessionId);
    if (!pane) return;

    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "row", "second");
      return;
    }
    if (isLocal) {
      openLocalSessionInSplit(pane.id, "row", "second");
      return;
    }
    const hosts = useHostStore.getState().hosts;
    const targetHost = hosts.find((h) => h.id === hostId);
    if (targetHost) {
      openSessionInSplit(targetHost, pane.id, "row", "second");
    }
  };

  const handleSplitDown = () => {
    const { rootPane, splitPane, openSessionInSplit, openLocalSessionInSplit } = useSessionStore.getState();
    if (!rootPane) return;
    const pane = findPaneContainingTab(rootPane, sessionId);
    if (!pane) return;

    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "column", "second");
      return;
    }
    if (isLocal) {
      openLocalSessionInSplit(pane.id, "column", "second");
      return;
    }
    const hosts = useHostStore.getState().hosts;
    const targetHost = hosts.find((h) => h.id === hostId);
    if (targetHost) {
      openSessionInSplit(targetHost, pane.id, "column", "second");
    }
  };

  const startConnection = useCallback(
    (cols: number, rows: number) => {
      if (isLocal) {
        setIsConnected(true);
        setConnected(sessionId, true);
        const entry = terminalPool.get(sessionId);
        if (entry) {
          entry.hasConnected = true;
          entry.connectionError = null;
        }
        api
          .spawnLocalPty(sessionId, cols, rows)
          .catch((e) => {
            const errStr = String(e);
            setIsConnected(false);
            setConnectionError(errStr);
            setError(sessionId, errStr);
            termRef.current?.write(`\r\n\x1b[31mFailed to start local terminal: ${errStr}\x1b[0m\r\n`);
          });
        return;
      }

      const initialLog: ConnectionLog = {
        step: 1,
        message: `Initiating connection to ${host?.address || "server"}...`,
        timestamp: new Date().toISOString(),
        isError: false,
      };

      const poolEntry = terminalPool.get(sessionId);
      if (poolEntry) {
        poolEntry.connectionLogs = [initialLog];
        poolEntry.connectionStep = 1;
        poolEntry.connectionError = null;
        poolEntry.hasConnected = false;
      }

      setConnectionError(null);
      setIsConnected(false);
      setCurrentStep(1);
      setLogs([initialLog]);

      api
        .connectSsh(hostId, sessionId, cols, rows)
        .then(() => {
          const entry = terminalPool.get(sessionId);
          if (entry) {
            entry.hasConnected = true;
            entry.connectionError = null;
          }
          setIsConnected(true);
          setConnected(sessionId, true);
          setConnectionError(null);
        })
        .catch((e) => {
          const errStr = String(e);
          const entry = terminalPool.get(sessionId);
          if (entry) {
            entry.hasConnected = false;
            entry.connectionError = errStr;
          }
          setIsConnected(false);
          setConnectionError(errStr);
          setError(sessionId, errStr);
          termRef.current?.write(`\r\n\x1b[31mFailed to connect: ${errStr}\x1b[0m\r\n`);
        });
    },
    [hostId, sessionId, host, setConnected, setError, isLocal]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let entry = terminalPool.get(sessionId);

    if (entry) {
      // Reuse existing terminal instance without reconnecting SSH!
      termRef.current = entry.term;
      fitAddonRef.current = entry.fitAddon;
      searchAddonRef.current = entry.searchAddon;
      lastSizeRef.current = entry.lastSize;

      bindTerminalShortcuts(
        entry.term,
        entry.fitAddon,
        sessionId,
        showCopyToast,
        () => setIsSearchOpen(true),
        () => handleCopilotShortcut(sessionId)
      );

      if (entry.element.parentElement !== containerRef.current) {
        containerRef.current.appendChild(entry.element);
      }
      entry.element.style.backgroundColor = themeBg;
    } else {
      // Create new terminal instance (theme/font come from the store,
      // falling back to the classic Terminal Obsidian defaults).
      const themeStore = useTerminalThemeStore.getState();
      const initialTheme = getTerminalTheme(themeStore.themeId);
      const initialFont = themeStore.font;
      const domWrapper = document.createElement("div");
      domWrapper.className = "w-full h-full";
      domWrapper.style.backgroundColor = initialTheme.xterm.background || "#0a0e14";
      containerRef.current.appendChild(domWrapper);

      const term = new Terminal({
        cursorBlink: initialFont.cursorBlink,
        cursorStyle: initialFont.cursorStyle,
        fontFamily: initialFont.fontFamily,
        fontSize: initialFont.fontSize,
        lineHeight: initialFont.lineHeight,
        letterSpacing: 0,
        scrollback: 5000,
        theme: {
          ...initialTheme.xterm,
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const searchAddon = new SearchAddon({
        highlightLimit: 2000,
      });
      term.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;

      term.open(domWrapper);

      // Ensure xterm recalculates metrics once custom webfonts finish loading
      if (typeof document !== "undefined" && document.fonts?.ready) {
        document.fonts.ready.then(() => {
          try {
            fitAddon.fit();
            term.refresh(0, term.rows - 1);
          } catch {
            // ignore
          }
        });
      }

      // Capture-phase paste handler to ensure DOM paste events are forwarded to xterm
      domWrapper.addEventListener(
        "paste",
        (e: ClipboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();

          const text = e.clipboardData?.getData("text/plain");
          if (text) {
            const now = Date.now();
            if (now - lastPasteTimestamp < 350 && lastPastedContent === text) {
              return;
            }
            lastPasteTimestamp = now;
            lastPastedContent = text;
            term.paste(text);
          } else {
            safePasteToTerminal(term);
          }
        },
        true
      );

      // Select-to-copy: when enabled in Settings, selecting text copies it
      // to the clipboard once the selection settles (debounced, so a drag
      // writes once instead of once per intermediate selection). The setting
      // is read live so toggling it applies immediately to open terminals.
      // Silent copy (no toast) — the manual Copy action already toasts.
      let selectCopyTimer: ReturnType<typeof setTimeout> | null = null;
      term.onSelectionChange(() => {
        if (selectCopyTimer) {
          clearTimeout(selectCopyTimer);
          selectCopyTimer = null;
        }
        if (!useSettingsStore.getState().selectToCopyPaste) return;
        if (!term.getSelection()) return;
        selectCopyTimer = setTimeout(() => {
          selectCopyTimer = null;
          if (!term.getSelection()) return;
          void handleCopyFromTerminal(term);
        }, 200);
      });

      let initialCols = 80;
      let initialRows = 24;
      try {
        if (containerRef.current.clientWidth >= 100 && containerRef.current.clientHeight >= 100) {
          fitAddon.fit();
          initialCols = Math.max(term.cols, 20);
          initialRows = Math.max(term.rows, 5);
        }
      } catch {
        // fallback
      }

      lastSizeRef.current = { cols: initialCols, rows: initialRows };
      termRef.current = term;
      fitAddonRef.current = fitAddon;
      bindTerminalShortcuts(
        term,
        fitAddon,
        sessionId,
        showCopyToast,
        () => setIsSearchOpen(true),
        () => handleCopilotShortcut(sessionId)
      );

      // Keystroke forwarding (supports broadcast to interconnected split panes)
      const dataDisposable = term.onData((data) => {
        const bytes = Array.from(textEncoder.encode(data));
        const targetSessionIds = useSessionStore
          .getState()
          .getBroadcastTargetSessionIds(sessionId);

        const storeTabs = useSessionStore.getState().tabs;
        for (const tid of targetSessionIds) {
          trackInput(tid, data);
          const targetTab = storeTabs.find((t) => t.id === tid);
          const writeFn = (targetTab?.isLocal || tid.startsWith("local-"))
            ? api.writeLocalPty
            : api.writeSsh;
          writeFn(tid, bytes).catch((e) => console.error("terminal write failed:", e));
        }
      });

      // Stream listeners
      const unlistenFns: Array<() => void> = [];

      if (isLocal) {
        listen<number[]>(`pty-data-${sessionId}`, (event) => {
          const bytes = new Uint8Array(event.payload);
          term.write(bytes);
        }).then((unlisten) => unlistenFns.push(unlisten));

        listen<void>(`pty-closed-${sessionId}`, () => {
          closeSession(sessionId);
        }).then((unlisten) => unlistenFns.push(unlisten));
      } else {
        listen<number[]>(`ssh-data-${sessionId}`, (event) => {
          const bytes = new Uint8Array(event.payload);
          term.write(bytes);
        }).then((unlisten) => unlistenFns.push(unlisten));

        listen<string>(`ssh-closed-${sessionId}`, () => {
          // When connection is closed (e.g. exit or Ctrl+D), immediately close the session/tab
          closeSession(sessionId);
        }).then((unlisten) => unlistenFns.push(unlisten));

        listen<SshProgressEvent>(`ssh-progress-${sessionId}`, (event) => {
          const p = event.payload;
          const newLog: ConnectionLog = {
            step: p.step,
            message: p.message,
            timestamp: p.timestamp,
            isError: p.is_error,
          };

          // Persist into pool so remounts can recover state
          const poolEntry = terminalPool.get(sessionId);
          if (poolEntry) {
            poolEntry.connectionStep = p.step;
            poolEntry.connectionLogs = [...poolEntry.connectionLogs, newLog];
            if (p.is_error) {
              poolEntry.connectionError = p.message;
            }
          }

          setCurrentStep(p.step);
          setLogs((prev) => [...prev, newLog]);
          if (p.is_error) {
            setConnectionError(p.message);
          }
        }).then((unlisten) => unlistenFns.push(unlisten));
      }

      entry = {
        term,
        fitAddon,
        searchAddon,
        element: domWrapper,
        hasConnected: false,
        unlistenFns,
        dataDisposable,
        lastSize: { cols: initialCols, rows: initialRows },
        lastPixelSize: {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        },
        connectionLogs: [],
        connectionStep: 1,
        connectionError: null,
        highlighter: null,
      };
      // Keyword highlighting overlays (reads live config from the store).
      const highlighter = new TerminalHighlighter(term, () => {
        const s = useTerminalThemeStore.getState();
        return {
          enabled: s.highlight,
          colors: getTerminalTheme(s.themeId).semantic,
        };
      });
      entry.highlighter = highlighter;
      highlighter.attach();
      terminalPool.set(sessionId, entry);

      startConnection(initialCols, initialRows);
    }

    // Debounced resize observer to prevent layout thrashing and IPC flooding during animations (sidebar toggle, split dragging)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!containerRef.current || !termRef.current || !fitAddonRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        if (width < 100 || height < 100) return;

        try {
          fitAddonRef.current.fit();
          const cols = termRef.current.cols;
          const rows = termRef.current.rows;

          if (cols >= 20 && rows >= 5) {
            if (entry) {
              entry.lastPixelSize = { width, height };
            }
            if (
              lastSizeRef.current.cols !== cols ||
              lastSizeRef.current.rows !== rows
            ) {
              lastSizeRef.current = { cols, rows };
              if (entry) {
                entry.lastSize = { cols, rows };
              }
              (isLocal ? api.resizeLocalPty : api.resizeSsh)(sessionId, cols, rows).catch(() => {});
            }
          }
        } catch {
          // ignore fit during layout animation
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      // Remove wrapper from container so it can be re-appended on next mount if moved
      if (entry && containerRef.current && entry.element.parentElement === containerRef.current) {
        containerRef.current.removeChild(entry.element);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // When tab becomes visible/focused after switching from another tab or view
  useEffect(() => {
    if (!visible || !termRef.current) return;

    // Immediately focus active terminal without artificial delay
    if (isFocused) {
      termRef.current.focus();
    }

    // Check if container geometry changed while hidden (e.g. window resized while on another tab)
    const frame = requestAnimationFrame(() => {
      if (!containerRef.current || !termRef.current || !fitAddonRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width < 100 || height < 100) return;

      const entry = terminalPool.get(sessionId);
      if (
        entry &&
        entry.lastPixelSize &&
        entry.lastPixelSize.width === width &&
        entry.lastPixelSize.height === height
      ) {
        // Pixel dimensions unchanged — terminal buffer is already rendered and valid
        return;
      }

      try {
        fitAddonRef.current.fit();
        const cols = termRef.current.cols;
        const rows = termRef.current.rows;
        if (cols >= 20 && rows >= 5) {
          if (entry) {
            entry.lastPixelSize = { width, height };
          }
          if (
            lastSizeRef.current.cols !== cols ||
            lastSizeRef.current.rows !== rows
          ) {
            lastSizeRef.current = { cols, rows };
            if (entry) entry.lastSize = { cols, rows };
            (isLocal ? api.resizeLocalPty : api.resizeSsh)(sessionId, cols, rows).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [visible, isFocused, sessionId, isLocal]);

  // React to theme/font/highlight changes from Settings without reconnecting.
  useEffect(() => {
    const unsub = useTerminalThemeStore.subscribe(() => {
      const poolEntry = terminalPool.get(sessionId);
      if (!poolEntry) return;
      try {
        applyAppearanceToEntry(poolEntry, sessionId);
      } catch {
        // ignore
      }
    });
    return () => {
      unsub();
    };
  }, [sessionId]);

  const handleRetry = () => {
    const cols = lastSizeRef.current.cols || 80;
    const rows = lastSizeRef.current.rows || 24;
    startConnection(cols, rows);
  };

  return (
    <div
      className="absolute inset-0"
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 10 : 0,
        backgroundColor: themeBg,
      }}
    >
      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        className="absolute inset-0 p-2"
        style={{ backgroundColor: themeBg }}
      />

      {/* Right-Click Terminal Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Copy */}
          <button
            onClick={() => {
              if (termRef.current) handleCopyFromTerminal(termRef.current, showCopyToast);
              setContextMenu(null);
            }}
            disabled={!contextMenu.hasSelection}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors disabled:opacity-40 disabled:pointer-events-none group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Copy size={13} />
              <span>{t("terminal.contextMenu.copy")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘C" : "Ctrl+Shift+C"}
            </span>
          </button>

          {/* Paste */}
          <button
            onClick={() => {
              if (termRef.current) safePasteToTerminal(termRef.current);
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Clipboard size={13} />
              <span>{t("terminal.contextMenu.paste")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘V" : "Ctrl+Shift+V"}
            </span>
          </button>

          {/* Select All */}
          <button
            onClick={() => {
              termRef.current?.selectAll();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <CheckSquare size={13} />
              <span>{t("terminal.contextMenu.selectAll")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘A" : "Ctrl+Shift+A"}
            </span>
          </button>

          <div className="my-1 h-[1px] bg-[var(--border)]" />

          {/* AI Copilot */}
          <button
            onClick={() => {
              useAiStore.getState().openSidebar(sessionId);
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-[var(--primary)] group-hover:text-black" />
              <span>{t("settings.tabs.ai")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {AI_COPILOT_SHORTCUT_LABEL}
            </span>
          </button>

          {/* Find in Terminal */}
          <button
            onClick={() => {
              setIsSearchOpen(true);
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search size={13} />
              <span>{t("terminal.contextMenu.find")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘F" : "Ctrl+F"}
            </span>
          </button>

          {/* Clear Buffer */}
          <button
            onClick={() => {
              termRef.current?.clear();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Trash2 size={13} />
              <span>{t("terminal.contextMenu.clearBuffer")}</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘K" : "Ctrl+Shift+K"}
            </span>
          </button>

          {/* Font Size Zoom Controls */}
          <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-[var(--text-muted)] font-mono">
            <span>{t("terminal.contextMenu.fontSize")}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, -1);
                  }
                }}
                title={`${t("terminal.contextMenu.zoomOut")} (${isMac ? "⌘-" : "Ctrl+-"})`}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <ZoomOut size={12} />
              </button>
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, "reset");
                  }
                }}
                title={`${t("terminal.contextMenu.resetZoom")} (${isMac ? "⌘0" : "Ctrl+0"})`}
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {t("terminal.contextMenu.resetZoom")}
              </button>
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, 1);
                  }
                }}
                title={`${t("terminal.contextMenu.zoomIn")} (${isMac ? "⌘+" : "Ctrl++"})`}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <ZoomIn size={12} />
              </button>
            </div>
          </div>

          <div className="my-1 h-[1px] bg-[var(--border)]" />

          {/* Split Right */}
          <button
            onClick={() => {
              handleSplitRight();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Columns2 size={13} />
              <span>{t("terminal.splitRight")}</span>
            </div>
          </button>

          {/* Split Down */}
          <button
            onClick={() => {
              handleSplitDown();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Rows2 size={13} />
              <span>{t("terminal.splitDown")}</span>
            </div>
          </button>

          <div className="my-1 h-[1px] bg-[var(--border)]" />

          {/* Reconnect */}
          <button
            onClick={() => {
              handleRetry();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <RefreshCw size={13} />
              <span>Reconnect Session</span>
            </div>
          </button>
        </div>
      )}

      {/* Inline `# prompt` AI status */}
      <InlineAiStatus sessionId={sessionId} />

      {/* Toast Notification on Copy */}
      {copyToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-[var(--primary)]/40 bg-[var(--surface-high)]/95 px-3 py-1.5 text-xs font-mono font-medium text-[var(--primary)] shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150 pointer-events-none">
          <Check size={13} className="text-[var(--primary)] shrink-0" />
          <span>{copyToast}</span>
        </div>
      )}

      {/* Floating Terminal Search Bar (Ctrl+F / Cmd+F) */}
      {isSearchOpen && (
        <TerminalSearchBar
          searchAddon={searchAddonRef.current}
          onClose={() => {
            setIsSearchOpen(false);
            searchAddonRef.current?.clearDecorations();
            termRef.current?.focus();
          }}
        />
      )}

      {/* Termius-Style Connection Progress & Process Tree Overlay (SSH only) */}
      {!isLocal && (!isConnected || connectionError) && (
        <ConnectionProgress
          sessionId={sessionId}
          host={host}
          logs={logs}
          currentStep={currentStep}
          error={connectionError}
          onRetry={handleRetry}
          onClose={() => closeSession(sessionId)}
        />
      )}
    </div>
  );
}
