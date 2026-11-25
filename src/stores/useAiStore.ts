import { create } from "zustand";
import {
  api,
  AiProviderSummary,
  AiProviderInput,
  TerminalAiRequest,
  AiStreamChunk,
  AiCommandResult,
  TerminalEnvironment,
  AI_CANCELLED,
} from "../lib/api";
import { listen } from "@tauri-apps/api/event";
import { useRightPanelStore } from "./useRightPanelStore";
import { useSessionStore } from "./useSessionStore";
import i18n from "../i18n";

/** Display label for the Copilot toggle shortcut (Alt+I, or Cmd+I on macOS). */
export const AI_COPILOT_SHORTCUT_LABEL =
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)
    ? "⌘I"
    : "Alt+I";

export type AiMode = "generate" | "explain";

/** Max Copilot history entries kept per host (in memory only). */
const HISTORY_LIMIT = 50;

export interface AiHistoryItem {
  id: string;
  mode: AiMode;
  prompt: string;
  /** Generate: the command. Explain: the explanation text. Cancelled: partial output. */
  result: string;
  /** Structured result (generate mode only). */
  command?: AiCommandResult;
  error?: string | null;
  cancelled?: boolean;
  timestamp: string;
  sessionId?: string;
  hostLabel?: string;
}

/** A request currently streaming for one terminal session + mode. */
export interface AiLiveRun {
  requestId: string;
  mode: AiMode;
  prompt: string;
  /** Raw streamed text (JSON in generate mode) — render via `extractStreamingCommand`. */
  stream: string;
  error: string | null;
}

/** Request payload without the store-generated `request_id`. */
export type AiRequestInput = Omit<TerminalAiRequest, "request_id">;

/** Outcome of a Copilot request: exactly one of value / error / cancelled / busy applies. */
export interface AiOutcome<T> {
  value: T | null;
  error?: string;
  cancelled?: boolean;
  /** Another request of the same mode was already running for this session; nothing was sent. */
  busy?: boolean;
}

/** Resolved at call time so it follows the current UI language. */
export const aiBusyMessage = () => i18n.t("ai.busy");

export type EnvironmentStatus = "detecting" | "ready" | "failed";

/** Status of an inline `# prompt` request typed directly in a terminal. */
export interface InlineAiState {
  status: "generating" | "inserted" | "review" | "error" | "cancelled";
  prompt: string;
  /** Short human message for review/error states. */
  message?: string;
  command?: AiCommandResult;
}

/**
 * History bucket for a terminal session: its saved host id (`"local"` for local
 * shells). Keyed by host rather than session so history survives reconnects
 * and new tabs to the same server.
 */
export function aiHostKey(sessionId: string): string {
  const tab = useSessionStore.getState().tabs.find((t) => t.id === sessionId);
  if (tab?.isLocal || sessionId.startsWith("local-")) return "local";
  return tab?.hostId ?? sessionId;
}

/** Stable empty values so selectors don't return fresh references. */
export const EMPTY_HISTORY: AiHistoryItem[] = [];

interface AiState {
  providers: AiProviderSummary[];
  activeProvider: AiProviderSummary | null;
  isLoading: boolean;
  error: string | null;

  // Sidebar state (open/closed lives in useRightPanelStore, "ai" tab)
  activeSessionId: string | null;
  /** Copilot history per host (see `aiHostKey`). In memory only. */
  histories: Record<string, AiHistoryItem[]>;

  // Detected terminal environments, keyed by session id
  environments: Record<string, TerminalEnvironment>;
  environmentStatus: Record<string, EnvironmentStatus>;

  /** In-flight requests per session id and mode. */
  runs: Record<string, Partial<Record<AiMode, AiLiveRun>>>;

  /** Inline `# prompt` status per terminal session (drives the in-terminal overlay). */
  inline: Record<string, InlineAiState>;
  setInline: (sessionId: string, state: InlineAiState | null) => void;

  // Actions
  loadProviders: () => Promise<void>;
  saveProvider: (input: AiProviderInput, id?: string) => Promise<AiProviderSummary>;
  deleteProvider: (id: string) => Promise<void>;
  setActiveProvider: (id: string) => Promise<void>;
  testProvider: (id?: string, tempInput?: AiProviderInput) => Promise<string>;
  fetchOllamaModels: (baseUrl: string) => Promise<string[]>;

