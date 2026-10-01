import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
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
} from "lucide-react";
import { api } from "../../lib/api";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useTerminalThemeStore } from "../../stores/useTerminalThemeStore";
import {
  applyTerminalAppearance,
  getTerminalTheme,
} from "../../lib/terminalThemes";
import { TerminalHighlighter } from "../../lib/terminalHighlighter";
import { findPaneContainingTab } from "../../lib/layoutTree";
import { ConnectionProgress, ConnectionLog } from "./ConnectionProgress";
import { TerminalSearchBar } from "./TerminalSearchBar";

interface XtermViewProps {
  sessionId: string;
  hostId: string;
  visible: boolean;
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

// Shared module-level text encoder to prevent GC pressure during high-speed typing
const textEncoder = new TextEncoder();

/**
 * Applies the current theme + font settings from the store to a pooled
 * terminal instance. Never reconnects SSH and never touches the buffer.
 */
function applyAppearanceToEntry(entry: TerminalSessionEntry) {
  const store = useTerminalThemeStore.getState();
  const theme = getTerminalTheme(store.themeId);
  applyTerminalAppearance(entry.term, theme, store.font);
  try {
    entry.fitAddon.fit();
    const cols = entry.term.cols;
    const rows = entry.term.rows;
    if (cols >= 20 && rows >= 5) {
      entry.lastSize = { cols, rows };
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
  for (const entry of terminalPool.values()) {
    try {
      applyAppearanceToEntry(entry);
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
      api.resizeSsh(targetSessionId, cols, rows).catch(() => {});
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
  onOpenSearch?: () => void
) {
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== "keydown") return true;

    const isMac = checkIsMac();
    const modKey = isMac ? event.metaKey : event.ctrlKey;

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

    // Clear Buffer: Ctrl+Shift+K (Linux/Win) or Cmd+K (Mac)
    if (
      (isMac && modKey && event.key.toLowerCase() === "k") ||
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

  terminalPool.delete(sessionId);
}

export function XtermView({ sessionId, hostId, visible }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });

  const setConnected = useSessionStore((s) => s.setSessionConnected);
  const setError = useSessionStore((s) => s.setSessionError);
  const closeSession = useSessionStore((s) => s.closeSession);
  const host = useHostStore((s) => s.hosts.find((h) => h.id === hostId));

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
    () => terminalPool.get(sessionId)?.hasConnected ?? false
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
    const { rootPane, splitPane, openSessionInSplit } = useSessionStore.getState();
    if (!rootPane) return;
    const pane = findPaneContainingTab(rootPane, sessionId);
    if (!pane) return;

    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "row", "second");
      return;
    }
    const hosts = useHostStore.getState().hosts;
    const targetHost = hosts.find((h) => h.id === hostId);
    if (targetHost) {
      openSessionInSplit(targetHost, pane.id, "row", "second");
    }
  };

  const handleSplitDown = () => {
    const { rootPane, splitPane, openSessionInSplit } = useSessionStore.getState();
    if (!rootPane) return;
    const pane = findPaneContainingTab(rootPane, sessionId);
    if (!pane) return;

    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "column", "second");
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
    [hostId, sessionId, host, setConnected, setError]
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
      // Appearance may have changed while unmounted — re-apply (no reconnect).
      try {
        applyAppearanceToEntry(entry);
      } catch {
        // ignore
      }
      setIsConnected(entry.hasConnected);
      setLogs([...entry.connectionLogs]);
      setCurrentStep(entry.connectionStep);
      setConnectionError(entry.connectionError);
      bindTerminalShortcuts(
        entry.term,
        entry.fitAddon,
        sessionId,
        showCopyToast,
        () => setIsSearchOpen(true)
      );

