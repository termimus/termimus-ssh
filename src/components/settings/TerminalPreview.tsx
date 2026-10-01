import type { TerminalTheme } from "../../lib/terminalThemes";

interface Segment {
  text: string;
  color?: string;
  underline?: boolean;
}

/** Fake terminal preview — plain divs, never a real xterm instance. */
export function TerminalPreview({ theme }: { theme: TerminalTheme }) {
  const s = theme.semantic;
  const fg = theme.xterm.foreground ?? "#f0f6fc";
  const bg = theme.xterm.background ?? "#0a0e14";

  const lines: Segment[][] = [
    [
      { text: "$ ", color: s.command },
      { text: "kubectl get pods -n prod" },
    ],
    [
      { text: "INFO", color: s.info },
      { text: ": Server listening on :8080" },
    ],
    [
      { text: "WARNING", color: s.warning },
      { text: ": deprecated cipher negotiated with " },
      { text: "192.168.1.10:22", color: s.ip, underline: true },
    ],
    [
      { text: "ERROR", color: s.error },
      { text: ": failed to connect to db-primary: " },
      { text: "timeout", color: s.error },
      { text: " after 30s" },
    ],
    [
      { text: "Build " },
      { text: "completed successfully", color: s.success },
      { text: " in 12s" },
    ],
    [
      { text: "DEBUG", color: s.debug },
      { text: " peer=" },
      { text: "fe80::1", color: s.ip, underline: true },
      { text: " trace id=abc123" },
    ],
    [
      { text: "arp who-has " },
      { text: "192.168.1.1", color: s.ip, underline: true },
      { text: "? tell " },
      { text: "AA:BB:CC:DD:EE:FF", color: s.mac },
    ],
  ];

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border)] font-mono text-[11px] leading-relaxed"
      style={{ background: bg, color: fg }}
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 opacity-70">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 truncate text-[10px]">preview — ssh prod@web-01</span>
      </div>
      <div className="space-y-0.5 px-3 py-2.5 select-text">
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
