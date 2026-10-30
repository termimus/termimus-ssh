import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Layers,
  Plus,
  Search,
  BookmarkPlus,
  Server,
  Zap,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore, WorkspacePreset } from "../../stores/useWorkspaceStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { getAllLeafPanes } from "../../lib/layoutTree";
import { launchWorkspacePreset } from "../../lib/workspaceLauncher";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceModal } from "./WorkspaceModal";

interface WorkspaceViewProps {
  onOpenTerminal: () => void;
}

export function WorkspaceView({ onOpenTerminal }: WorkspaceViewProps) {
  const { t } = useTranslation();
  const {
    presets,
    refresh,
    openCreateModal,
    openEditModal,
    duplicatePreset,
    deletePreset,
  } = useWorkspaceStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { groups, activeGroupId, tabs } = useSessionStore(
    useShallow((s) => ({ groups: s.groups, activeGroupId: s.activeGroupId, tabs: s.tabs }))
  );
  const { hosts } = useHostStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "preset" | "background";
    preset?: WorkspacePreset;
  } | null>(null);

  const handlePresetContextMenu = useCallback((e: React.MouseEvent, preset: WorkspacePreset) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 250);
    setContextMenu({ x, y, type: "preset", preset });
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

  // Check if current active group in terminal has multiple panes
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const activeLeafPanes = activeGroup ? getAllLeafPanes(activeGroup.rootPane) : [];
  const canSaveActiveSplit = activeLeafPanes.length >= 2;

  // Filter presets based on search query
  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return presets;

    return presets.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description || "").toLowerCase().includes(q);
      const hostMatch = p.nodes.some((n) => {
        const host = hosts.find((h) => h.id === n.hostId);
        return (
          host &&
          (host.label.toLowerCase().includes(q) ||
            host.address.toLowerCase().includes(q) ||
            host.username.toLowerCase().includes(q))
        );
      });
      return nameMatch || descMatch || hostMatch;
    });
  }, [presets, searchQuery, hosts]);

  // Handle launching a preset
  const handleLaunchPreset = async (preset: WorkspacePreset) => {
    const success = await launchWorkspacePreset(preset);
    if (success) {
      onOpenTerminal();
    }
  };

  // 1-Click capture of active split screen
  const handleSaveActiveSplit = () => {
    if (!activeGroup || activeLeafPanes.length < 2) return;

    // Detect layout type by pane count
    let layoutType: WorkspacePreset["layout"] = "split-vertical";
    if (activeLeafPanes.length === 2) {
      // Check if root split is row or column
      layoutType =
        activeGroup.rootPane.type === "split" && activeGroup.rootPane.direction === "column"
          ? "split-horizontal"
          : "split-vertical";
    } else if (activeLeafPanes.length === 4) {
      layoutType = "grid-4";
    } else if (activeLeafPanes.length === 3) {
      layoutType = "split-1-2";
    }

    const capturedNodes = activeLeafPanes.map((pane, idx) => {
      const tab = tabs.find((t) => t.id === pane.activeTabId);
      return {
        paneIndex: idx,
        hostId: tab ? tab.hostId : hosts[0]?.id || "",
        label: tab ? tab.hostLabel : undefined,
      };
    });

    openCreateModal({
      name: `Active Cluster (${activeLeafPanes.length} Nodes)`,
      description: "Saved from active split screen terminal layout",
      layout: layoutType,
      nodes: capturedNodes,
      broadcastOnLaunch: useSessionStore.getState().isGroupBroadcastActive(activeGroup.id),
    });
  };

  // Quick Starter Preset Generator for new users
  const handleCreateStarterPreset = (
    layout: WorkspacePreset["layout"],
    title: string
  ) => {
    if (hosts.length === 0) return;
    const required = layout === "grid-4" ? 4 : layout === "split-1-2" ? 3 : 2;
    const nodes = Array.from({ length: required }).map((_, idx) => ({
      paneIndex: idx,
      hostId: hosts[idx % hosts.length]?.id || hosts[0].id,
    }));

    openCreateModal({
      name: title,
      layout,
      nodes,
      broadcastOnLaunch: false,
    });
  };

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-y-auto bg-[var(--canvas)] text-[var(--text-primary)]"
    >
      {/* Top Header */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-container)]/40 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] shadow-sm">
                <Layers size={18} />
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                {t("workspaces.title")}
              </h1>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("workspaces.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canSaveActiveSplit && (
              <button
                onClick={handleSaveActiveSplit}
                title={t("workspaces.saveActiveSplitTitle")}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3.5 py-2 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-all shadow-sm cursor-pointer"
              >
                <BookmarkPlus size={14} />
                <span>{t("workspaces.saveActiveSplit", { count: activeLeafPanes.length })}</span>
              </button>
            )}

            <button
              onClick={() => openCreateModal()}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-black shadow-md transition-all hover:bg-[var(--primary)]/90 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>{t("workspaces.newWorkspace")}</span>
            </button>
          </div>
        </div>

        {/* Filter and Overview Metrics */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("workspaces.searchPlaceholder")}
                className="h-8 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] pl-8 pr-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-mono">
            <span>{t("workspaces.presetsSaved", { count: presets.length })}</span>
            <span>•</span>
            <span>{t("workspaces.availableHosts", { count: hosts.length })}</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6">
        {filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--primary)] shadow-sm mb-3">
              <Layers size={26} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {searchQuery ? t("workspaces.emptySearchTitle") : t("workspaces.emptyTitle")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {searchQuery
                ? t("workspaces.emptySearchDesc")
                : t("workspaces.emptyDesc")}
            </p>

            {!searchQuery && (
              <div className="mt-6 flex flex-col items-center gap-3">
                <button
                  onClick={() => openCreateModal()}
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-black shadow-md hover:bg-[var(--primary)]/90 transition-colors cursor-pointer"
                >
                  <Plus size={14} />
                  <span>{t("workspaces.createFirstPreset")}</span>
                </button>

                {hosts.length > 0 && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                      {t("workspaces.starterTemplateHint")}
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() =>
                          handleCreateStarterPreset("split-vertical", "Dual Server Cluster")
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <Zap size={12} className="text-[var(--primary)]" />
                        <span>{t("workspaces.starterDual")}</span>
                      </button>

                      <button
                        onClick={() =>
                          handleCreateStarterPreset("split-1-2", "Web + DB + Worker (3)")
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <Server size={12} className="text-[var(--primary)]" />
                        <span>{t("workspaces.starterTriple")}</span>
                      </button>

                      <button
                        onClick={() =>
                          handleCreateStarterPreset("grid-4", "Quad Microservices (4)")
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <Layers size={12} className="text-[var(--primary)]" />
                        <span>{t("workspaces.starterQuad")}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPresets.map((preset) => (
              <WorkspaceCard
                key={preset.id}
                preset={preset}
                onLaunch={handleLaunchPreset}
                onEdit={openEditModal}
                onDuplicate={duplicatePreset}
                onDelete={deletePreset}
                onContextMenu={handlePresetContextMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preset Create / Edit Modal */}
      <WorkspaceModal />

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "preset" && contextMenu.preset ? (
            <>
              {/* Launch */}
              <button
                onClick={() => {
                  handleLaunchPreset(contextMenu.preset!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
              >
                <Zap size={13} />
                <span>{t("workspaces.launch")}</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Duplicate */}
              <button
                onClick={() => {
                  duplicatePreset(contextMenu.preset!.id);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <Copy size={13} />
                <span>{t("workspaces.duplicate")}</span>
              </button>

              {/* Edit */}
              <button
                onClick={() => {
                  openEditModal(contextMenu.preset!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <Pencil size={13} />
                <span>{t("workspaces.edit")}</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Delete */}
              <button
                onClick={() => {
                  useConfirmStore.getState().confirm({
                    title: t("workspaces.deleteConfirm.title"),
                    message: t("workspaces.deleteConfirm.message", { name: contextMenu.preset!.name }),
                    confirmLabel: t("workspaces.deleteConfirm.confirmLabel"),
                    isDanger: true,
                    onConfirm: () => deletePreset(contextMenu.preset!.id),
                  });
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group cursor-pointer"
              >
                <Trash2 size={13} />
                <span>{t("workspaces.delete")}</span>
              </button>
            </>
          ) : (
            <>
              {/* New Preset */}
              <button
                onClick={() => {
                  openCreateModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
              >
                <Plus size={13} />
                <span>{t("workspaces.newWorkspace")}</span>
              </button>

              {canSaveActiveSplit && (
                <button
                  onClick={() => {
                    handleSaveActiveSplit();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
                >
                  <BookmarkPlus size={13} />
                  <span>{t("workspaces.saveActiveSplit", { count: activeLeafPanes.length })}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
