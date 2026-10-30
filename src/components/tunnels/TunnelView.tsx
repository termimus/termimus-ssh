import { useEffect, useState, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  Plus,
  Play,
  Square,
  Pencil,
  Trash2,
  Server,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useHostStore } from "../../stores/useHostStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { TunnelModal } from "./TunnelModal";
import { PortForwardRule, Host } from "../../lib/api";

export function TunnelView() {
  const { t } = useTranslation();
  const {
    rules,
    activeRuleIds,
    isLoading,
    error,
    startingRuleId,
    refresh,
    toggleTunnel,
    openCreateModal,
    openEditModal,
    deleteRule,
  } = useTunnelStore();

  const { hosts } = useHostStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "rule" | "background";
    rule?: PortForwardRule;
  } | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  }, []);

  const handleRuleContextMenu = useCallback((e: React.MouseEvent, rule: PortForwardRule) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 280);
    setContextMenu({ x, y, type: "rule", rule });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 150);
    setContextMenu({ x, y, type: "background" });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (rules.length === 0) {
      refresh();
    }
  }, [rules.length, refresh]);

  const handleDelete = useCallback(
    (ruleId: string, ruleLabel?: string) => {
      useConfirmStore.getState().confirm({
        title: t("tunnels.deleteConfirm.title"),
        message: t("tunnels.deleteConfirm.message", { label: ruleLabel || "this tunnel rule" }),
        confirmLabel: t("tunnels.deleteConfirm.confirmLabel"),
        isDanger: true,
        onConfirm: async () => {
          await deleteRule(ruleId);
        },
      });
    },
    [deleteRule, t]
  );

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-4 select-none"
    >
      <TunnelModal />

      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-[var(--accent)]" />
            {t("tunnels.title")}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("tunnels.subtitle")}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)]"
        >
          <Plus size={14} /> {t("tunnels.newRule")}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Rules List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && rules.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin mr-2 text-[var(--accent)]" />
            {t("tunnels.loading")}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center text-center text-[var(--text-muted)]">
            <ArrowLeftRight size={38} className="mb-2 opacity-30" />
            <p className="text-sm font-medium">{t("tunnels.emptyTitle")}</p>
            <p className="text-xs mt-1 max-w-sm">
              {t("tunnels.emptyDesc")}
            </p>
            <button
              onClick={openCreateModal}
              className="mt-4 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--border)] cursor-pointer"
            >
              {t("tunnels.addFirstRule")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {rules.map((rule) => {
              const host = hosts.find((h) => h.id === rule.host_id);
              const isActive = activeRuleIds.has(rule.id);
              const isBusy = startingRuleId === rule.id;

              return (
                <TunnelCard
                  key={rule.id}
                  rule={rule}
                  host={host}
                  isActive={isActive}
                  isBusy={isBusy}
                  onToggle={toggleTunnel}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                  onContextMenu={handleRuleContextMenu}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "rule" && contextMenu.rule ? (
            <>
              {/* Start/Stop Tunnel */}
              <button
                onClick={() => {
                  toggleTunnel(contextMenu.rule!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
              >
                {activeRuleIds.has(contextMenu.rule.id) ? (
                  <>
                    <Square size={13} />
                    <span>{t("tunnels.stopTunnel")}</span>
                  </>
                ) : (
                  <>
                    <Play size={13} />
                    <span>{t("tunnels.startTunnel")}</span>
                  </>
                )}
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Copy Local Address */}
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `${contextMenu.rule!.local_address}:${contextMenu.rule!.local_port}`
                  );
                  showCopyToast(t("tunnels.copiedLocalAddress"));
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <Copy size={13} />
                <span>{t("tunnels.copyLocalAddress")}</span>
              </button>

              {/* Copy Remote Address */}
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `${contextMenu.rule!.remote_address}:${contextMenu.rule!.remote_port}`
                  );
                  showCopyToast(t("tunnels.copiedRemoteAddress"));
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <Copy size={13} />
                <span>{t("tunnels.copyRemoteAddress")}</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Edit */}
              <button
                onClick={() => {
                  openEditModal(contextMenu.rule!);
                  setContextMenu(null);
                }}
                disabled={activeRuleIds.has(contextMenu.rule.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                <Pencil size={13} />
                <span>{t("tunnels.editRule")}</span>
              </button>

              {/* Delete */}
              <button
                onClick={() => {
                  handleDelete(contextMenu.rule!.id, contextMenu.rule!.label);
                  setContextMenu(null);
                }}
                disabled={activeRuleIds.has(contextMenu.rule.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                <Trash2 size={13} />
                <span>{t("tunnels.deleteRule")}</span>
              </button>
            </>
          ) : (
            <>
              {/* New Rule */}
              <button
                onClick={() => {
                  openCreateModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
              >
                <Plus size={13} />
                <span>{t("tunnels.newPortForwardRule")}</span>
              </button>

              <button
                onClick={() => {
                  refresh();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>{t("tunnels.refreshRules")}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Copy Toast Notification */}
      {copyToast && (
        <div className="fixed top-11 right-3.5 z-50 flex items-center gap-2 rounded-lg border border-[var(--primary)]/40 bg-[var(--surface-high)]/95 px-3 py-1.5 text-xs font-mono font-medium text-[var(--primary)] shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none">
          <Check size={13} className="text-[var(--primary)] shrink-0" />
          <span>{copyToast}</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED TUNNEL CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface TunnelCardProps {
  rule: PortForwardRule;
  host: Host | undefined;
  isActive: boolean;
  isBusy: boolean;
  onToggle: (rule: PortForwardRule) => void;
  onEdit: (rule: PortForwardRule) => void;
  onDelete: (id: string, label?: string) => void;
  onContextMenu?: (e: React.MouseEvent, rule: PortForwardRule) => void;
}

const TunnelCard = memo(function TunnelCard({
  rule,
  host,
  isActive,
  isBusy,
  onToggle,
  onEdit,
  onDelete,
  onContextMenu,
}: TunnelCardProps) {
  const { t } = useTranslation();
  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, rule)}
      className={`flex flex-col rounded-xl border p-4 transition-colors shadow-xs ${
        isActive
          ? "border-[var(--success)]/40 bg-[var(--success)]/5 shadow-md shadow-[var(--success)]/5"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border)]/80"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              isActive
                ? "bg-[var(--success)] animate-pulse"
                : "bg-[var(--text-muted)]/40"
            }`}
          />
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {rule.label}
          </h3>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onEdit(rule)}
            disabled={isActive}
            title={t("tunnels.editRule")}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white disabled:opacity-30 cursor-pointer"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(rule.id, rule.label)}
            disabled={isActive}
            title={t("tunnels.deleteRule")}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] disabled:opacity-30 transition cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Endpoint Routing Diagram */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs mb-3 space-y-1 font-mono">
        <div className="flex items-center justify-between text-[var(--text-muted)]">
          <span>{t("tunnels.localLabel")}</span>
          <span className="text-[var(--accent)] font-semibold">
            {rule.local_address}:{rule.local_port}
          </span>
        </div>
        <div className="flex items-center justify-between text-[var(--text-muted)]">
          <span>{t("tunnels.targetLabel")}</span>
          <span className="text-[var(--text-primary)]">
            {rule.remote_address}:{rule.remote_port}
          </span>
        </div>
      </div>

      {/* Via Host */}
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)] mb-4">
        <Server size={12} className="shrink-0" />
        <span className="truncate">
          {t("tunnels.viaHost", { host: host ? host.label : t("tunnels.unknownHost") })}
        </span>
      </div>

      {/* Toggle Button */}
      <div className="mt-auto pt-2 border-t border-[var(--border)]/50">
        <button
          onClick={() => onToggle(rule)}
          disabled={isBusy}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
            isActive
              ? "bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25"
              : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
          } disabled:opacity-50`}
        >
          {isBusy ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>{isActive ? t("tunnels.stopping") : t("tunnels.starting")}</span>
            </>
          ) : isActive ? (
            <>
              <Square size={13} />
              <span>{t("tunnels.stopTunnel")}</span>
            </>
          ) : (
            <>
              <Play size={13} />
              <span>{t("tunnels.startTunnel")}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
