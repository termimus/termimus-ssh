/**
 * Per-session tracker of what the user has typed on the current shell line
 * since the last Enter. Used by the inline `# prompt` AI flow.
 *
 * It is prompt-independent (no guessing where `root@host:~#` ends). It becomes
 * `reliable: false` as soon as anything moves the cursor or edits invisibly
 * (arrows, history, Tab completion, Ctrl+W, multi-line paste…), or when text is
 * written to the PTY by something other than the keyboard (snippets, Copilot).
 *
 * Lives in its own module so both the terminal view and the session store can
 * keep it in sync without an import cycle.
 */
export interface InputTracker {
  text: string;
  reliable: boolean;
}

const trackers = new Map<string, InputTracker>();
const MAX_TRACKED_INPUT = 2000;

const PASTE_START = "\x1b[200~";

export function getInputTracker(sessionId: string): InputTracker | undefined {
  return trackers.get(sessionId);
}

export function setInputTracker(sessionId: string, text: string, reliable: boolean) {
  trackers.set(sessionId, { text, reliable });
}

/** The line content is unknown (e.g. text was written without a trailing Enter). */
export function markInputUnknown(sessionId: string) {
  trackers.set(sessionId, { text: "", reliable: false });
}

/** A fresh, empty line (e.g. after something was executed with Enter). */
export function resetInputTracker(sessionId: string) {
  trackers.set(sessionId, { text: "", reliable: true });
}

export function disposeInputTracker(sessionId: string) {
  trackers.delete(sessionId);
}

/**
 * Bytes that erase the current input line before we type something into it.
 * When we know exactly what was typed (cursor at its end), use that many
 * backspaces — works in emacs and vi insert mode. Otherwise Ctrl+E (end of
 * line) + Ctrl+U (kill to line start).
 */
export function lineClearSequence(sessionId: string): string {
  const t = trackers.get(sessionId);
  if (t?.reliable) return "\x7f".repeat(Array.from(t.text).length);
  return "\x05\x15";
}

/** Mirrors keyboard input (from xterm's onData) into the tracker. */
export function trackInput(sessionId: string, data: string) {
  const t = trackers.get(sessionId) ?? { text: "", reliable: true };

  // Bracketed paste: the shell inserts the text literally (newlines included,
  // nothing executes). A multi-line paste therefore leaves a line we can't
  // mirror; a single-line paste is plain input.
  if (data.includes(PASTE_START)) {
    const content = data.replace(/\x1b\[20[01]~/g, "");
    if (/[\r\n]/.test(content) || /[\u0000-\u001f\u007f]/.test(content.replace(/[\r\n]/g, ""))) {
      t.text = "";
      t.reliable = false;
    } else {
      t.text += content;
    }
    if (t.text.length > MAX_TRACKED_INPUT) t.reliable = false;
    trackers.set(sessionId, t);
    return;
  }

  for (const ch of data) {
    if (ch === "\r" || ch === "\n" || ch === "\x03" || ch === "\x15") {
      // Enter / Ctrl+C / Ctrl+U: fresh, empty, known line.
      t.text = "";
      t.reliable = true;
    } else if (ch === "\x7f" || ch === "\b") {
      t.text = Array.from(t.text).slice(0, -1).join("");
    } else if (ch === "\x1b" || ch < " ") {
      // Escape sequences (arrows, history, Alt+key) and other control keys
      // (Tab completion, Ctrl+A/E/W/R…) change the line in ways we can't mirror.
      t.reliable = false;
      break;
    } else {
      t.text += ch;
    }
  }
  if (t.text.length > MAX_TRACKED_INPUT) t.reliable = false;
  trackers.set(sessionId, t);
}
