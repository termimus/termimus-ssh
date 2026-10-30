import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  FolderOpen,
  Waypoints,
  Pencil,
  Trash2,
  CopyPlus,
  MoreVertical,
} from "lucide-react";
import { Host } from "../../lib/api";
import { DistroBadge } from "./DistroBadge";

export interface HostListRowProps {
  host: Host;
  isConnecting?: boolean;
  isOnline: boolean;
  latencyMs?: number | null;
  isMenuOpen: boolean;
  onConnect: (host: Host) => void;
  onToggleMenu: (hostId: string) => void;
  onSftp: (e: React.MouseEvent, host: Host) => void;
  onTunnels: () => void;
  onEdit: (host: Host) => void;
  onDuplicate: (host: Host) => void;
  onDelete: (e: React.MouseEvent, host: Host) => void;
  onContextMenu?: (e: React.MouseEvent, host: Host) => void;
}

export const HostListRow = memo(function HostListRow({
  host,
  isConnecting,
  isOnline,
  latencyMs,
  isMenuOpen,
  onConnect,
  onToggleMenu,
  onSftp,
  onTunnels,
  onEdit,
  onDuplicate,
  onDelete,
  onContextMenu,
}: HostListRowProps) {
  const { t } = useTranslation();
  return (
    <div
      onClick={() => onConnect(host)}
      onContextMenu={(e) => onContextMenu?.(e, host)}
      className="group flex items-center gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3.5 py-2 hover:border-[var(--primary)]/60 hover:bg-[var(--surface-high)]/60 transition-all cursor-pointer select-none shadow-xs"
    >
      {/* 1. OS Distro Icon with minimal top-left status dot */}
      <div className="relative shrink-0">
        <DistroBadge host={host} size="sm" />

        {isConnecting ? (
          <span
            className="absolute top-1 left-1 z-10 flex h-2 w-2 items-center justify-center rounded-full bg-[var(--primary)]"
            title={t("hosts.connecting")}
          >
            <span className="h-1 w-1 rounded-full bg-black animate-ping" />
          </span>
        ) : !isOnline ? (
          <span
            className="absolute top-1 left-1 z-10 h-1.5 w-1.5 rounded-full bg-rose-500"
            title={t("hosts.offline")}
          />
        ) : latencyMs !== undefined && latencyMs !== null ? (
          <span
            className={`absolute top-1 left-1 z-10 h-1.5 w-1.5 rounded-full ${
              latencyMs < 80
                ? "bg-emerald-400"
                : latencyMs < 200
                ? "bg-amber-400"
                : "bg-rose-400"
            }`}
            title={`${t("hosts.online")} · ${latencyMs}ms`}
          />
        ) : (
          <span
            className="absolute top-1 left-1 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400"
            title={t("hosts.online")}
          />
        )}
      </div>

      {/* 2. Column: Host Label / Name */}
      <div className="w-48 sm:w-56 md:w-64 shrink-0 min-w-0 flex items-center gap-1.5">
        <span className="truncate text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
          {host.label}
        </span>
        {host.jump_host_id && (
          <span
            className="shrink-0 px-1 py-0.2 rounded text-[9px] font-mono font-medium bg-[var(--surface-high)] text-[var(--text-muted)] border border-[var(--border)]"
            title={t("hosts.viaJump")}
          >
            jump
          </span>
        )}
      </div>

      {/* 3. Column: Address (IP & Port) */}
      <div className="w-40 sm:w-48 md:w-52 shrink-0 min-w-0">
        <span className="block truncate font-mono text-[11px] text-[var(--text-muted)]">
          {host.address}:{host.port}
        </span>
      </div>

      {/* 4. Column: Username */}
      <div className="hidden sm:block w-24 md:w-32 shrink-0 min-w-0">
        <span className="block truncate font-mono text-[11px] text-[var(--text-secondary)]">
          {host.username}
        </span>
      </div>

      {/* 5. Column: Tags (flexible fill) */}
      <div className="hidden lg:flex flex-1 min-w-0 items-center gap-1 overflow-hidden">
        {host.tags && host.tags.length > 0 ? (
          <>
            {host.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[var(--surface-high)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)] border border-[var(--border)] truncate"
              >
                {tag}
              </span>
            ))}
            {host.tags.length > 3 && (
              <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                +{host.tags.length - 3}
              </span>
            )}
          </>
        ) : null}
      </div>

      {/* 6. Column: Quick Action buttons + 3-dots menu */}
      <div className="flex items-center gap-1 shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
        {/* Quick action: SFTP */}
        <button
          onClick={(e) => onSftp(e, host)}
          title={t("hosts.sftp")}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-high)] hover:text-white transition cursor-pointer"
        >
          <FolderOpen size={13} />
        </button>

        {/* Options 3-dots */}
        <div className="relative shrink-0">
          <button
            onClick={() => onToggleMenu(host.id)}
            title={t("hosts.options")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-high)] hover:text-white transition cursor-pointer"
          >
            <MoreVertical size={14} />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs">
              <button
                onClick={() => {
                  onToggleMenu(host.id);
                  onConnect(host);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition cursor-pointer"
              >
                <Terminal size={13} />
                <span>{t("hosts.connectSsh")}</span>
              </button>

              <button
                onClick={(e) => {
                  onToggleMenu(host.id);
                  onSftp(e, host);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition cursor-pointer"
              >
                <FolderOpen size={13} />
                <span>{t("hosts.sftpFiles")}</span>
              </button>

              <button
                onClick={() => {
                  onToggleMenu(host.id);
                  onTunnels();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition cursor-pointer"
              >
                <Waypoints size={13} />
                <span>{t("hosts.tunnels")}</span>
              </button>

              <div className="my-1 border-t border-[var(--border)]" />

              <button
                onClick={() => {
                  onToggleMenu(host.id);
                  onDuplicate(host);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition cursor-pointer"
              >
                <CopyPlus size={13} />
                <span>{t("common.duplicate")}</span>
              </button>

              <button
                onClick={() => {
                  onToggleMenu(host.id);
                  onEdit(host);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition cursor-pointer"
              >
                <Pencil size={13} />
                <span>{t("hosts.editHost")}</span>
              </button>

              <div className="my-1 border-t border-[var(--border)]" />

              <button
                onClick={(e) => {
                  onToggleMenu(host.id);
                  onDelete(e, host);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition"
              >
                <Trash2 size={13} />
                <span>{t("common.delete")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
