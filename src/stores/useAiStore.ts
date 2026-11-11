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
import i18n from "../i18n";

/** Display label for the Copilot toggle shortcut (Alt+I, or Cmd+I on macOS). */
export const AI_COPILOT_SHORTCUT_LABEL =
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)
    ? "⌘I"
    : "Alt+I";

export type AiMode = "generate" | "explain";

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

/** Request payload without the store-generated `request_id`. */
export type AiRequestInput = Omit<TerminalAiRequest, "request_id">;

/** Outcome of a Copilot request: exactly one of value / error / cancelled / busy applies. */
export interface AiOutcome<T> {
  value: T | null;
  error?: string;
  cancelled?: boolean;
  /** Another request of the same mode was already running; nothing was sent. */
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

interface AiState {
  providers: AiProviderSummary[];
  activeProvider: AiProviderSummary | null;
  isLoading: boolean;
  error: string | null;

  // Sidebar state (open/closed lives in useRightPanelStore, "ai" tab)
  activeSessionId: string | null;
  history: AiHistoryItem[];

  // Detected terminal environments, keyed by session id
  environments: Record<string, TerminalEnvironment>;
  environmentStatus: Record<string, EnvironmentStatus>;

  // Active generation state
  isGenerating: boolean;
  /** Raw streamed text (JSON in generate mode) — render via `extractStreamingCommand`. */
  streamingCommand: string;
  generationError: string | null;

  // Explainer state
  isExplaining: boolean;
  streamingExplanation: string;
  explanationError: string | null;

  /** In-flight request ids per mode (used for Stop). */
  inflight: Record<AiMode, string | null>;

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
  clearHistory: () => void;

  /** Detects (once per session, deduplicated) the session's OS/shell/user. Never throws. */
  ensureEnvironment: (sessionId: string, isLocal: boolean) => Promise<TerminalEnvironment | null>;

