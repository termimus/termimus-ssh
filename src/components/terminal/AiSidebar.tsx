import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Trash2,
  Settings,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Play,
  ArrowRight,
  Copy,
  Check,
  Loader2,
  Terminal as TerminalIcon,
  CheckCircle2,
  CornerDownLeft,
  Square,
  Cpu,
  Ban,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Trans, useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  useAiStore,
  AiHistoryItem,
  AI_COPILOT_SHORTCUT_LABEL,
  extractStreamingCommand,
} from "../../stores/useAiStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { AiRiskLevel, TerminalEnvironment } from "../../lib/api";
import { getTerminalBufferSlice, focusTerminalSession } from "./XtermView";
import { AiProviderModal } from "../settings/AiProviderModal";
import { buildAiRequest, isInsertableCommand } from "../../lib/aiContext";
import { RightPanelTabs, RightPanelCloseButton } from "./RightPanelTabs";
import {
  AiRunConfirmDialog,
  PendingRun,
  isProductionHost,
  runConfirmationFor,
} from "./AiRunConfirmDialog";

type CopilotMode = "generate" | "explain";

interface RunnableCommand {
  command: string;
  risk: AiRiskLevel;
  reasons: string[];
  explanation?: string;
  /** Session the command was generated for (may differ from the active tab). */
  sessionId?: string;
  hostLabel?: string;
}

function describeEnvironment(env: TerminalEnvironment): string {
  const user = env.user ? `${env.user}${env.is_root ? " (root)" : ""}` : null;
  return [env.os_name, env.shell, user].filter(Boolean).join(" · ");
}

async function copyToClipboard(text: string) {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => {});
  }
}

