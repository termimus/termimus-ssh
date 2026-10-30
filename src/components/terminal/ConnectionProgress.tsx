import { useState, useMemo } from "react";
import {
  Server,
  Plug,
  ShieldCheck,
  KeyRound,
  Terminal as TerminalIcon,
  AlertCircle,
  RotateCw,
  Pencil,
  Copy,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Host } from "../../lib/api";
import { useHostStore } from "../../stores/useHostStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useShallow } from "zustand/react/shallow";

export interface ConnectionLog {
  timestamp: string;
  step: number;
  message: string;
  isError: boolean;
}

interface ConnectionProgressProps {
  sessionId: string;
  host?: Host | null;
  logs: ConnectionLog[];
  currentStep: number; // 1 to 5 (5 is ready)
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export function ConnectionProgress({
  host,
  logs,
  currentStep,
  error,
  onRetry,
  onClose,
}: ConnectionProgressProps) {
  const { t } = useTranslation();
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const { openEditModal } = useHostStore();
  const { closeSession, activeTabId } = useSessionStore(
    useShallow((s) => ({ closeSession: s.closeSession, activeTabId: s.activeTabId }))
  );

  const isFailed = Boolean(error);

  // Pick OS / distro badge or stylish server badge based on label or address
  const osType = useMemo(() => {
    const text = `${host?.label || ""} ${host?.tags.join(" ") || ""}`.toLowerCase();
    if (text.includes("debian")) return "debian";
    if (text.includes("ubuntu")) return "ubuntu";
    if (text.includes("alpine")) return "alpine";
    if (text.includes("centos") || text.includes("rhel") || text.includes("rocky"))
      return "redhat";
    return "linux";
  }, [host]);

  async function handleCopyLog() {
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.isError ? "ERROR: " : ""}${l.message}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || error || "No logs available");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  // Calculate progress percentage:
  // Step 1: 15% (connecting)
  // Step 2: 45% (host key)
  // Step 3: 75% (authenticating)
  // Step 4: 92% (opening pty/shell)
  // Step 5: 100% (ready)
  const progressPercent = useMemo(() => {
    if (isFailed) return 50;
    switch (currentStep) {
      case 1:
        return 15;
      case 2:
        return 45;
      case 3:
        return 75;
      case 4:
        return 92;
      case 5:
        return 100;
      default:
        return 15;
    }
  }, [currentStep, isFailed]);