  toggleSidebar: (sessionId?: string) => void;
  openSidebar: (sessionId?: string) => void;
  closeSidebar: () => void;
  /** Clears the history of one host (see `aiHostKey`). */
  clearHistory: (hostKey: string) => void;

  /** Detects (once per session, deduplicated) the session's OS/shell/user. Never throws. */
  ensureEnvironment: (sessionId: string, isLocal: boolean) => Promise<TerminalEnvironment | null>;

  /** Whether a request of `mode` (or any mode) is running for `sessionId`. */
  isBusy: (sessionId: string, mode?: AiMode) => boolean;

  /**
   * Runs a request for `sessionId`. The session's mode slot is claimed
   * synchronously (before `request` resolves), so concurrent callers for the
   * same terminal get `busy` instead of interleaving streams, other terminals
   * are unaffected, and Stop works while the context is still being prepared.
   */
  generateCommand: (
    sessionId: string,
    request: AiRequestInput | Promise<AiRequestInput>
  ) => Promise<AiOutcome<AiCommandResult>>;
  explainError: (
    sessionId: string,
    request: AiRequestInput | Promise<AiRequestInput>
  ) => Promise<AiOutcome<string>>;
  /** Stops in-flight AI requests of one session (or all sessions), optionally only `mode`. */
  cancelInFlight: (sessionId?: string, mode?: AiMode) => Promise<void>;
  /** Drops per-session state (inline status, detected environment, runs) when a tab closes. */
  forgetSession: (sessionId: string) => void;
}

// In-flight detection promises, so concurrent callers share one probe.
const pendingEnvironment = new Map<string, Promise<TerminalEnvironment | null>>();

// Requests the user stopped before they reached the backend (still preparing).
const cancelledBeforeStart = new Set<string>();

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pulls the (possibly still incomplete) `"command"` value out of a streaming
 * JSON reply, so the live card shows the command rather than raw JSON.
 * Returns the raw text when the model isn't answering in JSON at all.
 */
