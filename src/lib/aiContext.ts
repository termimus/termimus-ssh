import { useSessionStore, SshTab } from "../stores/useSessionStore";
import { useHostStore } from "../stores/useHostStore";
import { useAiStore, AiRequestInput } from "../stores/useAiStore";

export function detectLocalOs(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  return "Linux";
}

export function isLocalTab(tab: SshTab | undefined, sessionId?: string): boolean {
  return !tab || !!tab.isLocal || (sessionId ?? tab.id).startsWith("local-");
}

/**
 * Builds the AI request context for a terminal session: host label, detected
 * environment (probed once per session) and host-config fallbacks. Shared by
 * the Copilot sidebar and the inline `# prompt` flow so both send identical
 * context. `bufferContext` is passed in (rather than read here) to keep this
 * module free of an import cycle with XtermView's terminal pool.
 */
export async function buildAiRequest(
  sessionId: string,
  prompt: string,
  bufferContext?: string
): Promise<AiRequestInput> {
  const tab = useSessionStore.getState().tabs.find((t) => t.id === sessionId);
  const host = tab ? useHostStore.getState().hosts.find((h) => h.id === tab.hostId) : undefined;
  const isLocal = isLocalTab(tab, sessionId);
  const environment = tab?.connected
    ? await useAiStore.getState().ensureEnvironment(sessionId, isLocal)
    : null;

  return {
    session_id: sessionId,
    prompt: prompt.trim(),
    buffer_context: bufferContext || undefined,
    host_label: isLocal ? "Local Machine" : host?.label ?? tab?.hostLabel,
    environment,
    os_type: isLocal ? detectLocalOs() : host?.os_icon ?? null,
    username: isLocal ? null : host?.username ?? null,
  };
}

/**
 * Extracts the natural-language query from a shell input line of the form
 * `<prompt> # find big log files`.
 *
 * The query starts at the first `#` that sits at the start of the line or after
 * whitespace — so prompt characters like `root@host:~#` or `[root@h ~]#` are
 * skipped — and a leftover bare `# ` (plain `sh` root prompt) is stripped.
 * Returns null when there is no usable query.
 */
export function parseInlineQuery(line: string): string | null {
  const m = /(?:^|\s)#\s*(\S.*)$/.exec(line);
  if (!m) return null;
  let query = m[1];
  while (/^#\s+/.test(query)) query = query.replace(/^#\s+/, "");
  query = query.trim();
  return query.length >= 3 && /[\p{L}]/u.test(query) ? query : null;
}

/**
 * Whether a generated command can be typed into the shell line safely: no
 * newlines or control characters (a newline would execute it immediately).
 */
export function isInsertableCommand(command: string): boolean {
  return command.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(command);
}