  const stages = [
    { step: 1, label: t("terminal.progress.stages.socket"), icon: Plug },
    { step: 2, label: t("terminal.progress.stages.hostKey"), icon: ShieldCheck },
    { step: 3, label: t("terminal.progress.stages.auth"), icon: KeyRound },
    { step: 4, label: t("terminal.progress.stages.shell"), icon: TerminalIcon },
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0d1117] p-6 text-[var(--text-primary)] select-none">
      {/* Centered Termius-style Card Container */}
      <div className="w-full max-w-md space-y-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Top Header: Badge, Host details, Show Logs Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* OS / Server Badge */}
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg transition-transform duration-300 ${
                osType === "debian"
                  ? "bg-[#d70a53] text-white shadow-[#d70a53]/20"
                  : osType === "ubuntu"
                  ? "bg-[#e95420] text-white shadow-[#e95420]/20"
                  : osType === "alpine"
                  ? "bg-[#0d597f] text-white shadow-[#0d597f]/20"
                  : "bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/30"
              }`}
            >
              {osType === "debian" ? (
                // Debian swirl glyph
                <svg viewBox="0 0 100 100" className="h-7 w-7 fill-current">
                  <path d="M50 15c-18 0-33 13-35 31-2 15 6 29 20 35 15 6 32 1 40-12 9-14 4-33-9-42-12-8-29-5-38 6-7 9-5 22 4 29 8 5 18 3 24-4 4-5 3-12-2-16-4-3-10-2-13 2" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
                </svg>
              ) : (
                <Server size={24} />
              )}
            </div>

            {/* Host Name & Address */}
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-white">
                {host?.label || "Remote Server"}
              </h2>
              <p className="truncate font-mono text-xs text-[var(--text-muted)]">
                SSH {host?.address || "server"}:{host?.port || 22}
              </p>
            </div>
          </div>

          {/* Show Logs Toggle Button */}
          <button
            type="button"
            onClick={() => setShowLogs((prev) => !prev)}
            className="rounded-xl border border-[var(--border)] bg-[#21262d] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#30363d] shadow-sm cursor-pointer"
          >
            {showLogs || isFailed ? t("terminal.progress.hideLogs") : t("terminal.progress.showLogs")}
          </button>
        </div>

        {/* Process Tree: Horizontal Connecting Line & Stage Nodes (Termius-style) */}
        <div className="relative py-2">
          {/* Background Track */}
          <div className="absolute left-4 right-4 top-5 h-[3px] rounded-full bg-[#21262d]" />

          {/* Active Progress Fill */}
          <div
            className={`absolute left-4 top-5 h-[3px] rounded-full transition-all duration-500 ${
              isFailed ? "bg-[var(--danger)]" : "bg-[#38bdf8]"
            }`}
            style={{ width: `calc(${progressPercent}% - 20px)` }}
          />

          {/* Stage Nodes */}
          <div className="relative flex items-center justify-between">
            {stages.map((st) => {
              const Icon = st.icon;
              const isCompleted = currentStep > st.step || currentStep >= 5;
              const isActive = currentStep === st.step && !isFailed;
              const isCurrentFailed = isFailed && (currentStep === st.step || (currentStep < st.step && st.step === 1));

              return (
                <div key={st.step} className="flex flex-col items-center">
                  <div
                    className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 shadow-md ${
                      isCurrentFailed
                        ? "bg-[var(--danger)] text-white ring-4 ring-[var(--danger)]/25"
                        : isCompleted
                        ? "bg-[var(--primary)] text-black ring-4 ring-[var(--primary)]/20"
                        : isActive
                        ? "bg-[#38bdf8] text-white ring-4 ring-[#38bdf8]/30 shadow-[#38bdf8]/30"
                        : "bg-[#161b22] text-[var(--text-muted)] border border-[#30363d]"
                    }`}
                  >
                    {isCurrentFailed ? (
                      <AlertCircle size={16} />
                    ) : isCompleted ? (
                      <Check size={16} className="stroke-[2.5]" />
                    ) : isActive ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-white" />
                        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#38bdf8] opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#38bdf8]" />
                        </span>
                      </>
                    ) : (
                      <Icon size={15} />
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-mono mt-1.5 transition-colors ${
                      isActive
                        ? "text-[#38bdf8] font-semibold"
                        : isCompleted
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current status line with animated indicator */}
        <div className="flex items-center justify-center gap-2.5 min-h-[32px] px-3.5 py-1.5 rounded-xl bg-[#161b22]/70 border border-[#30363d]/60 text-center">
          {!isFailed ? (
            <Loader2 size={13} className="animate-spin text-[#38bdf8] shrink-0" />
          ) : (
            <AlertCircle size={13} className="text-[var(--danger)] shrink-0" />
          )}
          <p
            className={`text-xs font-mono truncate transition-colors ${
              isFailed ? "text-[var(--danger)] font-semibold" : "text-[var(--text-secondary)]"
            }`}
          >
            {isFailed
              ? error
              : logs.length > 0
              ? logs[logs.length - 1].message
              : t("terminal.connecting", { host: host?.address || "server" })}
          </p>
        </div>

        {/* Logs Console in the Center (Auto-shown on failure or when user toggles 'Show logs') */}
        {(showLogs || isFailed) && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t("terminal.progress.connectionLog")}
              </span>
              <button
                onClick={handleCopyLog}
                className="flex items-center gap-1 rounded bg-[#21262d] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-white border border-[var(--border)] transition cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check size={11} className="text-[var(--success)]" /> {t("terminal.progress.copied")}
                  </>
                ) : (
                  <>
                    <Copy size={11} /> {t("terminal.progress.copyLog")}
                  </>
                )}
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-[#05070a] p-3 font-mono text-[11px] leading-relaxed shadow-inner">
              {logs.length === 0 ? (
                <p className="text-[var(--text-muted)]">{t("terminal.progress.noLogs")}</p>
              ) : (
                logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 ${
                      log.isError
                        ? "text-[var(--danger)] font-semibold"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="shrink-0 text-[var(--text-muted)]/60">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="break-all">{log.message}</span>
                  </div>
                ))
              )}
              {isFailed && !logs.some((l) => l.message === error) && (
                <div className="flex items-start gap-2 text-[var(--danger)] font-semibold pt-1">
                  <span className="shrink-0 text-[var(--danger)]/60">
                    {new Date().toLocaleTimeString()}
                  </span>
                  <span className="break-all">{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons on Failure */}
        {isFailed && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] shadow-md cursor-pointer"
            >
              <RotateCw size={13} /> {t("terminal.progress.retry")}
            </button>

            {host && (
              <button
                onClick={() => openEditModal(host)}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[#21262d] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#30363d] cursor-pointer"
              >
                <Pencil size={13} /> {t("terminal.progress.editHost")}
              </button>
            )}

            <button
              onClick={() => {
                if (activeTabId) closeSession(activeTabId);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[#21262d] px-3.5 py-2 text-xs font-medium text-[var(--text-muted)] transition hover:text-white cursor-pointer"
            >
              <X size={13} /> {t("terminal.progress.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