export function extractStreamingCommand(raw: string): string {
  const match = raw.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (match) {
    const body = match[1].replace(/\\$/, "");
    try {
      return JSON.parse(`"${body}"`);
    } catch {
      return body.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  const head = raw.trimStart();
  return head.startsWith("{") || head.startsWith("```") ? "" : raw;
}

function withRun(
  runs: AiState["runs"],
  sessionId: string,
  mode: AiMode,
  update: ((run: AiLiveRun) => AiLiveRun | null) | AiLiveRun | null
): AiState["runs"] {
  const current = runs[sessionId] ?? {};
  const prev = current[mode];
  const next = typeof update === "function" ? (prev ? update(prev) : null) : update;
  const forSession = { ...current };
  if (next) forSession[mode] = next;
  else delete forSession[mode];
  const out = { ...runs };
  if (forSession.generate || forSession.explain) out[sessionId] = forSession;
  else delete out[sessionId];
  return out;
}

function withHistoryItem(
  histories: AiState["histories"],
  hostKey: string,
  item: AiHistoryItem
): AiState["histories"] {
  const list = [...(histories[hostKey] ?? []), item];
  return { ...histories, [hostKey]: list.slice(-HISTORY_LIMIT) };
}

export const useAiStore = create<AiState>((set, get) => {
  /** Shared runner for both modes: stream listener, history entry, cancel handling. */
  async function runRequest<T>(
    mode: AiMode,
    sessionId: string,
    inputOrPromise: AiRequestInput | Promise<AiRequestInput>,
    invokeFn: (req: TerminalAiRequest) => Promise<T>,
    toHistory: (value: T) => Pick<AiHistoryItem, "result" | "command">
  ): Promise<AiOutcome<T>> {
    const isGen = mode === "generate";

    // Claim the slot synchronously — no await before this point.
    if (get().isBusy(sessionId, mode)) return { value: null, busy: true, error: aiBusyMessage() };
    const requestId = newRequestId();
    // Resolved now so the entry lands with the host the request was made for.
    const hostKey = aiHostKey(sessionId);
    const isActive = () => get().runs[sessionId]?.[mode]?.requestId === requestId;
    const addHistory = (item: AiHistoryItem) =>
      set((s) => ({ histories: withHistoryItem(s.histories, hostKey, item) }));

    set((s) => ({
      runs: withRun(s.runs, sessionId, mode, {
        requestId,
        mode,
        prompt: "",
        stream: "",
        error: null,
      }),
    }));

    let unlisten: (() => void) | null = null;
    let base: Omit<AiHistoryItem, "result"> = {
      id: requestId,
      mode,
      prompt: "",
      timestamp: nowLabel(),
      sessionId,
    };
    try {
      let input: AiRequestInput;
      try {
        input = await inputOrPromise;
      } catch (err: unknown) {
        const msg = errorMessage(err);
        addHistory({ ...base, result: "", error: msg });
        return { value: null, error: msg };
      }

      base = {
        ...base,
        prompt: input.prompt || (isGen ? "" : i18n.t("ai.diagnosePrompt")),
        hostLabel: input.host_label ?? undefined,
      };
      const item = base;
      set((s) => ({
        runs: withRun(s.runs, sessionId, mode, (r) =>
          r.requestId === requestId ? { ...r, prompt: item.prompt } : r
        ),
      }));

      unlisten = await listen<AiStreamChunk>(`ai-stream-${requestId}`, (event) => {
        // Ignore stragglers once the request is no longer the active one.
        if (!isActive()) return;
        const { chunk, done, error } = event.payload;
        if (!error && (done || !chunk)) return;
        set((s) => ({
          runs: withRun(s.runs, sessionId, mode, (r) =>
            error ? { ...r, error } : { ...r, stream: r.stream + chunk }
          ),
        }));
      });

      // Stopped while the context was being prepared.
      if (cancelledBeforeStart.has(requestId)) {
        addHistory({ ...item, result: "", cancelled: true });
        return { value: null, cancelled: true };
      }

      const request: TerminalAiRequest = { ...input, request_id: requestId };
      const value = await invokeFn(request);
      addHistory({ ...item, ...toHistory(value) });
      return { value };
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const cancelled = msg === AI_CANCELLED || cancelledBeforeStart.has(requestId);
      const partial = get().runs[sessionId]?.[mode]?.stream ?? "";
      addHistory(
        cancelled
          ? { ...base, result: isGen ? extractStreamingCommand(partial) : partial, cancelled: true }
          : { ...base, result: "", error: msg }
      );
      return cancelled ? { value: null, cancelled: true } : { value: null, error: msg };
    } finally {
      unlisten?.();
      cancelledBeforeStart.delete(requestId);
      // The finished result now lives in history; drop the live run.
      set((s) => ({
        runs: withRun(s.runs, sessionId, mode, (r) => (r.requestId === requestId ? null : r)),
      }));
    }
  }

  return {
    providers: [],
    activeProvider: null,
    isLoading: false,
    error: null,

    activeSessionId: null,
    histories: {},

    environments: {},
    environmentStatus: {},

    runs: {},

    inline: {},
    setInline: (sessionId, state) =>
      set((s) => {
        const next = { ...s.inline };
        if (state) next[sessionId] = state;
        else delete next[sessionId];
        return { inline: next };
      }),

    loadProviders: async () => {
      set({ isLoading: true, error: null });
      try {
        const providers = await api.listAiProviders();
        const active = providers.find((p) => p.is_active) ?? providers[0] ?? null;
        set({ providers, activeProvider: active, isLoading: false });
      } catch (err: unknown) {
        set({ isLoading: false, error: errorMessage(err) });
      }
    },

    saveProvider: async (input: AiProviderInput, id?: string) => {
      set({ isLoading: true, error: null });
      try {
        const saved = await api.saveAiProvider(input, id);
        await get().loadProviders();
        import("./useSyncStore").then((m) => m.useSyncStore.getState().triggerAutoPush()).catch(() => {});
        return saved;
      } catch (err: unknown) {
        set({ isLoading: false });
        throw err;
      }
    },

    deleteProvider: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        await api.deleteAiProvider(id);
        await get().loadProviders();
        import("./useSyncStore").then((m) => m.useSyncStore.getState().triggerAutoPush()).catch(() => {});
      } catch (err: unknown) {
        set({ isLoading: false });
        throw err;
      }
    },

    setActiveProvider: async (id: string) => {
      try {
        await api.setActiveAiProvider(id);
        await get().loadProviders();
      } catch (err: unknown) {
        set({ error: errorMessage(err) });
        throw err;
      }
    },

    testProvider: async (id?: string, tempInput?: AiProviderInput) => {
      return api.testAiProvider(id, tempInput);
    },

    fetchOllamaModels: async (baseUrl: string) => {
      return api.listOllamaModels(baseUrl);
    },

    // The Copilot lives in the "ai" tab of the shared right panel.
    toggleSidebar: (sessionId?: string) => {
      set({ activeSessionId: sessionId ?? get().activeSessionId });
      useRightPanelStore.getState().toggleTab("ai");
    },

    openSidebar: (sessionId?: string) => {
      set({ activeSessionId: sessionId ?? get().activeSessionId });
      useRightPanelStore.getState().open("ai");
    },

    closeSidebar: () => {
      const panel = useRightPanelStore.getState();
      if (panel.activeTab === "ai") panel.close();
    },

    clearHistory: (hostKey: string) => {
      set((s) => {
        const histories = { ...s.histories };
        delete histories[hostKey];
        return { histories };
      });
    },

    ensureEnvironment: async (sessionId: string, isLocal: boolean) => {
      const cached = get().environments[sessionId];
      if (cached) return cached;
      const pending = pendingEnvironment.get(sessionId);
      if (pending) return pending;

      set((s) => ({ environmentStatus: { ...s.environmentStatus, [sessionId]: "detecting" } }));
      const probe = api
        .detectAiEnvironment(sessionId, isLocal)
        .then((env) => {
          set((s) => ({
            environments: { ...s.environments, [sessionId]: env },
            environmentStatus: { ...s.environmentStatus, [sessionId]: "ready" },
          }));
          return env;
        })
        .catch((err) => {
          console.warn("AI environment detection failed:", err);
          set((s) => ({ environmentStatus: { ...s.environmentStatus, [sessionId]: "failed" } }));
          return null;
        })
        .finally(() => pendingEnvironment.delete(sessionId));
      pendingEnvironment.set(sessionId, probe);
      return probe;
    },

    isBusy: (sessionId: string, mode?: AiMode) => {
      const run = get().runs[sessionId];
      return mode ? !!run?.[mode] : !!(run?.generate || run?.explain);
    },

    generateCommand: (sessionId, request) =>
      runRequest("generate", sessionId, request, api.generateTerminalCommand, (cmd) => ({
        result: cmd.command,
        command: cmd,
      })),

    explainError: (sessionId, request) =>
      runRequest("explain", sessionId, request, api.explainTerminalError, (text) => ({
        result: text,
      })),

    cancelInFlight: async (sessionId?: string, mode?: AiMode) => {
      const { runs } = get();
      const sessions = sessionId ? [runs[sessionId]] : Object.values(runs);
      const ids = sessions
        .flatMap((r) => (r ? (mode ? [r[mode]] : [r.generate, r.explain]) : []))
        .map((run) => run?.requestId)
        .filter((id): id is string => !!id);
      // Requests still preparing (env probe) haven't reached the backend yet.
      ids.forEach((id) => cancelledBeforeStart.add(id));
      await Promise.all(
        ids.map((id) => api.cancelAi(id).catch((e) => console.error("AI cancel failed:", e)))
      );
    },

    forgetSession: (sessionId: string) => {
      pendingEnvironment.delete(sessionId);
      // A closed terminal's requests have nowhere to land; stop them.
      void get().cancelInFlight(sessionId);
      set((s) => {
        const inline = { ...s.inline };
        const environments = { ...s.environments };
        const environmentStatus = { ...s.environmentStatus };
        delete inline[sessionId];
        delete environments[sessionId];
        delete environmentStatus[sessionId];
        return { inline, environments, environmentStatus };
      });
    },
  };
});
