import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ArrowRight,
  Plus,
  Play,
  Square,
  Pencil,
  Trash2,
  Server,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
  Globe,
  Search,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useHostStore } from "../../stores/useHostStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { TunnelModal } from "./TunnelModal";
import { PortForwardRule, Host } from "../../lib/api";
import { copyText } from "../../lib/clipboard";

type Toast = { kind: "success" | "error"; message: string };

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer";

/** Where the tunnel listens and where it forwards to, per forward type. */
function describeRule(rule: PortForwardRule) {
  const local = `${rule.local_address}:${rule.local_port}`;
  const remote = `${rule.remote_address}:${rule.remote_port}`;
  // -R rules listen on the server (remote_*) and dial local_* from this machine.
  if (rule.forward_type === "remote") return { listen: remote, target: local };
  return { listen: local, target: rule.forward_type === "dynamic" ? null : remote };
}

export function TunnelView() {
  const { t } = useTranslation();
  const {
    rules,
    activeRuleIds,
    busyRuleIds,
    isLoading,
    error,
    refresh,
    toggleTunnel,
    openCreateModal,
    openEditModal,
    deleteRule,
    clearError,
  } = useTunnelStore(
    useShallow((s) => ({
      rules: s.rules,
      activeRuleIds: s.activeRuleIds,
      busyRuleIds: s.busyRuleIds,
      isLoading: s.isLoading,
      error: s.error,
      refresh: s.refresh,
      toggleTunnel: s.toggleTunnel,
      openCreateModal: s.openCreateModal,
      openEditModal: s.openEditModal,
      deleteRule: s.deleteRule,
      clearError: s.clearError,
    }))
  );
  const hosts = useHostStore((s) => s.hosts);

  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "rule" | "background";
    rule?: PortForwardRule;
  } | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), next.kind === "error" ? 4000 : 1800);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
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

  const hostsById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

  const query = searchQuery.trim().toLowerCase();
  const filteredRules = useMemo(() => {
    if (!query) return rules;
    return rules.filter((rule) => {
      const host = hostsById.get(rule.host_id);
      return [
        rule.label,
        host?.label ?? "",
        `${rule.local_address}:${rule.local_port}`,
        `${rule.remote_address}:${rule.remote_port}`,
      ].some((field) => field.toLowerCase().includes(query));
    });
  }, [rules, hostsById, query]);

  const activeCount = rules.filter((r) => activeRuleIds.has(r.id)).length;

  const handleCopy = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await copyText(text);
        showToast({ kind: "success", message: successMessage });
      } catch (err) {
        showToast({ kind: "error", message: t("tunnels.copyFailed", { error: String(err) }) });
      }
    },
    [showToast, t]
  );

  const handleCopyListen = useCallback(
    (rule: PortForwardRule) => {
      const message =
        rule.forward_type === "dynamic"
          ? t("tunnels.copiedSocks5Address")
          : rule.forward_type === "remote"
            ? t("tunnels.copiedRemoteAddress")
            : t("tunnels.copiedLocalAddress");
      handleCopy(describeRule(rule).listen, message);
    },
    [handleCopy, t]
  );

  const handleDelete = useCallback(
    (rule: PortForwardRule) => {
      useConfirmStore.getState().confirm({
        title: t("tunnels.deleteConfirm.title"),
        message: t("tunnels.deleteConfirm.message", { label: rule.label }),
        confirmLabel: t("tunnels.deleteConfirm.confirmLabel"),
        isDanger: true,
        onConfirm: async () => {
          try {
            await deleteRule(rule.id);
          } catch (err) {
            showToast({
              kind: "error",
              message: t("tunnels.deleteFailed", { label: rule.label, error: String(err) }),
            });
          }
        },
      });
    },
    [deleteRule, showToast, t]
  );

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-4 text-[var(--text-primary)] select-none"
    >
      <TunnelModal />

      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-[var(--accent)]" />
            {t("tunnels.title")}
            {rules.length > 0 && (
              <span className="rounded-md bg-[var(--surface-container)] px-1.5 py-0.5 text-[10px] font-mono font-normal text-[var(--text-muted)]">
                {rules.length}
              </span>
            )}
            {activeCount > 0 && (
              <span className="flex items-center gap-1 rounded-md bg-[var(--success)]/15 px-1.5 py-0.5 text-[10px] font-mono font-normal text-[var(--success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {t("tunnels.activeCount", { count: activeCount })}
              </span>
            )}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {t("tunnels.subtitle")}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)] cursor-pointer"
        >
          <Plus size={14} /> {t("tunnels.newRule")}
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("tunnels.searchPlaceholder")}
          aria-label={t("tunnels.searchPlaceholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => refresh()}
              className="shrink-0 rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 font-medium hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              {t("common.retry")}
            </button>
            <button
              onClick={clearError}
              aria-label={t("common.close")}
              className="shrink-0 rounded p-0.5 hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {isLoading && rules.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-16 text-xs text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("tunnels.loading")}</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--primary)] shadow-sm">
              <ArrowLeftRight size={26} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("tunnels.emptyTitle")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("tunnels.emptyDesc")}
            </p>
            <button
              onClick={openCreateModal}
              className="mt-6 flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] shadow-md hover:bg-[var(--primary-hover)] transition-colors cursor-pointer"
            >
              <Plus size={14} />
              {t("tunnels.addFirstRule")}
            </button>
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <Search size={26} className="mb-3 text-[var(--text-muted)] opacity-60" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("tunnels.emptySearchTitle", { query: searchQuery.trim() })}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("tunnels.emptySearchDesc")}
            </p>
          </div>
        ) : (
          // auto-fill: wide windows get more columns instead of stretching each card
          <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]">
            {filteredRules.map((rule) => (
              <TunnelCard
                key={rule.id}
                rule={rule}
                host={hostsById.get(rule.host_id)}
                isActive={activeRuleIds.has(rule.id)}
                isBusy={busyRuleIds.has(rule.id)}
                onToggle={toggleTunnel}
                onCopy={handleCopyListen}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onContextMenu={handleRuleContextMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "rule" && contextMenu.rule ? (
            (() => {
              const rule = contextMenu.rule;
              const isActive = activeRuleIds.has(rule.id);
              const hostMissing = !hostsById.has(rule.host_id);
              const close = () => setContextMenu(null);
              const local = `${rule.local_address}:${rule.local_port}`;
              const remote = `${rule.remote_address}:${rule.remote_port}`;
              return (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      toggleTunnel(rule);
                      close();
                    }}
                    disabled={busyRuleIds.has(rule.id) || (!isActive && hostMissing)}
                    className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black disabled:opacity-40 disabled:pointer-events-none`}
                  >
                    {isActive ? <Square size={13} /> : <Play size={13} />}
                    <span>{isActive ? t("tunnels.stopTunnel") : t("tunnels.startTunnel")}</span>
                  </button>

                  <div className="my-1 h-[1px] bg-[var(--border)]" />

                  {rule.forward_type === "dynamic" ? (
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleCopy(local, t("tunnels.copiedSocks5Address"));
                        close();
                      }}
                      className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                    >
                      <Copy size={13} />
                      <span>{t("tunnels.copySocks5Address")}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => {
                          handleCopy(local, t("tunnels.copiedLocalAddress"));
                          close();
                        }}
                        className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                      >
                        <Copy size={13} />
                        <span>{t("tunnels.copyLocalAddress")}</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          handleCopy(remote, t("tunnels.copiedRemoteAddress"));
                          close();
                        }}
                        className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                      >
                        <Copy size={13} />
                        <span>{t("tunnels.copyRemoteAddress")}</span>
                      </button>
                    </>
                  )}

                  <div className="my-1 h-[1px] bg-[var(--border)]" />

                  <button
                    role="menuitem"
                    onClick={() => {
                      openEditModal(rule);
                      close();
                    }}
                    disabled={isActive}
                    className={`${MENU_ITEM} hover:bg-[var(--surface-container)] disabled:opacity-40 disabled:pointer-events-none`}
                  >
                    <Pencil size={13} />
                    <span>{t("tunnels.editRule")}</span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      handleDelete(rule);
                      close();
                    }}
                    disabled={isActive}
                    className={`${MENU_ITEM} hover:bg-[var(--danger)] hover:text-white disabled:opacity-40 disabled:pointer-events-none`}
                  >
                    <Trash2 size={13} />
                    <span>{t("tunnels.deleteRule")}</span>
                  </button>
                </>
              );
            })()
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  openCreateModal();
                  setContextMenu(null);
                }}
                className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black`}
              >
                <Plus size={13} />
                <span>{t("tunnels.newPortForwardRule")}</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  refresh();
                  setContextMenu(null);
                }}
                className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
              >
                <RefreshCw size={13} />
                <span>{t("tunnels.refreshRules")}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          className={`fixed top-11 right-3.5 z-50 flex max-w-sm items-center gap-2 rounded-lg border bg-[var(--surface-high)]/95 px-3 py-1.5 text-xs font-medium shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none ${
            toast.kind === "error"
              ? "border-[var(--danger)]/40 text-[var(--danger)]"
              : "border-[var(--primary)]/40 font-mono text-[var(--primary)]"
          }`}
        >
          {toast.kind === "error" ? (
            <AlertTriangle size={13} className="shrink-0" />
          ) : (
            <Check size={13} className="shrink-0" />
          )}
          <span>{toast.message}</span>
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
  onCopy: (rule: PortForwardRule) => void;
  onEdit: (rule: PortForwardRule) => void;
  onDelete: (rule: PortForwardRule) => void;
  onContextMenu?: (e: React.MouseEvent, rule: PortForwardRule) => void;
}

const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30";

// Palette tokens per forward type (no hardcoded hex/Tailwind colors).
const TYPE_BADGE: Record<string, { color: string; key: string }> = {
  local: { color: "var(--secondary)", key: "tunnels.badgeLocal" },
  remote: { color: "var(--warning)", key: "tunnels.badgeRemote" },
  dynamic: { color: "var(--tertiary)", key: "tunnels.badgeDynamic" },
};

const TunnelCard = memo(function TunnelCard({
  rule,
  host,
  isActive,
  isBusy,
  onToggle,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: TunnelCardProps) {
  const { t } = useTranslation();
  const { listen, target } = describeRule(rule);
  const badge = TYPE_BADGE[rule.forward_type] ?? TYPE_BADGE.local;
  const hostMissing = !host;
  const lockedTitle = isActive ? t("tunnels.stopToEdit") : undefined;

  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, rule)}
      className={`group flex flex-col rounded-xl border bg-[var(--card)] p-3 transition-colors ${
        isActive
          ? "border-[var(--success)]/40"
          : "border-[var(--border)] hover:border-[var(--primary)]/40"
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isActive ? "bg-[var(--success)] animate-pulse" : "bg-[var(--text-muted)]/40"
              }`}
            />
            <h3
              className="truncate text-sm font-semibold text-[var(--text-primary)]"
              title={rule.label}
            >
              {rule.label}
            </h3>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono"
              style={{
                color: badge.color,
                backgroundColor: `color-mix(in srgb, ${badge.color} 15%, transparent)`,
              }}
            >
              {t(badge.key)}
            </span>
          </div>

          {/* Subtitle: SSH host the tunnel rides on */}
          {hostMissing ? (
            <p
              className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[var(--warning)]"
              title={t("tunnels.hostMissing")}
            >
              <AlertTriangle size={11} className="shrink-0" />
              <span className="truncate">{t("tunnels.unknownHost")}</span>
            </p>
          ) : (
            <p
              className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[var(--text-muted)]"
              title={`${host.username}@${host.address}:${host.port}`}
            >
              <Server size={11} className="shrink-0" />
              <span className="truncate">{t("tunnels.viaHost", { host: host.label })}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => onCopy(rule)}
            title={
              rule.forward_type === "dynamic"
                ? t("tunnels.copySocks5Address")
                : rule.forward_type === "remote"
                  ? t("tunnels.copyRemoteAddress")
                  : t("tunnels.copyLocalAddress")
            }
            className={`${ICON_BUTTON} hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]`}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => onEdit(rule)}
            disabled={isActive}
            title={lockedTitle ?? t("tunnels.editRule")}
            className={`${ICON_BUTTON} enabled:hover:bg-[var(--surface-high)] enabled:hover:text-[var(--text-primary)]`}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(rule)}
            disabled={isActive}
            title={lockedTitle ?? t("tunnels.deleteRule")}
            className={`${ICON_BUTTON} enabled:hover:bg-[var(--danger)]/15 enabled:hover:text-[var(--danger)]`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Route: listen → target */}
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 font-mono text-[11px]">
        <span className="min-w-0 truncate text-[var(--primary)]" title={listen}>
          {listen}
        </span>
        <ArrowRight size={11} className="shrink-0 text-[var(--text-muted)]" />
        {target ? (
          <span className="min-w-0 truncate text-[var(--text-secondary)]" title={target}>
            {target}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1 truncate font-sans text-[var(--text-secondary)]">
            <Globe size={11} className="shrink-0" />
            <span className="truncate">{t("tunnels.dynamicTarget")}</span>
          </span>
        )}
      </div>

      {/* Footer: status + start/stop — mt-auto keeps it aligned across a row */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span
          className={`text-[11px] font-mono ${
            isActive ? "text-[var(--success)]" : "text-[var(--text-muted)]"
          }`}
        >
          {isActive ? t("tunnels.active") : t("tunnels.stopped")}
        </span>

        <button
          onClick={() => onToggle(rule)}
          disabled={isBusy || (!isActive && hostMissing)}
          title={!isActive && hostMissing ? t("tunnels.hostMissing") : undefined}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
            isActive
              ? "border-[var(--danger)]/40 text-[var(--danger)] enabled:hover:bg-[var(--danger)]/15"
              : "border-[var(--primary)]/40 text-[var(--primary)] enabled:group-hover:border-[var(--primary)] enabled:group-hover:bg-[var(--primary)] enabled:group-hover:text-black enabled:hover:bg-[var(--primary)]/90"
          }`}
        >
          {isBusy ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {isActive ? t("tunnels.stopping") : t("tunnels.starting")}
            </>
          ) : isActive ? (
            <>
              <Square size={11} className="fill-current" />
              {t("tunnels.stop")}
            </>
          ) : (
            <>
              <Play size={12} className="fill-current" />
              {t("tunnels.start")}
            </>
          )}
        </button>
      </div>
    </div>
  );
});
