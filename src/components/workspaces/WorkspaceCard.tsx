import { useMemo, useState } from "react";
import {
  Play,
  Pencil,
  Trash2,
  Copy,
  Radio,
  AlertTriangle,
  Loader2,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  WorkspacePreset,
  PresetLayoutType,
  getLayoutMeta,
} from "../../stores/useWorkspaceStore";
import { useHostStore } from "../../stores/useHostStore";
import { usePingStore } from "../../stores/usePingStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { DistroBadge } from "../hosts/DistroBadge";
import { resolvePresetHosts } from "../../lib/workspaceLayout";

interface WorkspaceCardProps {
  preset: WorkspacePreset;
  onLaunch: (preset: WorkspacePreset) => Promise<void>;
  onEdit: (preset: WorkspacePreset) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, preset: WorkspacePreset) => void;
}

/**
 * Visual Blueprint rendering proportional mini diagrams of split geometry
 */
export function LayoutBlueprint({
  layout,
  nodeLabels,
}: {
  layout: PresetLayoutType;
  nodeLabels: (string | undefined)[];
}) {
  const { t } = useTranslation();
  const paneLabel = (index: number) => t("workspaces.paneDefault", { index });
  const baseBox =
    "flex items-center justify-center rounded border border-[var(--primary)]/30 bg-[var(--surface-container)] text-[10px] font-mono text-[var(--text-secondary)] font-medium truncate p-1 transition-colors group-hover:border-[var(--primary)]/60 group-hover:bg-[var(--surface-high)]";

  switch (layout) {
    case "split-vertical":
      return (
        <div className="grid h-24 w-full grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
          </div>
        </div>
      );

    case "split-horizontal":
      return (
        <div className="grid h-24 w-full grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
          </div>
        </div>
      );

    case "grid-4":
      return (
        <div className="grid h-24 w-full grid-cols-2 grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || paneLabel(3)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[3] || paneLabel(4)}</span>
          </div>
        </div>
      );

    case "split-1-2":
      return (
        <div className="grid h-24 w-full grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
          </div>
          <div className="grid grid-rows-2 gap-1.5">
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
            </div>
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[2] || paneLabel(3)}</span>
            </div>
          </div>
        </div>
      );

    case "split-2-1":
      return (
        <div className="grid h-24 w-full grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
            </div>
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
            </div>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || paneLabel(3)}</span>
          </div>
        </div>
      );

    case "triple-column":
      return (
        <div className="grid h-24 w-full grid-cols-3 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || paneLabel(1)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || paneLabel(2)}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || paneLabel(3)}</span>
          </div>
        </div>
      );

    default: {
      // Unknown layout (synced/imported from another version): equal columns.
      const labels = nodeLabels.length > 0 ? nodeLabels : [undefined];
      return (
        <div
          className="grid h-24 w-full gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5"
          style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
        >
          {labels.map((label, idx) => (
            <div key={idx} className={baseBox}>
              <span className="truncate">{label || paneLabel(idx + 1)}</span>
            </div>
          ))}
        </div>
      );
    }
  }
}

