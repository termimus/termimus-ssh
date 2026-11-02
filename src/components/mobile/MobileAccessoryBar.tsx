import { useState, useCallback, useRef, useEffect } from "react";
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
 * Supports auto-repeat for navigation keys and modifier chording.
 */
export function MobileAccessoryBar({ onSendInput, className = "" }: MobileAccessoryBarProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Auto-repeat timers for arrow keys on long-press
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRepeat = useCallback(() => {
    if (repeatTimeoutRef.current) {
      clearTimeout(repeatTimeoutRef.current);
      repeatTimeoutRef.current = null;
    }
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopRepeat();
  }, [stopRepeat]);

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

  const startRepeat = useCallback(
    (seq: string) => {
      stopRepeat();
      handleKeyClick(seq);
      // Wait 350ms before repeating, then repeat every 60ms
      repeatTimeoutRef.current = setTimeout(() => {
        repeatIntervalRef.current = setInterval(() => {
          handleKeyClick(seq);
        }, 60);
      }, 350);
    },
    [handleKeyClick, stopRepeat]
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
        className="flex h-8 min-w-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        ESC
      </button>

      {/* TAB key */}
      <button
        type="button"
        onClick={() => handleKeyClick("\t")}
        className="flex h-8 min-w-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        TAB
      </button>

      {/* CTRL Modifier Toggle */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          setCtrlActive((prev) => !prev);
        }}
        className={`flex h-8 min-w-[42px] shrink-0 items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer ${
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
        onClick={() => {
          triggerHaptic();
          setAltActive((prev) => !prev);
        }}
        className={`flex h-8 min-w-[38px] shrink-0 items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer ${
          altActive
            ? "bg-[var(--primary)] text-black shadow-sm font-bold"
            : "bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--surface-active)]"
        }`}
      >
        ALT
      </button>

      {/* Ctrl+C Quick Kill */}
      <button
        type="button"
        onClick={() => handleKeyClick("\x03")}
        className="flex h-8 min-w-[42px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs font-semibold text-[var(--text-primary)] active:bg-[var(--danger)] active:text-white cursor-pointer"
        title="Send SIGINT (Ctrl+C)"
      >
        ^C
      </button>

      {/* Arrow Keys with Auto-Repeat */}
      <div className="flex shrink-0 items-center gap-1 px-0.5">
        <button
          type="button"
          onPointerDown={() => startRepeat("\x1b[A")}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
          title="Up (Hold to repeat)"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onPointerDown={() => startRepeat("\x1b[B")}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
          title="Down (Hold to repeat)"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onPointerDown={() => startRepeat("\x1b[D")}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
          title="Left (Hold to repeat)"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onPointerDown={() => startRepeat("\x1b[C")}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-container)] text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
          title="Right (Hold to repeat)"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation: Home / End */}
      <button
        type="button"
        onClick={() => handleKeyClick("\x1b[H")}
        className="flex h-8 min-w-[34px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-1.5 text-[11px] font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        HOME
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("\x1b[F")}
        className="flex h-8 min-w-[34px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-1.5 text-[11px] font-semibold text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        END
      </button>

      {/* Frequent terminal symbols */}
      <button
        type="button"
        onClick={() => handleKeyClick("|")}
        className="flex h-8 min-w-[28px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        |
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("~")}
        className="flex h-8 min-w-[28px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        ~
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("/")}
        className="flex h-8 min-w-[28px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        /
      </button>
      <button
        type="button"
        onClick={() => handleKeyClick("`")}
        className="flex h-8 min-w-[28px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 font-mono text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        `
      </button>

      {/* Paste button */}
      <button
        type="button"
        onClick={handlePaste}
        className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--surface-container)] px-2 text-xs font-medium text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
        title="Paste Clipboard"
      >
        <Clipboard className="h-3.5 w-3.5" />
        <span>Paste</span>
      </button>

      {/* Enter */}
      <button
        type="button"
        onClick={() => handleKeyClick("\r")}
        className="flex h-8 min-w-[34px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-container)] px-2 text-xs text-[var(--text-primary)] active:bg-[var(--primary)] active:text-black cursor-pointer"
      >
        <CornerDownLeft className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
