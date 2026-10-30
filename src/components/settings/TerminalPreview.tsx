import type { TerminalTheme } from "../../lib/terminalThemes";
import type { TerminalFontSettings } from "../../stores/useTerminalThemeStore";

interface Segment {
  text: string;
  color?: string;
  underline?: boolean;
}

/** Fake terminal preview — plain divs, never a real xterm instance. */
export function TerminalPreview({
  theme,
  font,
}: {
  theme: TerminalTheme;
  font?: TerminalFontSettings;
}) {
  const s = theme.semantic;
  const fg = theme.xterm.foreground ?? "#f0f6fc";
  const bg = theme.xterm.background ?? "#0a0e14";

  const lines: Segment[][] = [
    [
      { text: "⚡ ", color: s.warning },
      { text: "root@termimus", color: s.command },
      { text: "  ~  ", color: s.info },
      { text: "ssh user@192.168.1.10 -p 2200" },
    ],
    [
      { text: "INFO", color: s.info },
      { text: ": connected -> session ready" },
      { text: " [0O 1lI != <= >=]" },
    ],
    [
      { text: "WARNING", color: s.warning },
      { text: ": cipher fallback negotiated for " },
      { text: "192.168.1.10:22", color: s.ip, underline: true },
    ],
    [
      { text: "Build ", color: fg },
      { text: "completed successfully", color: s.success },
      { text: " in 1.24s (status: 0)" },
    ],
  ];

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border)] select-text shadow-sm"
      style={{
        background: bg,
        color: fg,
        fontFamily: font?.fontFamily || "'JetBrains Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'Fira Code', monospace",
        fontSize: font?.fontSize ? `${Math.min(font.fontSize, 13)}px` : "12px",
        lineHeight: font?.lineHeight || 1.35,
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 opacity-75 font-sans">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 truncate text-[10px] text-[var(--text-muted)]">
            preview — ssh prod@web-01
          </span>
        </div>
        {font && (
          <span className="text-[10px] font-mono text-[var(--text-muted)] opacity-80">
            {font.fontSize.toFixed(1)}pt · lh {font.lineHeight.toFixed(2)}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3.5">
        {lines.map((segments, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {segments.map((seg, j) => (
              <span
                key={j}
                style={{
                  color: seg.color,
                  textDecoration: seg.underline ? "underline" : undefined,
                }}
              >
                {seg.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
