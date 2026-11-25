import React, { useState } from "react";
import { ArrowRight, Check, Copy, Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isInsertableCommand } from "../../lib/aiContext";

/**
 * Lightweight Markdown renderer for Copilot answers (Explain mode).
 *
 * Supports the subset models actually produce for troubleshooting answers:
 * headings, paragraphs, bullet / numbered lists, fenced code blocks (also an
 * unterminated one while streaming), `inline code` and **bold**. Everything is
 * rendered as React text nodes — never as HTML — so model output can't inject
 * markup. Text is selectable.
 */

export interface CodeBlockActions {
  onCopy: (text: string) => void;
  /** Types the command into the terminal without executing it. */
  onInsert?: (command: string) => void;
  /** Runs the command (the caller applies the risk confirmation gate). */
  onRun?: (command: string) => Promise<void> | void;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; code: string; closed: boolean };

const SHELL_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "fish", "console", "terminal", "powershell", "ps1", "cmd"]);

const FENCE_RE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^\s*[-*•+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const code: string[] = [];
      let closed = false;
      for (i = i + 1; i < lines.length; i++) {
        if (lines[i].trim().startsWith(fence[1])) {
          closed = true;
          break;
        }
        code.push(lines[i]);
      }
      blocks.push({ kind: "code", lang: fence[2].toLowerCase(), code: code.join("\n"), closed });
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = bullet ? null : ORDERED_RE.exec(line);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = !!ordered;
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }

    // Indented continuation of a list item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** `inline code` and **bold** as React nodes (no HTML). */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <code
          key={key++}
          className="rounded bg-[var(--surface-container-high)] px-1 py-px font-mono text-[0.95em] text-[var(--primary)] [overflow-wrap:anywhere]"
        >
          {m[1]}
        </code>
      );
    } else {
      out.push(
        <strong key={key++} className="font-semibold text-[var(--text-primary)]">
          {m[2]}
        </strong>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Command text from a code block: drops `$ ` / `# ` prompt prefixes. */
export function commandFromCodeBlock(code: string): string {
  return code
    .split("\n")
    .map((l) => l.replace(/^\s*[$]\s+/, ""))
    .join("\n")
    .trim();
}

interface AiMarkdownProps {
  text: string;
  /** Actions for shell code blocks; omit for a read-only render (e.g. while streaming). */
  actions?: CodeBlockActions;
  /** Shows a caret after the last block. */
  streaming?: boolean;
}

export function AiMarkdown({ text, actions, streaming }: AiMarkdownProps) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2 text-xs leading-relaxed text-[var(--text-secondary)] select-text cursor-text [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <div
                key={i}
                className={`font-semibold text-[var(--text-primary)] ${
                  block.level <= 2 ? "text-[13px]" : "text-xs"
                } ${i > 0 ? "pt-1" : ""}`}
              >
                {renderInline(block.text)}
              </div>
            );
          case "paragraph":
            return <p key={i}>{renderInline(block.text)}</p>;
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={`space-y-1 pl-4 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-[var(--text-muted)]`}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <CodeBlock
                key={i}
                lang={block.lang}
                code={block.code}
                actions={block.closed && SHELL_LANGS.has(block.lang) ? actions : undefined}
                copyOnly={block.closed && !SHELL_LANGS.has(block.lang) ? actions?.onCopy : undefined}
              />
            );
        }
      })}
      {streaming && (
        <span className="inline-block h-3.5 w-1.5 animate-pulse bg-[var(--primary)] align-middle" />
      )}
    </div>
  );
}

function CodeBlock({
  lang,
  code,
  actions,
  copyOnly,
}: {
  lang: string;
  code: string;
  actions?: CodeBlockActions;
  copyOnly?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const command = commandFromCodeBlock(code);
  const onCopy = actions?.onCopy ?? copyOnly;
  const canInsert = !!actions?.onInsert && isInsertableCommand(command);

  const copy = () => {
    onCopy?.(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const run = async () => {
    if (!actions?.onRun || running) return;
    setRunning(true);
    try {
      await actions.onRun(command);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--canvas)] shadow-inner">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)]/60 bg-[var(--surface-container-lowest)] px-2 py-0.5 select-none">
        <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
          {lang || "shell"}
        </span>
        {onCopy && command && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              title={t("common.copy")}
              className="cursor-pointer rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--text-primary)]"
            >
              {copied ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
            </button>
            {actions?.onInsert && (
              <button
                type="button"
                onClick={() => actions.onInsert?.(command)}
                disabled={!canInsert}
                title={canInsert ? t("ai.sidebar.insertTitle") : t("ai.sidebar.insertMultiline")}
                className="flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowRight className="h-3 w-3" />
                {t("ai.sidebar.insert")}
              </button>
            )}
            {actions?.onRun && (
              <button
                type="button"
                onClick={() => void run()}
                disabled={running}
                title={t("ai.sidebar.runReviewTitle")}
                className="flex cursor-pointer items-center gap-0.5 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-60"
              >
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
                {t("ai.sidebar.run")}
              </button>
            )}
          </div>
        )}
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--primary)] select-text [overflow-wrap:anywhere]">
        {code}
      </pre>
    </div>
  );
}