  /**
   * Runs a request. The mode's slot is claimed synchronously (before `request`
   * resolves), so concurrent callers get `busy` instead of interleaving
   * streams, and Stop works while the context is still being prepared.
   */
  generateCommand: (
    request: AiRequestInput | Promise<AiRequestInput>
  ) => Promise<AiOutcome<AiCommandResult>>;
  explainError: (request: AiRequestInput | Promise<AiRequestInput>) => Promise<AiOutcome<string>>;
  /** Stops in-flight AI requests (all modes, or only `mode`). */
  cancelInFlight: (mode?: AiMode) => Promise<void>;
  clearStreaming: () => void;
  /** Drops per-session state (inline status, detected environment) when a tab closes. */
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

export const useAiStore = create<AiState>((set, get) => {
  /** Shared runner for both modes: stream listener, history entry, cancel handling. */
  async function runRequest<T>(
    mode: AiMode,
    inputOrPromise: AiRequestInput | Promise<AiRequestInput>,
    invokeFn: (req: TerminalAiRequest) => Promise<T>,
    toHistory: (value: T) => Pick<AiHistoryItem, "result" | "command">
  ): Promise<AiOutcome<T>> {
    const isGen = mode === "generate";
    const streamKey = isGen ? "streamingCommand" : "streamingExplanation";
    const errorKey = isGen ? "generationError" : "explanationError";
    const busyKey = isGen ? "isGenerating" : "isExplaining";

    // Claim the slot synchronously — no await before this point.
    if (get()[busyKey]) return { value: null, busy: true, error: aiBusyMessage() };
    const requestId = newRequestId();
    set((s) => ({
      [busyKey]: true,
      [streamKey]: "",
      [errorKey]: null,
      inflight: { ...s.inflight, [mode]: requestId },
    }) as Partial<AiState>);

    let unlisten: (() => void) | null = null;
    let base: Omit<AiHistoryItem, "result"> | null = null;
    try {
      let input: AiRequestInput;
      try {
        input = await inputOrPromise;
      } catch (err: unknown) {
        const msg = errorMessage(err);
        set({ [errorKey]: msg } as Partial<AiState>);
        return { value: null, error: msg };
      }

      base = {
        id: requestId,
        mode,
        prompt: input.prompt || (isGen ? "" : i18n.t("ai.diagnosePrompt")),
        timestamp: nowLabel(),
        sessionId: input.session_id,
        hostLabel: input.host_label ?? undefined,
      };
      const item = base;

      unlisten = await listen<AiStreamChunk>(`ai-stream-${requestId}`, (event) => {
        // Ignore stragglers once the request is no longer the active one.
        if (get().inflight[mode] !== requestId) return;
        if (event.payload.error) {
          set({ [errorKey]: event.payload.error } as Partial<AiState>);
        } else if (!event.payload.done) {
          set((s) => ({ [streamKey]: s[streamKey] + event.payload.chunk }) as Partial<AiState>);
        }
      });

      // Stopped while the context was being prepared.
      if (cancelledBeforeStart.has(requestId)) {
        set((s) => ({ history: [...s.history, { ...item, result: "", cancelled: true }] }));
        return { value: null, cancelled: true };
      }

      const request: TerminalAiRequest = { ...input, request_id: requestId };
      const value = await invokeFn(request);
      // The finished result lives in history; clear the live card so it isn't shown twice.
      set((s) => ({
        [streamKey]: "",
        [errorKey]: null,
        history: [...s.history, { ...item, ...toHistory(value) }],
      }) as Partial<AiState>);
      return { value };
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const cancelled = msg === AI_CANCELLED || cancelledBeforeStart.has(requestId);
      const partial = get()[streamKey];
      const item = base;
      set((s) => ({
        [streamKey]: "",
        [errorKey]: null,
        history: item
          ? [
              ...s.history,
              cancelled
                ? {
                    ...item,
                    result: isGen ? extractStreamingCommand(partial) : partial,
                    cancelled: true,
                  }
                : { ...item, result: "", error: msg },
            ]
          : s.history,
      }) as Partial<AiState>);
      return cancelled ? { value: null, cancelled: true } : { value: null, error: msg };
    } finally {
      unlisten?.();
      cancelledBeforeStart.delete(requestId);
      set((s) => ({
        [busyKey]: false,
        inflight: { ...s.inflight, [mode]: s.inflight[mode] === requestId ? null : s.inflight[mode] },
      }) as Partial<AiState>);
    }
  }

  return {
    providers: [],
    activeProvider: null,
    isLoading: false,
    error: null,

    activeSessionId: null,
    history: [],

    environments: {},
    environmentStatus: {},

    isGenerating: false,
    streamingCommand: "",
    generationError: null,

    isExplaining: false,
    streamingExplanation: "",
    explanationError: null,

    inflight: { generate: null, explain: null },

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

    clearHistory: () => {
      set({ history: [], streamingCommand: "", streamingExplanation: "" });
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

    generateCommand: (request) =>
      runRequest("generate", request, api.generateTerminalCommand, (cmd) => ({
        result: cmd.command,
        command: cmd,
      })),

    explainError: (request) =>
      runRequest("explain", request, api.explainTerminalError, (text) => ({ result: text })),

    cancelInFlight: async (mode?: AiMode) => {
      const { inflight } = get();
      const ids = (mode ? [inflight[mode]] : Object.values(inflight)).filter(
        (id): id is string => !!id
      );
      // Requests still preparing (env probe) haven't reached the backend yet.
      ids.forEach((id) => cancelledBeforeStart.add(id));
      await Promise.all(
        ids.map((id) => api.cancelAi(id).catch((e) => console.error("AI cancel failed:", e)))
      );
    },

    forgetSession: (sessionId: string) => {
      pendingEnvironment.delete(sessionId);
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

    clearStreaming: () => {
      set({
        streamingCommand: "",
        generationError: null,
        streamingExplanation: "",
        explanationError: null,
      });
    },
  };
});