export function AiSidebar({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const {
    activeProvider,
    loadProviders,
    generateCommand,
    explainError,
    cancelInFlight,
    ensureEnvironment,
    isGenerating,
    isExplaining,
    streamingCommand,
    streamingExplanation,
    generationError,
    explanationError,
    history,
    clearHistory,
    clearStreaming,
  } = useAiStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      loadProviders: s.loadProviders,
      generateCommand: s.generateCommand,
      explainError: s.explainError,
      cancelInFlight: s.cancelInFlight,
      ensureEnvironment: s.ensureEnvironment,
      isGenerating: s.isGenerating,
      isExplaining: s.isExplaining,
      streamingCommand: s.streamingCommand,
      streamingExplanation: s.streamingExplanation,
      generationError: s.generationError,
      explanationError: s.explanationError,
      history: s.history,
      clearHistory: s.clearHistory,
      clearStreaming: s.clearStreaming,
    }))
  );

  const { activeTabId, tabs, writeCommandToSession } = useSessionStore(
    useShallow((s) => ({
      activeTabId: s.activeTabId,
      tabs: s.tabs,
      writeCommandToSession: s.writeCommandToSession,
    }))
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const host = useHostStore((s) => s.hosts.find((h) => h.id === activeTab?.hostId));
  const isLocal = !activeTab || !!activeTab.isLocal || activeTab.id.startsWith("local-");
  const environment = useAiStore((s) => (activeTabId ? s.environments[activeTabId] : undefined));
  const environmentStatus = useAiStore((s) =>
    activeTabId ? s.environmentStatus[activeTabId] : undefined
  );

  const [mode, setMode] = useState<CopilotMode>("generate");
  const [prompt, setPrompt] = useState("");
  const [includeBuffer, setIncludeBuffer] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Focus the prompt whenever the Copilot tab becomes visible
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [active]);

  // Detect the real OS/shell/user of the active session up front, so the first
  // request doesn't pay the probe latency.
  useEffect(() => {
    if (active && activeTab?.connected) {
      void ensureEnvironment(activeTab.id, isLocal);
    }
  }, [active, activeTab?.id, activeTab?.connected, isLocal, ensureEnvironment]);

  const isStreaming = isGenerating || isExplaining;
  const inProgress = isStreaming;
  const currentResult =
    mode === "generate" ? extractStreamingCommand(streamingCommand) : streamingExplanation;
  const currentError = mode === "generate" ? generationError : explanationError;

  // Keep the newest card in view
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" });
  }, [history.length, currentResult]);

  const handleCopy = (text: string, id: string) => {
    void copyToClipboard(text.trim());
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const executeCommand = useCallback(
    async (cmd: string, sessionId: string) => {
      await writeCommandToSession(sessionId, cmd.trim(), true);
      focusTerminalSession(sessionId);
    },
    [writeCommandToSession]
  );

  const handleRunCommand = (item: RunnableCommand) => {
    if (!item.command.trim() || !activeTab?.connected) return;
    const isProduction = !isLocal && isProductionHost(host?.tags);
    let gate = runConfirmationFor(item.risk, isProduction);
    // A command generated for another terminal is never run silently here.
    const crossSession = !!item.sessionId && item.sessionId !== activeTab.id;
    if (gate === "none" && crossSession && item.risk !== "safe") gate = "click";

    if (gate === "none") {
      void executeCommand(item.command, activeTab.id);
      return;
    }
    setPendingRun({
      sessionId: activeTab.id,
      command: item.command.trim(),
      risk: item.risk,
      reasons: item.reasons,
      explanation: item.explanation,
      targetLabel: isLocal ? t("sftp.localMachine") : activeTab.hostLabel,
      targetAddress: isLocal ? undefined : activeTab.hostAddress,
      isProduction,
      mode: gate,
      note: crossSession
        ? t("ai.sidebar.crossSessionNote", { host: item.hostLabel ?? t("ai.sidebar.anotherTerminal") })
        : undefined,
    });
  };

  const handleInsertCommand = async (cmd: string) => {
    // A newline in the inserted text would execute it, bypassing the Run gate.
    if (!activeTabId || !isInsertableCommand(cmd.trim())) return;
    await writeCommandToSession(activeTabId, cmd.trim(), false);
    focusTerminalSession(activeTabId);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inProgress) return;
    if (!activeProvider) {
      setIsSettingsModalOpen(true);
      return;
    }
    if (mode === "generate" && !prompt.trim()) return;

    const sessionId = activeTabId || "default";
    const bufferContext =
      includeBuffer && activeTabId ? getTerminalBufferSlice(activeTabId, 50) : undefined;

    // Same context builder as the inline `# prompt` flow (env probe is cached).
    // Passed as a promise so the request slot is claimed before the probe runs.
    const req = buildAiRequest(sessionId, prompt, bufferContext);
    const outcome = mode === "generate" ? await generateCommand(req) : await explainError(req);
    if (outcome.value !== null) setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] select-none"
      aria-label={t("ai.sidebar.ariaLabel")}
    >
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-b border-[var(--border)] px-2">
        <RightPanelTabs />

        <div className="flex items-center gap-1 shrink-0">
          {history.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              title={t("ai.sidebar.clearHistory")}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            title={t("ai.sidebar.configureProvider")}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <RightPanelCloseButton />
        </div>
      </div>

      {/* ── Active Provider & Target Terminal Context ────────────────────────── */}
      <div className="p-2.5 border-b border-[var(--border)]/60 bg-[var(--surface-container-lowest)]/50 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          {activeProvider ? (
            <div className="flex items-center gap-1.5 min-w-0 font-mono text-[11px] text-[var(--text-secondary)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shadow-[0_0_6px_var(--primary)] shrink-0" />
              <span className="font-medium truncate text-[var(--text-primary)]">
                {activeProvider.name}
              </span>
              <span className="text-[var(--text-muted)] truncate">
                ({activeProvider.model_name})
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(true)}
              className="flex items-center gap-1 text-[11px] text-[var(--warning)] hover:underline cursor-pointer"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>{t("ai.sidebar.configureProviderByok")}</span>
            </button>
          )}

          {/* Target Host Indicator */}
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] truncate">
            <TerminalIcon className="w-3 h-3 text-[var(--primary)] shrink-0" />
            <span className="truncate max-w-[110px]" title={activeTab?.hostLabel || t("sftp.localMachine")}>
              {activeTab?.hostLabel || t("ai.sidebar.localShort")}
            </span>
            {!isLocal && isProductionHost(host?.tags) && (
              <span className="shrink-0 rounded-full border border-[var(--danger)]/40 bg-[var(--danger)]/15 px-1 text-[9px] font-bold uppercase text-[var(--danger)]">
                prod
              </span>
            )}
          </div>
        </div>

        {/* Detected environment */}
        {activeTab?.connected && (
          <div
            className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)] min-w-0"
            title={
              environment
                ? [
                    environment.os_name,
                    environment.kernel && `kernel ${environment.kernel}`,
                    environment.arch,
                    environment.shell && `shell ${environment.shell}`,
                    environment.package_manager && `pkg ${environment.package_manager}`,
                    environment.init_system && `init ${environment.init_system}`,
                  ]
                    .filter(Boolean)
                    .join("\n")
                : undefined
            }
          >
            <Cpu className="w-3 h-3 shrink-0 text-[var(--secondary)]" />
            {environment ? (
              <span className="truncate">{describeEnvironment(environment)}</span>
            ) : environmentStatus === "detecting" ? (
              <span className="flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> {t("ai.sidebar.detectingEnv")}
              </span>
            ) : environmentStatus === "failed" ? (
              <span className="text-[var(--warning)]">{t("ai.sidebar.envUnknown")}</span>
            ) : null}
          </div>
        )}

        {/* Mode Selector Tabs */}
        <div className="flex items-center bg-[var(--surface-low)] rounded-lg p-0.5 border border-[var(--border)] text-[11px]">
          {(["generate", "explain"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                clearStreaming();
              }}
              className={`flex-1 py-1 text-center rounded-md font-medium transition-colors cursor-pointer ${
                mode === m
                  ? "bg-[var(--primary)] text-[var(--on-primary)] font-semibold shadow-xs"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {m === "generate" ? t("ai.sidebar.modeGenerate") : t("ai.sidebar.modeExplain")}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable History & Stream Results Feed ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Empty State */}
        {history.length === 0 && !currentResult && !inProgress && !currentError && (
          <div className="py-8 px-2 text-center">
            <div className="w-10 h-10 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="text-xs font-semibold text-[var(--text-primary)]">
              {mode === "generate" ? t("ai.sidebar.emptyGenerateTitle") : t("ai.sidebar.emptyExplainTitle")}
            </h4>
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed max-w-xs mx-auto">
              {mode === "generate"
                ? t("ai.sidebar.emptyGenerateDesc")
                : t("ai.sidebar.emptyExplainDesc")}
            </p>

            <div className="mt-4 pt-3 border-t border-[var(--border)]/40 text-left space-y-1.5 text-[11px] text-[var(--text-muted)] font-mono">
              <div className="text-[10px] uppercase font-semibold text-[var(--text-secondary)]">
                {t("ai.sidebar.examples")}
              </div>
              {(mode === "generate"
                ? [
                    [t("ai.sidebar.exGenDisk"), t("ai.sidebar.exGenDiskShort")],
                    [t("ai.sidebar.exGenMemory"), t("ai.sidebar.exGenMemoryShort")],
                    [t("ai.sidebar.exGenFailed"), t("ai.sidebar.exGenFailedShort")],
                  ]
                : [
                    [t("ai.sidebar.exExpWhy"), t("ai.sidebar.exExpWhyShort")],
                    [t("ai.sidebar.exExpPermission"), t("ai.sidebar.exExpPermissionShort")],
                    [t("ai.sidebar.exExpService"), t("ai.sidebar.exExpServiceShort")],
                  ]
              ).map(([full, short]) => (
                <button
                  key={short}
                  type="button"
                  onClick={() => {
                    setPrompt(full);
                    inputRef.current?.focus();
                  }}
                  title={full}
                  className="w-full text-left p-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-container-low)] hover:border-[var(--primary)]/50 hover:text-[var(--primary)] transition-all cursor-pointer truncate"
                >
                  {short}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* History Cards */}
        {history.map((item) => (
          <HistoryCard
            key={item.id}
            item={item}
            onRun={handleRunCommand}
            onInsert={handleInsertCommand}
            onCopy={handleCopy}
            isCopied={copiedId === item.id}
          />
        ))}

        {/* Live Streaming / Error Card (finished results move into history) */}
        {(currentResult || inProgress || currentError) && (
          <div className="p-3 rounded-2xl border border-[var(--primary)]/40 bg-[var(--surface-container-low)] shadow-sm animate-in fade-in duration-150">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-[var(--primary)] uppercase tracking-wider flex items-center gap-1.5">
                {inProgress ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {environmentStatus === "detecting" && !currentResult ? t("ai.sidebar.detectingEnv") : t("ai.sidebar.synthesizing")}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    {t("ai.sidebar.latestResult")}
                  </>
                )}
              </span>
            </div>

            {currentError ? (
              <div className="p-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words leading-relaxed">{currentError}</span>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--canvas)] font-mono text-xs text-[var(--primary)] overflow-x-auto leading-relaxed shadow-inner">
                <pre className="whitespace-pre-wrap break-all font-mono">
                  {currentResult}
                  {isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 bg-[var(--primary)] ml-1 animate-pulse align-middle" />
                  )}
                </pre>
              </div>
            )}
          </div>
        )}

        <div ref={feedEndRef} />
      </div>

      {/* ── Prompt Composer & Context Controls ───────────────────────────────── */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface-container-lowest)]">
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={includeBuffer}
                onChange={(e) => setIncludeBuffer(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[var(--border)] accent-[var(--primary)] text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer"
              />
              <span>{t("ai.sidebar.sendBuffer")}</span>
            </label>
          </div>

          <div className="relative">
            <textarea
              ref={inputRef}
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === "generate"
                  ? t("ai.sidebar.placeholderGenerate")
                  : t("ai.sidebar.placeholderExplain")
              }
              className="w-full resize-none p-2.5 pr-14 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all font-sans leading-relaxed"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={() => void cancelInFlight()}
                className="absolute right-2 bottom-2.5 p-1.5 rounded-lg bg-[var(--danger)] hover:opacity-90 text-white transition-colors flex items-center justify-center shadow-xs cursor-pointer"
                title={t("ai.sidebar.stop")}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={inProgress || (mode === "generate" && !prompt.trim())}
                className="absolute right-2 bottom-2.5 p-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)] disabled:opacity-40 transition-colors flex items-center justify-center shadow-xs cursor-pointer"
                title={t("ai.sidebar.send")}
              >
                {inProgress ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CornerDownLeft className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-0.5 text-[10px] text-[var(--text-muted)] px-0.5">
            <span>
              <Trans
                i18nKey="ai.sidebar.tipInline"
                values={{ shortcut: AI_COPILOT_SHORTCUT_LABEL }}
                components={{ kbd: <kbd className="font-mono bg-[var(--surface-container-high)] px-1 rounded" /> }}
              />
            </span>
            <span>
              <Trans
                i18nKey="ai.sidebar.tipKeys"
                components={{ kbd: <kbd className="font-mono bg-[var(--surface-container-high)] px-1 rounded" /> }}
              />
            </span>
          </div>
        </form>
      </div>

      <AiProviderModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />

      <AiRunConfirmDialog
        pending={pendingRun}
        onCancel={() => setPendingRun(null)}
        onConfirm={() => {
          const run = pendingRun;
          setPendingRun(null);
          // Run in the terminal that was shown in the dialog, even if the active tab changed.
          if (run) void executeCommand(run.command, run.sessionId);
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Sub-components
 * ───────────────────────────────────────────────────────────────────────────── */

interface HistoryCardProps {
  item: AiHistoryItem;
  onRun: (cmd: RunnableCommand) => void;
  onInsert: (cmd: string) => void;
  onCopy: (text: string, id: string) => void;
  isCopied: boolean;
}

function HistoryCard({ item, onRun, onInsert, onCopy, isCopied }: HistoryCardProps) {
  const { t } = useTranslation();
  const cmd = item.command;
  // Only complete, structured generate results are runnable — never a partial
  // (cancelled) command or an explanation.
  const runnable = item.mode === "generate" && !!cmd && !item.cancelled && !item.error;

  return (
    <div className="p-3 rounded-xl border border-[var(--border)]/80 bg-[var(--surface-container-low)] space-y-2 text-xs shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--surface-container-high)] text-[var(--text-secondary)] uppercase">
            {t(`ai.mode.${item.mode}`)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">{item.timestamp}</span>
          {item.hostLabel && (
            <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[90px]">
              @{item.hostLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {cmd?.needs_sudo && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold border border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]">
              sudo
            </span>
          )}
          {cmd && !item.cancelled && <RiskBadge risk={cmd.risk} reasons={cmd.risk_reasons} />}
          {item.cancelled && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border border-[var(--border)] text-[var(--text-muted)]">
              <Ban className="w-2.5 h-2.5" /> {t("ai.sidebar.cancelled")}
            </span>
          )}
        </div>
      </div>

      {item.prompt && (
        <div className="text-[11px] text-[var(--text-secondary)] font-medium">
          &ldquo;{item.prompt}&rdquo;
        </div>
      )}

      {item.error ? (
        <div className="p-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="break-words">{item.error}</span>
        </div>
      ) : (
        <div>
          {item.result ? (
            <div
              className={`p-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)] font-mono text-xs overflow-x-auto leading-relaxed shadow-inner ${
                item.cancelled ? "text-[var(--text-muted)]" : "text-[var(--primary)]"
              }`}
            >
              <pre className="whitespace-pre-wrap break-all font-mono">{item.result}</pre>
            </div>
          ) : (
            item.cancelled && (
              <div className="text-[11px] text-[var(--text-muted)] italic">{t("ai.sidebar.stoppedEmpty")}</div>
            )
          )}

          {cmd?.explanation && !item.cancelled && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {cmd.explanation}
            </p>
          )}

          {item.result && (
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => onCopy(item.result, item.id)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                title={t("common.copy")}
              >
                {isCopied ? (
                  <Check className="w-3 h-3 text-[var(--success)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>

              {runnable && cmd && (
                <>
                  <button
                    type="button"
                    onClick={() => onInsert(cmd.command)}
                    disabled={!isInsertableCommand(cmd.command.trim())}
                    title={
                      isInsertableCommand(cmd.command.trim())
                        ? t("ai.sidebar.insertTitle")
                        : t("ai.sidebar.insertMultiline")
                    }
                    className="disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded-md border border-[var(--border)] bg-[var(--surface-low)] text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <ArrowRight className="w-3 h-3" />
                    {t("ai.sidebar.insert")}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onRun({
                        command: cmd.command,
                        risk: cmd.risk,
                        reasons: cmd.risk_reasons,
                        explanation: cmd.explanation,
                        sessionId: item.sessionId,
                        hostLabel: item.hostLabel,
                      })
                    }
                    title={cmd.risk === "safe" ? t("ai.sidebar.runTitle") : t("ai.sidebar.runReviewTitle")}
                    className={`px-2.5 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer ${
                      cmd.risk === "destructive"
                        ? "bg-[var(--danger)] text-white hover:opacity-90"
                        : "bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)]"
                    }`}
                  >
                    <Play className="w-3 h-3 fill-current" />
                    {t("ai.sidebar.run")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskBadge({ risk, reasons }: { risk: AiRiskLevel; reasons?: string[] }) {
  const { t } = useTranslation();
  return (
    <span
      title={reasons && reasons.length > 0 ? reasons.join("\n") : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
        risk === "destructive"
          ? "bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30 animate-pulse"
          : risk === "modifying"
          ? "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30"
          : "bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30"
      }`}
    >
      {risk === "destructive" ? (
        <ShieldAlert className="w-2.5 h-2.5" />
      ) : risk === "modifying" ? (
        <AlertTriangle className="w-2.5 h-2.5" />
      ) : (
        <ShieldCheck className="w-2.5 h-2.5" />
      )}
      {t(`ai.risk.${risk}`)}
    </span>
  );
}