export function WorkspaceCard({
  preset,
  onLaunch,
  onEdit,
  onDuplicate,
  onDelete,
  onContextMenu,
}: WorkspaceCardProps) {
  const { t } = useTranslation();
  const hosts = useHostStore((s) => s.hosts);
  const statusByHostId = usePingStore((s) => s.statusByHostId);
  const confirm = useConfirmStore((s) => s.confirm);
  const [isLaunching, setIsLaunching] = useState(false);

  const layoutMeta = getLayoutMeta(preset.layout);
  // Pane slots with no host or a host deleted since the preset was saved.
  const missingCount = useMemo(
    () => resolvePresetHosts(preset, hosts).missing,
    [preset, hosts]
  );

  // Map nodes to hosts
  const assignedNodes = preset.nodes.map((node) => {
    const host = hosts.find((h) => h.id === node.hostId);
    return {
      paneIndex: node.paneIndex,
      host,
      // Live host label wins; a label saved by older versions is only a
      // fallback so renamed hosts don't show a stale name.
      label: host?.label || node.label || t("workspaces.paneDefault", { index: node.paneIndex + 1 }),
    };
  });

  const nodeLabels = assignedNodes.map((n) => n.label);

  const handleLaunchClick = async () => {
    if (isLaunching) return;
    setIsLaunching(true);
    try {
      await onLaunch(preset);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleDeleteClick = () => {
    confirm({
      title: t("workspaces.deleteConfirm.title"),
      message: t("workspaces.deleteConfirm.message", { name: preset.name }),
      confirmLabel: t("workspaces.deleteConfirm.confirmLabel"),
      isDanger: true,
      onConfirm: () => onDelete(preset.id),
    });
  };

  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, preset)}
      className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] p-4 shadow-sm transition-all hover:border-[var(--primary)]/50 hover:bg-[var(--surface-high)] hover:shadow-md"
    >
      <div>
        {/* Top Header: Title, Layout Badge, Actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
                {preset.name}
              </h3>
              {preset.broadcastOnLaunch && (
                <span
                  title={t("workspaces.broadcastBadgeTitle")}
                  className="flex items-center gap-1 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--primary)] shrink-0"
                >
                  <Radio size={10} className="animate-pulse" />
                  <span>{t("workspaces.broadcastBadge")}</span>
                </span>
              )}
              {missingCount > 0 && (
                <button
                  type="button"
                  onClick={() => onEdit(preset)}
                  title={t("workspaces.missingHostsBadgeTitle", { count: missingCount })}
                  className="flex items-center gap-1 rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--warning)] shrink-0 hover:bg-[var(--warning)]/25 transition-colors cursor-pointer"
                >
                  <AlertTriangle size={10} />
                  <span>{t("workspaces.missingHostsBadge", { count: missingCount })}</span>
                </button>
              )}
            </div>
            {preset.description ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">
                {preset.description}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {t(layoutMeta.labelKey)}
              </p>
            )}
          </div>

          {/* Quick Menu Icons */}
          <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onDuplicate(preset.id)}
              title={t("workspaces.duplicatePresetTooltip")}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <Copy size={13} />
            </button>
            <button
              onClick={() => onEdit(preset)}
              title={t("workspaces.editPresetTooltip")}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleDeleteClick}
              title={t("workspaces.deletePresetTooltip")}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--danger)]/15 hover:text-[var(--danger)] transition-colors cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Blueprint Visual Diagram */}
        <div className="mt-3.5">
          <LayoutBlueprint layout={preset.layout} nodeLabels={nodeLabels} />
        </div>

        {/* Nodes Breakdown List */}
        <div className="mt-3.5 flex flex-col gap-1.5 border-t border-[var(--border)]/60 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("workspaces.clusterNodes", { assigned: assignedNodes.filter((n) => n.host).length, total: layoutMeta.panes })}
          </div>

          <div className="flex flex-col gap-1">
            {assignedNodes.map((node, idx) => {
              const ping = node.host ? statusByHostId[node.host.id] : null;

              return (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg bg-[var(--canvas)]/40 px-2.5 py-1 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--surface-high)] font-mono text-[9px] text-[var(--text-muted)] font-medium">
                      {idx + 1}
                    </span>
                    {node.host ? (
                      <>
                        <DistroBadge host={node.host} size="sm" />
                        <span className="truncate font-medium text-[var(--text-primary)]">
                          {node.label}
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)] italic">
                        <Server size={12} />
                        <span>{t("workspaces.unassignedNode")}</span>
                      </span>
                    )}
                  </div>

                  {ping && (
                    <span
                      className={`font-mono text-[10px] shrink-0 ${
                        ping.online ? "text-[var(--success)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {ping.online ? `${ping.latencyMs ?? 0}ms` : t("workspaces.pingOffline")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Launch Action Button */}
      <div className="mt-4 pt-2 border-t border-[var(--border)]">
        <button
          onClick={handleLaunchClick}
          disabled={isLaunching}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-semibold text-black shadow-sm transition-all hover:bg-[var(--primary)]/90 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
        >
          {isLaunching ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>{t("workspaces.launching")}</span>
            </>
          ) : (
            <>
              <Play size={13} className="fill-current" />
              <span>{t("workspaces.launchCluster")}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
