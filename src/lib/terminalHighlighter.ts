import type { Terminal, IMarker, IDecoration } from "@xterm/xterm";
import {
  HIGHLIGHT_PATTERNS,
  type HighlightKey,
} from "./highlightPatterns";
import type { TerminalSemanticColors } from "./terminalThemes";

export interface HighlighterConfig {
  enabled: Record<HighlightKey, boolean>;
  colors: TerminalSemanticColors;
}

const MAX_LINE_LENGTH = 2000;
const MAX_DECORATIONS_PER_SCAN = 200;
const SCAN_DEBOUNCE_MS = 150;

/** xterm decorations only accept #RRGGBB — strip alpha / expand shorthand. */
function toRgbHex(color: string): string | undefined {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(color.trim());
  if (!m) return undefined;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (hex.length === 4) {
    hex = hex
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (hex.length > 6) {
    hex = hex.slice(0, 6);
  }
  if (hex.length !== 6) return undefined;
  return `#${hex}`;
}

/**
 * Keyword highlighter using xterm decoration overlays.
 *
 * Decorations never touch the buffer, so copy/paste stays clean and curses
 * apps (htop/vim) are unaffected. Only the visible viewport is scanned,
 * debounced, and capped to keep scroll performance intact.
 */
export class TerminalHighlighter {
  private term: Terminal;
  private getConfig: () => HighlighterConfig;
  private decorations: IDecoration[] = [];
  private markers: IMarker[] = [];
  private disposables: Array<{ dispose: () => void }> = [];
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private attached = false;

  constructor(term: Terminal, getConfig: () => HighlighterConfig) {
    this.term = term;
    this.getConfig = getConfig;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const term = this.term;

    this.disposables.push(
      term.onWriteParsed(() => this.scheduleScan()),
      term.onScroll(() => this.scheduleScan()),
      term.onResize(() => this.scheduleScan())
    );
    this.scheduleScan();
  }

  detach(): void {
    this.attached = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables = [];
    this.clearDecorations();
  }

  /** Re-scan immediately (e.g. after theme/toggle change). */
  refresh(): void {
    if (!this.attached) return;
    this.scheduleScan(0);
  }

  private scheduleScan(delay: number = SCAN_DEBOUNCE_MS): void {
    if (!this.attached) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.scan();
    }, delay);
  }

  private clearDecorations(): void {
    for (const d of this.decorations) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    for (const m of this.markers) {
      try {
        m.dispose();
      } catch {
        // ignore
      }
    }
    this.decorations = [];
    this.markers = [];
  }

  private scan(): void {
    if (!this.attached) return;
    this.clearDecorations();

    const config = this.getConfig();
    const activePatterns = HIGHLIGHT_PATTERNS.filter(
      (p) => config.enabled[p.key]
    ).sort((a, b) => b.priority - a.priority);
    if (activePatterns.length === 0) return;

    const term = this.term;
    let buffer;
    try {
      buffer = term.buffer.active;
    } catch {
      return;
    }

    const rows = term.rows;
    if (!rows || rows <= 0) return;

    const cursorAbsoluteLine = buffer.baseY + buffer.cursorY;
    let created = 0;

    for (let row = 0; row < rows; row++) {
      if (created >= MAX_DECORATIONS_PER_SCAN) break;
      const absoluteLine = buffer.viewportY + row;
      const line = buffer.getLine(absoluteLine);
      if (!line) continue;
      let text: string;
      try {
        text = line.translateToString(true);
      } catch {
        continue;
      }
      if (!text || text.length > MAX_LINE_LENGTH) continue;

      // Track claimed cell ranges so higher-priority matches win overlaps.
      const claimed: Array<{ start: number; end: number }> = [];
      const isFree = (start: number, end: number) =>
        !claimed.some((c) => start < c.end && end > c.start);

      for (const pattern of activePatterns) {
        if (created >= MAX_DECORATIONS_PER_SCAN) break;
        pattern.regex.lastIndex = 0;
        const color = toRgbHex(config.colors[pattern.key]);
        if (!color) continue;

        let match: RegExpExecArray | null;
        // Guard against pathological backtracking on long lines.
        let guard = 0;
        while ((match = pattern.regex.exec(text)) !== null) {
          if (++guard > 100) break;
          const start = match.index;
          const end = start + match[0].length;
          if (end <= start || !isFree(start, end)) {
            if (match[0].length === 0) pattern.regex.lastIndex++;
            continue;
          }
          claimed.push({ start, end });

          let marker: IMarker;
          try {
            marker = term.registerMarker(absoluteLine - cursorAbsoluteLine);
          } catch {
            break;
          }
          this.markers.push(marker);

          try {
            const decoration = term.registerDecoration({
              marker,
              x: start,
              width: end - start,
              foregroundColor: color,
              layer: "top",
            });
            if (decoration) {
              if (pattern.underline) {
                decoration.onRender((el) => {
                  el.style.borderBottom = `1px solid ${color}`;
                });
              }
              this.decorations.push(decoration);
              created++;
            } else {
              marker.dispose();
              this.markers.pop();
            }
          } catch {
            try {
              marker.dispose();
            } catch {
              // ignore
            }
            this.markers.pop();
            break;
          }

          if (match[0].length === 0) pattern.regex.lastIndex++;
          if (created >= MAX_DECORATIONS_PER_SCAN) break;
        }
      }
    }
  }
}
