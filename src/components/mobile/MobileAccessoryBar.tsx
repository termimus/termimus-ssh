import { useState, useCallback } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Clipboard,
  CornerDownLeft,
} from "lucide-react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { impactFeedback } from "@tauri-apps/plugin-haptics";

function triggerHaptic() {
  try {
    impactFeedback("light").catch(() => {});
  } catch {
    // ignore on desktop/web
  }
}

interface MobileAccessoryBarProps {
  onSendInput: (data: string) => void;
  className?: string;
}

/**
 * Mobile Terminal Accessory Bar:
 * Displays essential control keys (Esc, Tab, Ctrl, Alt, Arrow keys, etc.)
 * directly above the soft keyboard, providing desktop-class terminal navigation on phones.
 */
export function MobileAccessoryBar({ onSendInput, className = "" }: MobileAccessoryBarProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  const handleKeyClick = useCallback(
    (keySeq: string, isModifier = false) => {
      if (isModifier) return;

      let seq = keySeq;

      // Handle Ctrl modifier on regular ascii keys
      if (ctrlActive && seq.length === 1) {
        const code = seq.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          seq = String.fromCharCode(code - 64);
        }
        setCtrlActive(false);
      }

      // Handle Alt modifier (prepends ESC)
      if (altActive) {
        seq = `\x1b${seq}`;
        setAltActive(false);
      }

      triggerHaptic();
      onSendInput(seq);
    },
    [ctrlActive, altActive, onSendInput]
  );

  const handlePaste = useCallback(async () => {
    try {
      let text = await readText();
      if (!text && navigator.clipboard) {
        text = await navigator.clipboard.readText();
      }
      if (text) {
        triggerHaptic();
        onSendInput(text);
      }
    } catch {
      // ignore
    }
  }, [onSendInput]);

  return (
    <div
      className={`flex h-11 w-full items-center gap-1.5 overflow-x-auto border-t border-[var(--border)] bg-[var(--surface-high)] px-2 py-1 select-none no-scrollbar ${className}`}
    >
      {/* ESC key */}
      <button
        type="button"
        onClick={() => handleKeyClick("\x1b")}
        className="flex h-8 min-w-[38px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        ESC
      </button>

      {/* TAB key */}
      <button
        type="button"
        onClick={() => handleKeyClick("\t")}
        className="flex h-8 min-w-[38px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        TAB
      </button>

      {/* CTRL Modifier Toggle */}
      <button
        type="button"
        onClick={() => setCtrlActive((prev) => !prev)}
        className={`flex h-8 min-w-[42px] items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors ${
          ctrlActive
            ? "bg-[var(--primary)] text-black shadow-sm font-bold"
            : "bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--surface-active)]"
        }`}
      >
        CTRL
      </button>

      {/* ALT Modifier Toggle */}
      <button
        type="button"
        onClick={() => setAltActive((prev) => !prev)}
        className={`flex h-8 min-w-[38px] items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors ${
          altActive
            ? "bg-[var(--primary)] text-black shadow-sm font-bold"
            : "bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--surface-active)]"
        }`}
      >
        ALT
      </button>

      {/* Arrow Keys */}
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => handleKeyClick("\x1b[A")}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
          title="Up"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleKeyClick("\x1b[B")}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
          title="Down"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleKeyClick("\x1b[D")}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
          title="Left"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleKeyClick("\x1b[C")}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
          title="Right"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Frequent terminal symbols */}
      <button
        type="button"
        onClick={() => handleKeyClick("|")}
        className="flex h-8 min-w-[28px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        |
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("~")}
        className="flex h-8 min-w-[28px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        ~
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("/")}
        className="flex h-8 min-w-[28px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        /
      </button>

      {/* Paste button */}
      <button
        type="button"
        onClick={handlePaste}
        className="flex h-8 items-center gap-1 rounded-md bg-[var(--surface-container)] px-2 text-xs font-medium text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
        title="Paste Clipboard"
      >
        <Clipboard className="h-3.5 w-3.5" />
        <span>Paste</span>
      </button>

      {/* Enter */}
      <button
        type="button"
        onClick={() => handleKeyClick("\r")}
        className="flex h-8 min-w-[32px] items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black"
      >
        <CornerDownLeft className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
