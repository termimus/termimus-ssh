import { useState, useMemo, useEffect, useCallback, memo } from "react";
import {
  Server,
  Terminal,
  FolderOpen,
  Waypoints,
  Pencil,
  Trash2,
  Plus,
  FolderPlus,
  LayoutGrid,
  List,
  ArrowLeft,
  Search,
  MoreVertical,
  Copy,
  CopyPlus,
  Columns2,
  Rows2,
  RefreshCw,
  Check,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useHostStore } from "../../stores/useHostStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useSftpStore } from "../../stores/useSftpStore";
import { usePingStore } from "../../stores/usePingStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { useVaultStore } from "../../stores/useVaultStore";
import { FolderModal } from "./FolderModal";
import { Host, Folder } from "../../lib/api";
import { DistroBadge } from "./DistroBadge";
import { HostListRow } from "./HostListRow";

// Ping interval: 60s is gentle on router & network, battery-friendly on laptops
const PING_INTERVAL_MS = 60000;

interface HostListProps {
  onOpenTerminal?: () => void;
  onOpenSftp: () => void;
  onOpenTunnels: () => void;
}

export function HostList({ onOpenTerminal, onOpenSftp, onOpenTunnels }: HostListProps) {
  const {
    hosts,
    folders,
    searchQuery,
    setSearchQuery,
    openCreateModal,
    openDuplicateModal,
    openEditModal,
    deleteHost,
    openCreateFolderModal,
    openEditFolderModal,
    deleteFolder,
  } = useHostStore(
    useShallow((s) => ({
      hosts: s.hosts,
      folders: s.folders,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      openCreateModal: s.openCreateModal,
      openDuplicateModal: s.openDuplicateModal,
      openEditModal: s.openEditModal,
      deleteHost: s.deleteHost,
      openCreateFolderModal: s.openCreateFolderModal,
      openEditFolderModal: s.openEditFolderModal,
      deleteFolder: s.deleteFolder,
    }))
  );

  const { openSession, openSessionInSplit, tabs } = useSessionStore(
    useShallow((s) => ({
      openSession: s.openSession,
      openSessionInSplit: s.openSessionInSplit,
      tabs: s.tabs,
    }))
  );
  const connectRemote = useSftpStore((s) => s.connectRemote);
  const { pingAll, statusByHostId } = usePingStore(
    useShallow((s) => ({ pingAll: s.pingAll, statusByHostId: s.statusByHostId }))
  );

  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try {
      return (localStorage.getItem("termimus_hosts_view_mode") as "grid" | "list") || "grid";
    } catch {
      return "grid";
    }
  });

  const handleToggleView = useCallback((mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem("termimus_hosts_view_mode", mode);
    } catch {}
  }, []);

  const [selectedTag, setSelectedTag] = useState<string>("All");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [activeMenuHostId, setActiveMenuHostId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "host" | "folder" | "background";
    host?: Host;
    folder?: Folder;
  } | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  }, []);

  const handleHostContextMenu = useCallback((e: React.MouseEvent, host: Host) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setContextMenu({ x, y, type: "host", host });
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ x, y, type: "folder", folder });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ x, y, type: "background" });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    // Use mousedown instead of pointerdown for the dismiss listener.
    // On Windows (WebView2/Chromium), synthetic React onPointerDown handlers
    // on the context menu container can lose the stopPropagation race against a
    // native pointerdown window listener.  mousedown fires slightly later in the
    // event sequence and is reliably stopped by the container's onMouseDown guard.
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Background ping check — visibility-aware, only pings when window is visible
  useEffect(() => {
    if (hosts.length === 0) return;

    pingAll();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        pingAll();
      }
    }, PING_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        pingAll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hosts.length, pingAll]);

  // Extract all unique tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    hosts.forEach((h) => h.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [hosts]);

  // Filter hosts by tag and search query
  const filteredHosts = useMemo(() => {
    let list = hosts;
    if (selectedTag !== "All") {
      list = list.filter((h) => h.tags.includes(selectedTag));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          h.address.toLowerCase().includes(q) ||
          h.username.toLowerCase().includes(q) ||
          h.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [hosts, selectedTag, searchQuery]);

  // Sort hosts by "terakhir di buka" (most recently opened / connected first)
  const sortedRecentHosts = useMemo(() => {
    return [...filteredHosts].sort((a, b) => {
      const timeA = a.last_connected_at || a.created_at || a.updated_at;
      const timeB = b.last_connected_at || b.created_at || b.updated_at;
      return new Date(timeB).getTime() - new Date(timeA).getTime();
    });
  }, [filteredHosts]);

  // Map each folder to its host count
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    hosts.forEach((h) => {
      if (h.folder_id) {
        map.set(h.folder_id, (map.get(h.folder_id) || 0) + 1);
      }
    });
    return map;
  }, [hosts]);

  // Active folder object if drilled down
  const activeFolder = useMemo(() => {
    if (!selectedFolderId) return null;
    return folders.find((f) => f.id === selectedFolderId) || null;
  }, [folders, selectedFolderId]);

  // Auto-reset selectedFolderId if the active folder is deleted remotely or locally
  useEffect(() => {
    if (selectedFolderId && !folders.some((f) => f.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

  // Hosts inside the currently selected group
  const hostsInActiveFolder = useMemo(() => {
    if (!selectedFolderId) return [];
    return filteredHosts.filter((h) => h.folder_id === selectedFolderId);
  }, [filteredHosts, selectedFolderId]);

  const handleConnect = useCallback(
    async (host: Host) => {
      if (!useVaultStore.getState().isUnlocked) {
        useVaultStore.getState().openUnlockPrompt();
        return;
      }
      onOpenTerminal?.();
      await openSession(host);
    },
    [onOpenTerminal, openSession]
  );

  const handleConnectSplit = useCallback(
    (host: Host, direction: "row" | "column") => {
      if (!useVaultStore.getState().isUnlocked) {
        useVaultStore.getState().openUnlockPrompt();
        return;
      }
      onOpenTerminal?.();
      const targetPane = useSessionStore.getState().activePaneId ?? "root";
      openSessionInSplit(host, targetPane, direction);
    },
    [onOpenTerminal, openSessionInSplit]
  );

  const handleSftpClick = useCallback(
    async (e: React.MouseEvent, host: Host) => {
      e.stopPropagation();
      if (!useVaultStore.getState().isUnlocked) {
        useVaultStore.getState().openUnlockPrompt();
        return;
      }
      onOpenSftp();
      await connectRemote(host);
    },
    [onOpenSftp, connectRemote]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, host: Host) => {
      e.stopPropagation();
      useConfirmStore.getState().confirm({
        title: "Delete Host",
        message: `Are you sure you want to delete "${host.label}" (${host.username}@${host.address})? This action cannot be undone.`,
        confirmLabel: "Delete Host",
        isDanger: true,
        onConfirm: async () => {
          await deleteHost(host.id);
        },
      });
    },
    [deleteHost]
  );

  const handleDeleteFolder = useCallback(
    (e: React.MouseEvent, folder: Folder) => {
      e.stopPropagation();
      useConfirmStore.getState().confirm({
        title: "Delete Group",
        message: `Are you sure you want to delete the group "${folder.name}"? Hosts inside this group will not be deleted and will move to ungrouped.`,
        confirmLabel: "Delete Group",
        isDanger: true,
        onConfirm: async () => {
          await deleteFolder(folder.id);
          setSelectedFolderId((prev) => (prev === folder.id ? null : prev));
        },
      });
    },
    [deleteFolder]
  );

  const handleToggleMenu = useCallback((hostId: string) => {
    setActiveMenuHostId((prev) => (prev === hostId ? null : hostId));
  }, []);

  return (
    <div
      onClick={() => setActiveMenuHostId(null)}
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-y-auto bg-[var(--canvas)] p-5 select-none"
    >
      {/* Folder create/rename modal */}
      <FolderModal />

      {/* Top Search & Actions Bar */}
      <div className="mb-6 flex flex-col gap-2.5 min-w-0">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            {/* Search bar */}
            <div className="relative min-w-[160px] sm:min-w-[220px] max-w-xs flex-1 shrink-0">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search host, IP, label, tag..."
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container)] py-2 pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none transition-colors"
              />
            </div>

            {/* Tag filters (desktop single-row with horizontal scroll) */}
            {!selectedFolderId && allTags.length > 0 && (
              <div className="hidden lg:flex items-center gap-1 overflow-x-auto min-w-0 flex-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setSelectedTag("All")}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-mono shrink-0 transition-colors cursor-pointer ${
                    selectedTag === "All"
                      ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)] border border-[var(--primary)]/30"
                      : "bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-white"
                  }`}
                >
                  All
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-mono shrink-0 transition-colors cursor-pointer ${
                      selectedTag === tag
                        ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)] border border-[var(--primary)]/30"
                        : "bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-white"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Area: Grid/List Toggle + Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => handleToggleView("grid")}
                title="Grid Cards View"
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-[var(--surface-high)] text-[var(--primary)] font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                onClick={() => handleToggleView("list")}
                title="Compact List View"
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-[var(--surface-high)] text-[var(--primary)] font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                <List size={15} />
              </button>
            </div>

            <button
              type="button"
              onClick={openCreateFolderModal}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors shadow-sm shrink-0 cursor-pointer"
            >
              <FolderPlus size={14} />
              <span>New Group</span>
            </button>

            <button
              type="button"
              onClick={() => openCreateModal(selectedFolderId ?? undefined)}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors shadow-sm shrink-0 cursor-pointer"
            >
              <Plus size={15} strokeWidth={2.5} />
              <span>New Host</span>
            </button>
          </div>
        </div>

        {/* Tag filters (mobile/tablet) */}
        {!selectedFolderId && allTags.length > 0 && (
          <div className="flex lg:hidden items-center gap-1 overflow-x-auto min-w-0 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setSelectedTag("All")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-mono shrink-0 transition-colors cursor-pointer ${
                selectedTag === "All"
                  ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)] border border-[var(--primary)]/30"
                  : "bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-mono shrink-0 transition-colors cursor-pointer ${
                  selectedTag === tag
                    ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)] border border-[var(--primary)]/30"
                    : "bg-[var(--surface-container)] text-[var(--text-secondary)] hover:text-white"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* VIEW 1: DRILLED DOWN INTO A GROUP */}
      {selectedFolderId && activeFolder ? (
        <div className="space-y-4">
          {/* Breadcrumb Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedFolderId(null)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-white transition"
              >
                <ArrowLeft size={13} />
                <span>All Groups</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-muted)]">/</span>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0284c7] text-white">
                    <LayoutGrid size={14} />
                  </div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    {activeFolder.name}
                  </h2>
                </div>
                <span className="rounded-md bg-[var(--surface-container)] px-2 py-0.5 text-xs font-mono text-[var(--text-muted)] border border-[var(--border)]">
                  {hostsInActiveFolder.length}{" "}
                  {hostsInActiveFolder.length === 1 ? "Host" : "Hosts"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => openEditFolderModal(activeFolder)}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-white transition"
                title="Rename Group"
              >
                <Pencil size={12} /> Rename
              </button>
              <button
                onClick={(e) => handleDeleteFolder(e, activeFolder)}
                className="flex items-center gap-1 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/20 transition"
                title="Delete Group"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>

          {/* Hosts Inside Group */}
          {hostsInActiveFolder.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-muted)]">
              <Server size={36} className="mb-2 opacity-30" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                No hosts in this group yet
              </p>
              <p className="mt-1 text-xs max-w-sm">
                When adding or editing a host, select <strong>{activeFolder.name}</strong> as its folder.
              </p>
              <button
                onClick={() => openCreateModal(selectedFolderId ?? undefined)}
                className="mt-4 rounded-xl bg-[var(--primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition"
              >
                Add Host Here
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {hostsInActiveFolder.map((host) => (
                <HostCard
                  key={host.id}
                  host={host}
                  isConnecting={tabs.some((t) => t.hostId === host.id && t.connecting)}
                  isOnline={statusByHostId[host.id]?.online ?? true}
                  latencyMs={statusByHostId[host.id]?.latencyMs}
                  isMenuOpen={activeMenuHostId === host.id}
                  onConnect={handleConnect}
                  onToggleMenu={handleToggleMenu}
                  onSftp={handleSftpClick}
                  onTunnels={onOpenTunnels}
                  onEdit={openEditModal}
                  onDuplicate={openDuplicateModal}
                  onDelete={handleDelete}
                  onContextMenu={handleHostContextMenu}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Table Column Header */}
              <div className="flex items-center gap-3.5 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] select-none">
                <span className="w-8 shrink-0 text-center">OS</span>
                <span className="w-48 sm:w-56 md:w-64 shrink-0">Name</span>
                <span className="w-40 sm:w-48 md:w-52 shrink-0">Address</span>
                <span className="hidden sm:block w-24 md:w-32 shrink-0">User</span>
                <span className="hidden lg:block flex-1 min-w-0">Tags</span>
                <span className="w-16 shrink-0 text-right ml-auto pr-2">Actions</span>
              </div>

              {hostsInActiveFolder.map((host) => (
                <HostListRow
                  key={host.id}
                  host={host}
                  isConnecting={tabs.some((t) => t.hostId === host.id && t.connecting)}
                  isOnline={statusByHostId[host.id]?.online ?? true}
                  latencyMs={statusByHostId[host.id]?.latencyMs}
                  isMenuOpen={activeMenuHostId === host.id}
                  onConnect={handleConnect}
                  onToggleMenu={handleToggleMenu}
                  onSftp={handleSftpClick}
                  onTunnels={onOpenTunnels}
                  onEdit={openEditModal}
                  onDuplicate={openDuplicateModal}
                  onDelete={handleDelete}
                  onContextMenu={handleHostContextMenu}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* VIEW 2: ROOT VIEW (GROUPS ON TOP, RECENT HOSTS BELOW) */
        <div className="space-y-7">
          {/* GROUPS SECTION */}
          {folders.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Groups
                </h2>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">
                  Click group to view hosts
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {folders.map((folder) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    count={folderCounts.get(folder.id) || 0}
                    onSelect={setSelectedFolderId}
                    onEdit={openEditFolderModal}
                    onDelete={handleDeleteFolder}
                    onContextMenu={handleFolderContextMenu}
                  />
                ))}
              </div>
            </div>
          )}

          {/* HOSTS SECTION (Sorted by last opened / connected) */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Hosts
              </h2>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Ordered by last opened
              </span>
            </div>

            {sortedRecentHosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-muted)]">
                <Server size={36} className="mb-2 opacity-30" />
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {hosts.length === 0 ? "No servers configured yet" : "No hosts match your filter"}
                </p>
                <p className="mt-1 text-xs max-w-sm">
                  Add a server to start SSH sessions, transfer files via SFTP, and forward ports.
                </p>
                {hosts.length === 0 && (
                  <button
                    onClick={() => openCreateModal()}
                    className="mt-4 rounded-xl bg-[var(--primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition"
                  >
                    Add Your First Host
                  </button>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {sortedRecentHosts.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    isConnecting={tabs.some((t) => t.hostId === host.id && t.connecting)}
                    isOnline={statusByHostId[host.id]?.online ?? true}
                    latencyMs={statusByHostId[host.id]?.latencyMs}
                    isMenuOpen={activeMenuHostId === host.id}
                    onConnect={handleConnect}
                    onToggleMenu={handleToggleMenu}
                    onSftp={handleSftpClick}
                    onTunnels={onOpenTunnels}
                    onEdit={openEditModal}
                    onDuplicate={openDuplicateModal}
                    onDelete={handleDelete}
                    onContextMenu={handleHostContextMenu}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {/* Table Column Header */}
                <div className="flex items-center gap-3.5 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] select-none">
                  <span className="w-8 shrink-0 text-center">OS</span>
                  <span className="w-48 sm:w-56 md:w-64 shrink-0">Name</span>
                  <span className="w-40 sm:w-48 md:w-52 shrink-0">Address</span>
                  <span className="hidden sm:block w-24 md:w-32 shrink-0">User</span>
                  <span className="hidden lg:block flex-1 min-w-0">Tags</span>
                  <span className="w-16 shrink-0 text-right ml-auto pr-2">Actions</span>
                </div>

                {sortedRecentHosts.map((host) => (
                  <HostListRow
                    key={host.id}
                    host={host}
                    isConnecting={tabs.some((t) => t.hostId === host.id && t.connecting)}
                    isOnline={statusByHostId[host.id]?.online ?? true}
                    latencyMs={statusByHostId[host.id]?.latencyMs}
                    isMenuOpen={activeMenuHostId === host.id}
                    onConnect={handleConnect}
                    onToggleMenu={handleToggleMenu}
                    onSftp={handleSftpClick}
                    onTunnels={onOpenTunnels}
                    onEdit={openEditModal}
                    onDuplicate={openDuplicateModal}
                    onDelete={handleDelete}
                    onContextMenu={handleHostContextMenu}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "host" && contextMenu.host ? (
            <>
              {/* Connect SSH (New Tab) */}
              <button
                onClick={() => {
                  handleConnect(contextMenu.host!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
              >
                <Terminal size={13} />
                <span>Connect SSH</span>
              </button>

              {/* Split Right */}
              <button
                onClick={() => {
                  handleConnectSplit(contextMenu.host!, "row");
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Columns2 size={13} />
                <span>Split Right</span>
              </button>

              {/* Split Down */}
              <button
                onClick={() => {
                  handleConnectSplit(contextMenu.host!, "column");
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Rows2 size={13} />
                <span>Split Down</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* SFTP Browser */}
              <button
                onClick={(e) => {
                  handleSftpClick(e, contextMenu.host!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <FolderOpen size={13} />
                <span>SFTP Files</span>
              </button>

              {/* Port Forwarding */}
              <button
                onClick={() => {
                  onOpenTunnels();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Waypoints size={13} />
                <span>Port Forwarding</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Duplicate Host */}
              <button
                onClick={() => {
                  openDuplicateModal(contextMenu.host!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <CopyPlus size={13} />
                <span>Duplicate Host</span>
              </button>

              {/* Copy SSH Command */}
              <button
                onClick={async () => {
                  const port = contextMenu.host!.port || 22;
                  const cmd = `ssh -p ${port} ${contextMenu.host!.username}@${contextMenu.host!.address}`;
                  await navigator.clipboard.writeText(cmd);
                  showCopyToast("Copied SSH command");
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Copy size={13} />
                <span>Copy SSH Command</span>
              </button>

              {/* Copy Address */}
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(contextMenu.host!.address);
                  showCopyToast("Copied host address");
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Copy size={13} />
                <span>Copy Address</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Edit Host */}
              <button
                onClick={() => {
                  openEditModal(contextMenu.host!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Pencil size={13} />
                <span>Edit Host</span>
              </button>

              {/* Delete Host */}
              <button
                onClick={(e) => {
                  handleDelete(e, contextMenu.host!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group"
              >
                <Trash2 size={13} />
                <span>Delete Host</span>
              </button>
            </>
          ) : contextMenu.type === "folder" && contextMenu.folder ? (
            <>
              {/* Open Group */}
              <button
                onClick={() => {
                  setSelectedFolderId(contextMenu.folder!.id);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
              >
                <FolderOpen size={13} />
                <span>Open Group</span>
              </button>

              {/* Rename Group */}
              <button
                onClick={() => {
                  openEditFolderModal(contextMenu.folder!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Pencil size={13} />
                <span>Rename Group</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Delete Group */}
              <button
                onClick={(e) => {
                  handleDeleteFolder(e, contextMenu.folder!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group"
              >
                <Trash2 size={13} />
                <span>Delete Group</span>
              </button>
            </>
          ) : (
            <>
              {/* Background Empty Area Menu */}
              <button
                onClick={() => {
                  openCreateModal(selectedFolderId ?? undefined);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
              >
                <Plus size={13} />
                <span>New Host</span>
              </button>

              <button
                onClick={() => {
                  openCreateFolderModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <FolderPlus size={13} />
                <span>New Group</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              <button
                onClick={() => {
                  pingAll();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <RefreshCw size={13} />
                <span>Ping All Hosts</span>
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
// MEMOIZED FOLDER CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface FolderCardProps {
  folder: Folder;
  count: number;
  onSelect: (folderId: string) => void;
  onEdit: (folder: Folder) => void;
  onDelete: (e: React.MouseEvent, folder: Folder) => void;
  onContextMenu?: (e: React.MouseEvent, folder: Folder) => void;
}

const FolderCard = memo(function FolderCard({
  folder,
  count,
  onSelect,
  onEdit,
  onDelete,
  onContextMenu,
}: FolderCardProps) {
  return (
    <div
      onClick={() => onSelect(folder.id)}
      onContextMenu={(e) => onContextMenu?.(e, folder)}
      className="group relative flex items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] p-3.5 hover:border-[var(--primary)]/60 transition-colors cursor-pointer shadow-sm hover:shadow-md"
    >
      {/* Group Icon Badge */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0284c7] text-white shadow-md transition-transform duration-200 group-hover:scale-105">
        <LayoutGrid size={18} />
      </div>

      {/* Group Name & Count */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
          {folder.name}
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          {count} {count === 1 ? "Host" : "Hosts"}
        </p>
      </div>

      {/* Quick Edit/Delete icon on hover */}
      <div
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onEdit(folder)}
          title="Rename"
          className="rounded p-1 text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-high)]"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => onDelete(e, folder)}
          title="Delete"
          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/20"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED HOST CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface HostCardProps {
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

const HostCard = memo(function HostCard({
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
}: HostCardProps) {
  return (
    <div
      onClick={() => onConnect(host)}
      onContextMenu={(e) => onContextMenu?.(e, host)}
      className="group relative flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] p-3.5 hover:border-[var(--primary)]/60 transition-colors cursor-pointer shadow-sm hover:shadow-md select-none"
    >
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {/* OS Distro Badge with top-left status dot (inside the badge with padding) */}
        <div className="relative shrink-0">
          <DistroBadge host={host} />

          {/* Minimal Status dot inside top-left corner without outline */}
          {isConnecting ? (
            <span
              className="absolute top-1.5 left-1.5 z-10 flex h-2 w-2 items-center justify-center rounded-full bg-[var(--primary)]"
              title="Connecting..."
            >
              <span className="h-1 w-1 rounded-full bg-black animate-ping" />
            </span>
          ) : !isOnline ? (
            <span
              className="absolute top-1.5 left-1.5 z-10 h-1.5 w-1.5 rounded-full bg-rose-500"
              title="Offline"
            />
          ) : latencyMs !== undefined && latencyMs !== null ? (
            <span
              className={`absolute top-1.5 left-1.5 z-10 h-1.5 w-1.5 rounded-full ${
                latencyMs < 80
                  ? "bg-emerald-400"
                  : latencyMs < 200
                  ? "bg-amber-400"
                  : "bg-rose-400"
              }`}
              title={`Online · ${latencyMs}ms`}
            />
          ) : (
            <span
              className="absolute top-1.5 left-1.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400"
              title="Online"
            />
          )}
        </div>

        {/* Host Label & Username */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">
              {host.label}
            </h3>
            {host.jump_host_id && (
              <span
                className="shrink-0 px-1.5 py-0.2 rounded text-[9px] font-mono font-medium bg-[var(--surface-high)] text-[var(--text-muted)] border border-[var(--border)]"
                title="Connected via SSH Bastion / Jump Host"
              >
                via jump
              </span>
            )}
          </div>
          <p className="truncate text-xs text-[var(--text-muted)] font-mono mt-0.5">
            ssh, {host.username}
          </p>
        </div>
      </div>

      {/* Right Area: Action Menu Button (3 dots) */}
      <div className="relative shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onToggleMenu(host.id)}
          title="Options"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-high)] hover:text-white transition"
        >
          <MoreVertical size={14} />
        </button>

        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs">
            <button
              onClick={() => {
                onToggleMenu(host.id);
                onConnect(host);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--primary)] hover:text-[var(--on-primary)] transition"
            >
              <Terminal size={13} />
              <span>Connect SSH</span>
            </button>

            <button
              onClick={(e) => {
                onToggleMenu(host.id);
                onSftp(e, host);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition"
            >
              <FolderOpen size={13} />
              <span>SFTP Files</span>
            </button>

            <button
              onClick={() => {
                onToggleMenu(host.id);
                onTunnels();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition"
            >
              <Waypoints size={13} />
              <span>Tunnels</span>
            </button>

            <div className="my-1 border-t border-[var(--border)]" />

            <button
              onClick={() => {
                onToggleMenu(host.id);
                onDuplicate(host);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition"
            >
              <CopyPlus size={13} />
              <span>Duplicate</span>
            </button>

            <button
              onClick={() => {
                onToggleMenu(host.id);
                onEdit(host);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition"
            >
              <Pencil size={13} />
              <span>Edit Host</span>
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
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