      if (entry.element.parentElement !== containerRef.current) {
        containerRef.current.appendChild(entry.element);
      }
    } else {
      // Create new terminal instance (theme/font come from the store,
      // falling back to the classic Terminal Obsidian defaults).
      const themeStore = useTerminalThemeStore.getState();
      const initialTheme = getTerminalTheme(themeStore.themeId);
      const initialFont = themeStore.font;
      const domWrapper = document.createElement("div");
      domWrapper.className = "w-full h-full";
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
        () => setIsSearchOpen(true)
      );

      // Keystroke forwarding (supports broadcast to interconnected split panes)
      const dataDisposable = term.onData((data) => {
        const bytes = Array.from(textEncoder.encode(data));
        const targetSessionIds = useSessionStore
          .getState()
          .getBroadcastTargetSessionIds(sessionId);

        for (const tid of targetSessionIds) {
          api.writeSsh(tid, bytes).catch((e) => console.error("ssh_write failed:", e));
        }
      });

      // Stream listeners
      const unlistenFns: Array<() => void> = [];

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

      entry = {
        term,
        fitAddon,
        searchAddon,
        element: domWrapper,
        hasConnected: false,
        unlistenFns,
        dataDisposable,
        lastSize: { cols: initialCols, rows: initialRows },
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
            if (
              lastSizeRef.current.cols !== cols ||
              lastSizeRef.current.rows !== rows
            ) {
              lastSizeRef.current = { cols, rows };
              if (entry) {
                entry.lastSize = { cols, rows };
              }
              api.resizeSsh(sessionId, cols, rows).catch(() => {});
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

  // When tab becomes visible again after switching from another tab or view
  useEffect(() => {
    if (!visible || !termRef.current || !fitAddonRef.current || !containerRef.current) return;

    const timer = setTimeout(() => {
      if (!containerRef.current || !termRef.current || !fitAddonRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width < 100 || height < 100) return;

      try {
        fitAddonRef.current.fit();
        const cols = termRef.current.cols;
        const rows = termRef.current.rows;
        if (cols >= 20 && rows >= 5) {
          if (
            lastSizeRef.current.cols !== cols ||
            lastSizeRef.current.rows !== rows
          ) {
            lastSizeRef.current = { cols, rows };
            const entry = terminalPool.get(sessionId);
            if (entry) entry.lastSize = { cols, rows };
            api.resizeSsh(sessionId, cols, rows).catch(() => {});
          }
        }
        termRef.current.refresh(0, termRef.current.rows - 1);
        termRef.current.focus();
      } catch {
        // ignore
      }
    }, 40);

    return () => clearTimeout(timer);
  }, [visible, sessionId]);

  // React to theme/font/highlight changes from Settings without reconnecting.
  useEffect(() => {
    const unsub = useTerminalThemeStore.subscribe(() => {
      const poolEntry = terminalPool.get(sessionId);
      if (!poolEntry) return;
      try {
        applyAppearanceToEntry(poolEntry);
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
      }}
    >
      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        className="absolute inset-0 p-2"
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors disabled:opacity-40 disabled:pointer-events-none group"
          >
            <div className="flex items-center gap-2">
              <Copy size={13} />
              <span>Copy</span>
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Clipboard size={13} />
              <span>Paste</span>
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <CheckSquare size={13} />
              <span>Select All</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘A" : "Ctrl+Shift+A"}
            </span>
          </button>

          <div className="my-1 h-[1px] bg-[var(--border)]" />

          {/* Find in Terminal */}
          <button
            onClick={() => {
              setIsSearchOpen(true);
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Search size={13} />
              <span>Find in Terminal</span>
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Trash2 size={13} />
              <span>Clear Buffer</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-black/70">
              {isMac ? "⌘K" : "Ctrl+Shift+K"}
            </span>
          </button>

          {/* Font Size Zoom Controls */}
          <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-[var(--text-muted)] font-mono">
            <span>Font Size</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, -1);
                  }
                }}
                title={`Zoom Out (${isMac ? "⌘-" : "Ctrl+-"})`}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
              >
                <ZoomOut size={12} />
              </button>
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, "reset");
                  }
                }}
                title={`Reset Zoom (${isMac ? "⌘0" : "Ctrl+0"})`}
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
              >
                Reset
              </button>
              <button
                onClick={() => {
                  if (termRef.current && fitAddonRef.current) {
                    adjustTerminalFontSize(termRef.current, fitAddonRef.current, sessionId, 1);
                  }
                }}
                title={`Zoom In (${isMac ? "⌘+" : "Ctrl++"})`}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Columns2 size={13} />
              <span>Split Right</span>
            </div>
          </button>

          {/* Split Down */}
          <button
            onClick={() => {
              handleSplitDown();
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Rows2 size={13} />
              <span>Split Down</span>
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

      {/* Termius-Style Connection Progress & Process Tree Overlay */}
      {(!isConnected || connectionError) && (
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
