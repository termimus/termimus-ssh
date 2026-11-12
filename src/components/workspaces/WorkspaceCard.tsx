import { useMemo } from "react";
import { Play, Pencil, Trash2, Copy, Radio, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  WorkspacePreset,
  PresetLayoutType,
  getLayoutMeta,
  getPaneCountForLayout,
} from "../../stores/useWorkspaceStore";
import { useHostStore } from "../../stores/useHostStore";
import { usePingStore } from "../../stores/usePingStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { isKnownPresetLayout, resolvePresetHosts } from "../../lib/workspaceLayout";

interface WorkspaceCardProps {
  preset: WorkspacePreset;
  onLaunch: (preset: WorkspacePreset) => void;
  onEdit: (preset: WorkspacePreset) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, preset: WorkspacePreset) => void;
}

export interface BlueprintPane {
  label?: string;
  /** Tooltip, e.g. full host label + user@address */
  title?: string;
  /** "missing" = no host or a deleted host; undefined = no ping data (no dot) */
  status?: "online" | "offline" | "missing";
}

/**
 * Visual Blueprint rendering proportional mini diagrams of split geometry
 */
export function LayoutBlueprint({
  layout,
  panes,
}: {
  layout: PresetLayoutType;
  panes: BlueprintPane[];
}) {
  const { t } = useTranslation();

  const cell = (idx: number) => {
    const pane = panes[idx];
    const label = pane?.label || t("workspaces.paneDefault", { index: idx + 1 });
    const status = pane?.status;
    const isMissing = status === "missing";

    return (
      <div
        key={idx}
        title={pane?.title || label}
        className={`flex min-w-0 items-center gap-1.5 rounded border px-2 text-[10px] font-mono transition-colors ${
          isMissing
            ? "border-dashed border-[var(--warning)]/50 bg-[var(--warning)]/5 italic text-[var(--warning)]"
            : "border-[var(--border)] bg-[var(--surface-container)] text-[var(--text-secondary)] group-hover:bg-[var(--surface-high)]"
        }`}
      >
        {status === "online" && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
        )}
        {status === "offline" && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]/50" />
        )}
        {isMissing && <AlertTriangle size={10} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
    );
  };

  const frame =
    "grid h-20 w-full gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5";

  switch (layout) {
    case "split-vertical":
      return <div className={`${frame} grid-cols-2`}>{[0, 1].map(cell)}</div>;

    case "split-horizontal":
      return <div className={`${frame} grid-rows-2`}>{[0, 1].map(cell)}</div>;

    case "grid-4":
      return (
        <div className={`${frame} grid-cols-2 grid-rows-2`}>{[0, 1, 2, 3].map(cell)}</div>
      );

    case "split-1-2":
      return (
        <div className={`${frame} grid-cols-2`}>
          {cell(0)}
          <div className="grid min-w-0 grid-rows-2 gap-1.5">{[1, 2].map(cell)}</div>
        </div>
      );

    case "split-2-1":
      return (
        <div className={`${frame} grid-rows-2`}>
          <div className="grid min-w-0 grid-cols-2 gap-1.5">{[0, 1].map(cell)}</div>
          {cell(2)}
        </div>
      );

    case "triple-column":
      return <div className={`${frame} grid-cols-3`}>{[0, 1, 2].map(cell)}</div>;

    default: {
      // Unknown layout (synced/imported from another version): equal columns.
      const count = Math.max(panes.length, 1);
      return (
        <div
          className={frame}
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: count }, (_, idx) => cell(idx))}
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

  const layoutMeta = getLayoutMeta(preset.layout);
  const isKnownLayout = isKnownPresetLayout(preset.layout);
  // Pane slots with no host or a host deleted since the preset was saved.
  const missingCount = useMemo(
    () => resolvePresetHosts(preset, hosts).missing,
    [preset, hosts]
  );

  // One entry per layout slot (same slot rules as resolvePresetHosts).
  const paneCount = isKnownLayout
    ? getPaneCountForLayout(preset.layout)
    : preset.nodes.length;

  const panes: BlueprintPane[] = Array.from({ length: paneCount }, (_, idx) => {
    const node = preset.nodes.find((n) => n.paneIndex === idx);
    const host = node ? hosts.find((h) => h.id === node.hostId) : undefined;
    if (!host) {
      return {
        label: node?.label || t("workspaces.paneDefault", { index: idx + 1 }),
        title: t("workspaces.missingHostsBadgeTitle", { count: 1 }),
        status: "missing",
      };
    }
    const ping = statusByHostId[host.id];
    return {
      // Live host label wins over a label saved by older versions.
      label: host.label,
      title: `${host.label}\n${host.username}@${host.address}:${host.port}`,
      status: ping ? (ping.online ? "online" : "offline") : undefined,
    };
  });

  const resolvedCount = panes.filter((p) => p.status !== "missing").length;
  const onlineCount = panes.filter((p) => p.status === "online").length;
  const hasPingData = panes.some((p) => p.status === "online" || p.status === "offline");

  const handleDeleteClick = () => {
    confirm({
      title: t("workspaces.deleteConfirm.title"),
      message: t("workspaces.deleteConfirm.message", { name: preset.name }),
      confirmLabel: t("workspaces.deleteConfirm.confirmLabel"),
      isDanger: true,
      onConfirm: () => onDelete(preset.id),
    });
  };

  const iconButton =
    "flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors cursor-pointer";

  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, preset)}
      className="group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-colors hover:border-[var(--primary)]/40"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {preset.name}
            </h3>
            {missingCount > 0 && (
              <button
                type="button"
                onClick={() => onEdit(preset)}
                title={t("workspaces.missingHostsBadgeTitle", { count: missingCount })}
                className="flex shrink-0 items-center gap-1 rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--warning)] hover:bg-[var(--warning)]/25 transition-colors cursor-pointer"
              >
                <AlertTriangle size={10} />
                <span>{t("workspaces.missingHostsBadge", { count: missingCount })}</span>
              </button>
            )}
          </div>

          {/* Subtitle: description, otherwise pane count — the layout itself is visible below */}
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className="truncate">
              {preset.description ||
                (isKnownLayout
                  ? t("workspaces.modal.panesCount", { count: paneCount })
                  : t(layoutMeta.labelKey))}
            </span>
            {preset.broadcastOnLaunch && (
              <span
                title={t("workspaces.broadcastBadgeTitle")}
                className="flex shrink-0 items-center gap-1 text-[var(--primary)]"
              >
                <span className="text-[var(--text-muted)]">·</span>
                <Radio size={11} />
                {t("workspaces.broadcastBadge")}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => onDuplicate(preset.id)}
            title={t("workspaces.duplicatePresetTooltip")}
            className={`${iconButton} hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]`}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => onEdit(preset)}
            title={t("workspaces.editPresetTooltip")}
            className={`${iconButton} hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]`}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDeleteClick}
            title={t("workspaces.deletePresetTooltip")}
            className={`${iconButton} hover:bg-[var(--danger)]/15 hover:text-[var(--danger)]`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Layout preview with per-pane host status */}
      <div className="mt-3">
        <LayoutBlueprint layout={preset.layout} panes={panes} />
      </div>

      {/* Footer: host status + launch */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-mono text-[var(--text-muted)]">
          {hasPingData ? (
            <>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  onlineCount > 0 ? "bg-[var(--success)]" : "bg-[var(--text-muted)]/50"
                }`}
              />
              {t("workspaces.onlineCount", { online: onlineCount, total: resolvedCount })}
            </>
          ) : (
            t("workspaces.hostsCount", { count: resolvedCount })
          )}
        </span>

        {/* Outline by default so a grid of cards isn't a wall of bright buttons;
            fills in when the card is hovered. */}
        <button
          onClick={() => onLaunch(preset)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--primary)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] transition-colors group-hover:border-[var(--primary)] group-hover:bg-[var(--primary)] group-hover:text-black hover:bg-[var(--primary)]/90 cursor-pointer"
        >
          <Play size={12} className="fill-current" />
          {t("workspaces.launchShort")}
        </button>
      </div>
    </div>
  );
}
