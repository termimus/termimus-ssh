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
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore, WorkspacePreset } from "../../stores/useWorkspaceStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { getAllLeafPanes } from "../../lib/layoutTree";
import { launchWorkspacePreset } from "../../lib/workspaceLauncher";
import {
  captureGroupAsPreset,
  getPaneCountForLayout,
  resolvePresetHosts,
} from "../../lib/workspaceLayout";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceModal } from "./WorkspaceModal";

interface WorkspaceViewProps {
  onOpenTerminal: () => void;
}

export function WorkspaceView({ onOpenTerminal }: WorkspaceViewProps) {
  const { t } = useTranslation();
  const {
    presets,
    isLoading,
    loadError,
    refresh,
    openCreateModal,
    openEditModal,
    duplicatePreset,
    deletePreset,
  } = useWorkspaceStore(
    useShallow((s) => ({
      presets: s.presets,
      isLoading: s.isLoading,
      loadError: s.error,
      refresh: s.refresh,
      openCreateModal: s.openCreateModal,
      openEditModal: s.openEditModal,
      duplicatePreset: s.duplicatePreset,
      deletePreset: s.deletePreset,
    }))
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { groups, activeGroupId, tabs } = useSessionStore(
    useShallow((s) => ({ groups: s.groups, activeGroupId: s.activeGroupId, tabs: s.tabs }))
  );
  const hosts = useHostStore((s) => s.hosts);

  const [searchQuery, setSearchQuery] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
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

  // Check if the active terminal group is a split that maps to a preset layout
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const activeLeafPanes = activeGroup ? getAllLeafPanes(activeGroup.rootPane) : [];
  const activeCapture = useMemo(
    () => (activeGroup ? captureGroupAsPreset(activeGroup.rootPane, tabs, hosts) : null),
    [activeGroup, tabs, hosts]
  );
  const canSaveActiveSplit = activeCapture !== null;

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

  // Launch a preset. Missing hosts are confirmed first (the layout collapses
  // to the remaining ones); failures are surfaced instead of being swallowed.
  const handleLaunchPreset = (preset: WorkspacePreset) => {
    setLaunchError(null);
    const resolved = resolvePresetHosts(preset, hosts);

    const launch = () => {
      try {
        launchWorkspacePreset(preset, resolved.hosts);
        onOpenTerminal();
      } catch (e) {
        setLaunchError(t("workspaces.launchFailed", { name: preset.name, error: String(e) }));
      }
    };

    if (resolved.hosts.length === 0) {
      setLaunchError(t("workspaces.launchNoHosts", { name: preset.name }));
      return;
    }

    if (resolved.missing > 0) {
      useConfirmStore.getState().confirm({
        title: t("workspaces.missingHostsConfirm.title"),
        message: t("workspaces.missingHostsConfirm.message", {
          name: preset.name,
          missing: resolved.missing,
          total: resolved.missing + resolved.hosts.length,
          count: resolved.hosts.length,
        }),
        confirmLabel: t("workspaces.missingHostsConfirm.confirmLabel"),
        onConfirm: launch,
      });
      return;
    }

    launch();
  };

  // 1-Click capture of active split screen
  const handleSaveActiveSplit = () => {
    if (!activeCapture || !activeGroup) return;
    openCreateModal({
      name: t("workspaces.capturedName", { count: activeLeafPanes.length }),
      description: t("workspaces.capturedDescription"),
      layout: activeCapture.layout,
      nodes: activeCapture.nodes,
      broadcastOnLaunch: useSessionStore.getState().isGroupBroadcastActive(activeGroup.id),
    });
  };

  // Quick Starter Preset Generator for new users
  const handleCreateStarterPreset = (
    layout: WorkspacePreset["layout"],
    title: string
  ) => {
    if (hosts.length === 0) return;
    const required = getPaneCountForLayout(layout);
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
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-4 text-[var(--text-primary)] select-none"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Layers size={18} className="text-[var(--accent)]" />
            {t("workspaces.title")}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("workspaces.subtitle")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canSaveActiveSplit && (
            <button
              onClick={handleSaveActiveSplit}
              title={t("workspaces.saveActiveSplitTitle")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <BookmarkPlus size={14} />
              {t("workspaces.saveActiveSplit", { count: activeLeafPanes.length })}
            </button>
          )}
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)] cursor-pointer"
          >
            <Plus size={14} /> {t("workspaces.newWorkspace")}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("workspaces.searchPlaceholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {launchError && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{launchError}</span>
            <button
              onClick={() => setLaunchError(null)}
              className="shrink-0 rounded p-0.5 hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">{t("workspaces.loadError", { error: loadError })}</span>
            <button
              onClick={() => refresh()}
              className="shrink-0 rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 font-medium hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {isLoading && presets.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("common.loading")}</span>
          </div>
        ) : filteredPresets.length === 0 ? (
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
                          handleCreateStarterPreset("split-vertical", t("workspaces.starterNames.dual"))
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <Zap size={12} className="text-[var(--primary)]" />
                        <span>{t("workspaces.starterDual")}</span>
                      </button>

                      <button
                        onClick={() =>
                          handleCreateStarterPreset("split-1-2", t("workspaces.starterNames.triple"))
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        <Server size={12} className="text-[var(--primary)]" />
                        <span>{t("workspaces.starterTriple")}</span>
                      </button>

                      <button
                        onClick={() =>
                          handleCreateStarterPreset("grid-4", t("workspaces.starterNames.quad"))
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
          // auto-fill: wide windows get more columns instead of stretching each card
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]">
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
