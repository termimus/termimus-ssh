import { useState } from "react";
import {
  Play,
  Pencil,
  Trash2,
  Copy,
  Radio,
  Loader2,
  Server,
} from "lucide-react";
import {
  WorkspacePreset,
  PresetLayoutType,
  getLayoutMeta,
} from "../../stores/useWorkspaceStore";
import { useHostStore } from "../../stores/useHostStore";
import { usePingStore } from "../../stores/usePingStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { DistroBadge } from "../hosts/DistroBadge";

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
  const baseBox =
    "flex items-center justify-center rounded border border-[var(--primary)]/30 bg-[var(--surface-container)] text-[10px] font-mono text-[var(--text-secondary)] font-medium truncate p-1 transition-colors group-hover:border-[var(--primary)]/60 group-hover:bg-[var(--surface-high)]";

  switch (layout) {
    case "split-vertical":
      return (
        <div className="grid h-24 w-full grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
          </div>
        </div>
      );

    case "split-horizontal":
      return (
        <div className="grid h-24 w-full grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
          </div>
        </div>
      );

    case "grid-4":
      return (
        <div className="grid h-24 w-full grid-cols-2 grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || "Pane 3"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[3] || "Pane 4"}</span>
          </div>
        </div>
      );

    case "split-1-2":
      return (
        <div className="grid h-24 w-full grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
          </div>
          <div className="grid grid-rows-2 gap-1.5">
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
            </div>
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[2] || "Pane 3"}</span>
            </div>
          </div>
        </div>
      );

    case "split-2-1":
      return (
        <div className="grid h-24 w-full grid-rows-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
            </div>
            <div className={baseBox}>
              <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
            </div>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || "Pane 3"}</span>
          </div>
        </div>
      );

    case "triple-column":
      return (
        <div className="grid h-24 w-full grid-cols-3 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1.5">
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[0] || "Pane 1"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[1] || "Pane 2"}</span>
          </div>
          <div className={baseBox}>
            <span className="truncate">{nodeLabels[2] || "Pane 3"}</span>
          </div>
        </div>
      );
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
  const hosts = useHostStore((s) => s.hosts);
  const statusByHostId = usePingStore((s) => s.statusByHostId);
  const confirm = useConfirmStore((s) => s.confirm);
  const [isLaunching, setIsLaunching] = useState(false);

  const layoutMeta = getLayoutMeta(preset.layout);

  // Map nodes to hosts
  const assignedNodes = preset.nodes.map((node) => {
    const host = hosts.find((h) => h.id === node.hostId);
    return {
      paneIndex: node.paneIndex,
      host,
      label: node.label || host?.label || `Pane ${node.paneIndex + 1}`,
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
      title: "Delete Workspace Preset",
      message: `Are you sure you want to delete "${preset.name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
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
                  title="Interconnection / Input Broadcast auto-enabled on launch"
                  className="flex items-center gap-1 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--primary)] shrink-0"
                >
                  <Radio size={10} className="animate-pulse" />
                  <span>Broadcast</span>
                </span>
              )}
            </div>
            {preset.description ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">
                {preset.description}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {layoutMeta.label}
              </p>
            )}
          </div>

          {/* Quick Menu Icons */}
          <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onDuplicate(preset.id)}
              title="Duplicate preset"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Copy size={13} />
            </button>
            <button
              onClick={() => onEdit(preset)}
              title="Edit preset"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleDeleteClick}
              title="Delete preset"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--danger)]/15 hover:text-[var(--danger)] transition-colors"
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
            Cluster Nodes ({assignedNodes.filter((n) => n.host).length} / {layoutMeta.panes})
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
                        <span>Unassigned Node</span>
                      </span>
                    )}
                  </div>

                  {ping && (
                    <span
                      className={`font-mono text-[10px] shrink-0 ${
                        ping.online ? "text-emerald-400" : "text-zinc-500"
                      }`}
                    >
                      {ping.online ? `${ping.latencyMs ?? 0}ms` : "offline"}
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
          className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-semibold text-black shadow-sm transition-all hover:bg-[var(--primary)]/90 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
        >
          {isLaunching ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Connecting & Splitting...</span>
            </>
          ) : (
            <>
              <Play size={13} className="fill-current" />
              <span>Launch Cluster</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
