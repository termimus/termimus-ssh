import { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  Braces,
  Plus,
  Play,
  Pencil,
  Trash2,
  Search,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  Radio,
  Unlink,
  PanelRightClose,
  X,
  Tag,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { getAllLeafPanes } from "../../lib/layoutTree";
import { Snippet } from "../../lib/api";

export function SnippetSidebar() {
  const {
    snippets,
    isLoading,
    refresh,
    deleteSnippet,
    openCreateModal,
    openEditModal,
    toggleSidebar,
  } = useSnippetStore();

  const {
    tabs,
    rootPane,
    activeTabId,
    activeGroupId,
    broadcastGroupIds,
    toggleGroupBroadcast,
    sendSnippetToTerminals,
  } = useSessionStore(
    useShallow((s) => ({
      tabs: s.tabs,
      rootPane: s.rootPane,
      activeTabId: s.activeTabId,
      activeGroupId: s.activeGroupId,
      broadcastGroupIds: s.broadcastGroupIds,
      toggleGroupBroadcast: s.toggleGroupBroadcast,
      sendSnippetToTerminals: s.sendSnippetToTerminals,
    }))
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [runFeedback, setRunFeedback] = useState<{
    id: string;
    message: string;
    ok: boolean;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "snippet" | "background";
    snippet?: Snippet;
  } | null>(null);

  const handleSnippetContextMenu = useCallback((e: React.MouseEvent, snippet: Snippet) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 250);
    setContextMenu({ x, y, type: "snippet", snippet });
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
    if (snippets.length === 0) {
      refresh();
    }
  }, [snippets.length, refresh]);

  // Terminal state evaluation
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isBroadcast = activeGroupId ? broadcastGroupIds.includes(activeGroupId) : false;

  const leafPanes = rootPane ? getAllLeafPanes(rootPane) : [];
  const connectedLeafTabs = leafPanes
    .map((l) => tabs.find((t) => t.id === l.activeTabId))
    .filter((t) => Boolean(t?.connected));

  const hasConnectedTerminal = Boolean(activeTab?.connected) || connectedLeafTabs.length > 0;
  const isMultiTerminal = connectedLeafTabs.length > 1;

  // Extract all unique tags (excluding system tag "secret")
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    snippets.forEach((s) =>
      s.tags.forEach((t) => {
        if (t.toLowerCase() !== "secret") tagSet.add(t);
      })
    );
    return Array.from(tagSet).sort();
  }, [snippets]);

  // Filter snippets by query and selected tag
  const filteredSnippets = useMemo(() => {
    let result = snippets;
    if (selectedTag) {
      result = result.filter((s) => s.tags.includes(selectedTag));
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [snippets, searchQuery, selectedTag]);

  // Run execution handler
  const handleExecute = useCallback(
    async (snippet: Snippet, mode: "auto" | "broadcast" | "single") => {
      const res = await sendSnippetToTerminals(snippet.command, mode);
      const feedbackMsg = res.ok
        ? res.count > 1
          ? `Broadcasted to ${res.count} terminals`
          : `Sent to ${res.targets[0] || "terminal"}`
        : "Failed to send command";

      setRunFeedback({ id: snippet.id, message: feedbackMsg, ok: res.ok });
      setTimeout(() => {
        setRunFeedback((prev) => (prev?.id === snippet.id ? null : prev));
      }, 2000);
    },
    [sendSnippetToTerminals]
  );

  const handleCopy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // ignore
    }
  }, []);

  const handleDelete = useCallback(
    (id: string, snippetTitle?: string) => {
      useConfirmStore.getState().confirm({
        title: "Delete Snippet",
        message: `Are you sure you want to delete ${
          snippetTitle ? `"${snippetTitle}"` : "this snippet"
        }? This action cannot be undone.`,
        confirmLabel: "Delete Snippet",
        isDanger: true,
        onConfirm: async () => {
          await deleteSnippet(id);
        },
      });
    },
    [deleteSnippet]
  );

  return (
    <aside
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--canvas)] select-none z-20 transition-all duration-200"
      aria-label="Snippets Sidebar"
    >
      {/* ── Top Header ────────────────────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--primary)]/10 text-[var(--primary)]">
            <Braces size={14} />
          </div>
          <span className="text-xs font-semibold text-[var(--text-primary)]">Snippets</span>
          <span className="rounded-full bg-[var(--surface-container)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)] border border-[var(--border)]">
            {snippets.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={openCreateModal}
            title="Create new snippet"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
          >
            <Plus size={14} />
            <span className="text-[11px]">New</span>
          </button>
          <button
            onClick={toggleSidebar}
            title="Collapse snippets sidebar (Alt+S)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors"
          >
            <PanelRightClose size={15} />
          </button>
        </div>
      </div>

      {/* ── Multi-Terminal Sync Adaptation Status Banner ──────────────────── */}
      <div className="border-b border-[var(--border)] p-2.5 bg-[var(--surface-low)]">
        {!hasConnectedTerminal ? (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-xs text-[var(--warning)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-[11px]">No Active Session</p>
              <p className="text-[10px] text-[var(--warning)]/80 mt-0.5 leading-tight">
                Connect a server to run snippets directly into the shell.
              </p>
            </div>
          </div>
        ) : isMultiTerminal ? (
          /* Multi-Terminal: Sync vs Non-Sync Adaptation */
          <div
            className={`rounded-lg border p-2 transition-colors ${
              isBroadcast
                ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                : "border-[var(--border)] bg-[var(--surface-container)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <Radio
                  size={12}
                  className={`shrink-0 ${
                    isBroadcast
                      ? "text-[var(--primary)] animate-pulse"
                      : "text-[var(--text-muted)]"
                  }`}
                />
                <span
                  className={`font-semibold text-[10px] uppercase tracking-wider ${
                    isBroadcast ? "text-[var(--primary)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {isBroadcast ? "Multi-Terminal Sync Active" : "Single Terminal Mode"}
                </span>
              </div>

              {/* Quick Sync Toggle Button */}
              <button
                onClick={() => toggleGroupBroadcast(activeGroupId || undefined)}
                title={
                  isBroadcast
                    ? "Turn off Sync (Alt+B)"
                    : `Sync and mirror commands to all ${connectedLeafTabs.length} terminals (Alt+B)`
                }
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium transition-colors ${
                  isBroadcast
                    ? "bg-[var(--primary)] text-black hover:bg-[var(--primary-hover)] shadow-xs"
                    : "border border-[var(--border)] bg-[var(--surface-high)] text-[var(--text-primary)] hover:border-[var(--primary)]/50 hover:text-[var(--primary)]"
                }`}
              >
                {isBroadcast ? (
                  <>
                    <Unlink size={10} />
                    <span>SYNC ON</span>
                  </>
                ) : (
                  <>
                    <Radio size={10} />
                    <span>ENABLE SYNC</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[10px] text-[var(--text-muted)] mt-1.5 leading-tight">
              {isBroadcast ? (
                <span>
                  Running snippets will execute on{" "}
                  <strong className="text-[var(--primary)]">all {connectedLeafTabs.length}</strong>{" "}
                  split terminals simultaneously.
                </span>
              ) : (
                <span>
                  Targeting focused terminal:{" "}
                  <strong className="text-[var(--text-primary)]">
                    {activeTab?.hostLabel || "Active Pane"}
                  </strong>{" "}
                  ({connectedLeafTabs.length} split panes open).
                </span>
              )}
            </p>
          </div>
        ) : (
          /* Single Active Terminal */
          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] shrink-0" />
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-[var(--text-primary)] truncate block">
                  {activeTab?.hostLabel || "Connected"}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] truncate block">
                  {activeTab?.hostAddress}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-sans">
              Single Term
            </span>
          </div>
        )}
      </div>

      {/* ── Search & Tag Filter ───────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] p-2.5 flex flex-col gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search snippets..."
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-container)] pl-8 pr-7 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              onClick={() => setSelectedTag(null)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 transition-colors ${
                selectedTag === null
                  ? "bg-[var(--primary)] text-black"
                  : "bg-[var(--surface-container)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag((prev) => (prev === tag ? null : tag))}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 transition-colors ${
                  selectedTag === tag
                    ? "bg-[var(--primary)] text-black"
                    : "bg-[var(--surface-container)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Tag size={9} />
                <span>{tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Snippets List ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {isLoading && snippets.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-xs text-[var(--text-muted)] gap-2">
            <Loader2 size={16} className="animate-spin text-[var(--primary)]" />
            <span>Loading library...</span>
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-[var(--text-muted)] px-3">
            <Braces size={28} className="mb-2 opacity-30" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {snippets.length === 0 ? "No snippets created yet" : "No snippets match search"}
            </p>
            <p className="text-[11px] mt-1 text-[var(--text-muted)]">
              {snippets.length === 0
                ? "Save commands you use often and execute them with 1 click."
                : "Try a different search keyword or tag."}
            </p>
            {snippets.length === 0 && (
              <button
                onClick={openCreateModal}
                className="mt-3 flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-black hover:bg-[var(--primary-hover)] transition-colors shadow-xs"
              >
                <Plus size={13} />
                <span>Add First Snippet</span>
              </button>
            )}
          </div>
        ) : (
          filteredSnippets.map((snippet) => (
            <SidebarSnippetCard
              key={snippet.id}
              snippet={snippet}
              hasActiveTerminal={hasConnectedTerminal}
              isMultiTerminal={isMultiTerminal}
              isSyncActive={isBroadcast}
              connectedCount={connectedLeafTabs.length}
              activeHostLabel={activeTab?.hostLabel || "Active"}
              feedback={runFeedback?.id === snippet.id ? runFeedback : null}
              isCopied={copiedId === snippet.id}
              onExecute={handleExecute}
              onCopy={handleCopy}
              onEdit={openEditModal}
              onDelete={handleDelete}
              onContextMenu={handleSnippetContextMenu}
            />
          ))
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "snippet" && contextMenu.snippet ? (
            <>
              {/* Run */}
              <button
                onClick={() => {
                  handleExecute(contextMenu.snippet!, "auto");
                  setContextMenu(null);
                }}
                disabled={!hasConnectedTerminal}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group disabled:opacity-40 disabled:pointer-events-none"
              >
                <Play size={13} />
                <span>
                  {isMultiTerminal && isBroadcast
                    ? `Run on All (${connectedLeafTabs.length})`
                    : "Run in Terminal"}
                </span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Copy Command */}
              <button
                onClick={() => {
                  handleCopy(contextMenu.snippet!.id, contextMenu.snippet!.command);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Copy size={13} />
                <span>Copy Command</span>
              </button>

              {/* Edit */}
              <button
                onClick={() => {
                  openEditModal(contextMenu.snippet!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Pencil size={13} />
                <span>Edit Snippet</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Delete */}
              <button
                onClick={() => {
                  handleDelete(contextMenu.snippet!.id, contextMenu.snippet!.title);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group"
              >
                <Trash2 size={13} />
                <span>Delete Snippet</span>
              </button>
            </>
          ) : (
            <>
              {/* New Snippet */}
              <button
                onClick={() => {
                  openCreateModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
              >
                <Plus size={13} />
                <span>New Snippet</span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED SIDEBAR SNIPPET ITEM CARD
// ══════════════════════════════════════════════════════════════════════════════

interface SidebarSnippetCardProps {
  snippet: Snippet;
  hasActiveTerminal: boolean;
  isMultiTerminal: boolean;
  isSyncActive: boolean;
  connectedCount: number;
  activeHostLabel: string;
  feedback: { message: string; ok: boolean } | null;
  isCopied: boolean;
  onExecute: (snippet: Snippet, mode: "auto" | "broadcast" | "single") => void;
  onCopy: (id: string, text: string) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (id: string, title?: string) => void;
  onContextMenu?: (e: React.MouseEvent, snippet: Snippet) => void;
}

const SidebarSnippetCard = memo(function SidebarSnippetCard({
  snippet,
  hasActiveTerminal,
  isMultiTerminal,
  isSyncActive,
  connectedCount,
  activeHostLabel,
  feedback,
  isCopied,
  onExecute,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: SidebarSnippetCardProps) {
  const isSecret = snippet.tags.some((t) => t.toLowerCase() === "secret");
  const [isRevealed, setIsRevealed] = useState(false);
  const displayTags = snippet.tags.filter((t) => t.toLowerCase() !== "secret");

  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, snippet)}
      className="group/item flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-container)] p-2.5 hover:border-[var(--border-subtle)] transition-all shadow-xs"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between mb-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 pr-1">
          <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {snippet.title}
          </h4>
          {isSecret && (
            <span
              title="Secret snippet: command text is masked by default"
              className="flex items-center gap-1 rounded bg-[var(--warning)]/15 border border-[var(--warning)]/30 px-1.5 py-0.2 text-[9px] font-mono text-[var(--warning)] font-semibold shrink-0"
            >
              <Lock size={9} />
              <span>SECRET</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover/item:opacity-100 transition-opacity">
          {isSecret && (
            <button
              onClick={() => setIsRevealed((prev) => !prev)}
              title={isRevealed ? "Hide secret command" : "Reveal secret command"}
              className={`rounded p-1 transition-colors ${
                isRevealed
                  ? "text-[var(--warning)] bg-[var(--warning)]/15"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]"
              }`}
            >
              {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          )}
          <button
            onClick={() => onCopy(snippet.id, snippet.command)}
            title={isCopied ? "Copied!" : "Copy command to clipboard"}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] transition-colors"
          >
            {isCopied ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
          </button>
          <button
            onClick={() => onEdit(snippet)}
            title="Edit snippet"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => onDelete(snippet.id, snippet.title)}
            title="Delete snippet"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Command Code Preview */}
      <div className="relative mb-2">
        <pre className="max-h-20 overflow-y-auto rounded bg-[var(--canvas)] border border-[var(--border)] p-1.5 text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all leading-tight select-text">
          {isSecret && !isRevealed ? (
            <span className="tracking-widest text-[var(--text-muted)] select-none font-sans font-bold text-xs">
              ••••••••••••••••••••
            </span>
          ) : (
            snippet.command
          )}
        </pre>
      </div>

      {/* Tags */}
      {displayTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {displayTags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-[var(--surface-high)] px-1.5 py-0.2 text-[9px] font-mono text-[var(--text-muted)]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Execution Action Button(s) */}
      <div className="mt-auto flex flex-col gap-1">
        {feedback ? (
          <div
            className={`flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-semibold font-mono animate-in fade-in duration-150 ${
              feedback.ok
                ? "bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/30"
                : "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/30"
            }`}
          >
            {feedback.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span className="truncate">{feedback.message}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {/* Primary Action Button */}
            <button
              onClick={() => onExecute(snippet, "auto")}
              disabled={!hasActiveTerminal}
              title={
                !hasActiveTerminal
                  ? "Connect to a terminal session first"
                  : isMultiTerminal && isSyncActive
                  ? `Broadcast to all ${connectedCount} terminals`
                  : `Run in ${activeHostLabel}`
              }
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isMultiTerminal && isSyncActive
                  ? "bg-[var(--primary)] text-black hover:bg-[var(--primary-hover)] shadow-xs"
                  : "bg-[var(--surface-high)] text-[var(--primary)] border border-[var(--border)] hover:bg-[var(--primary)] hover:text-black hover:border-[var(--primary)]"
              }`}
            >
              {isMultiTerminal && isSyncActive ? (
                <>
                  <Radio size={12} className="animate-pulse" />
                  <span>Run on All ({connectedCount})</span>
                </>
              ) : (
                <>
                  <Play size={11} />
                  <span>Run in Terminal</span>
                </>
              )}
            </button>

            {/* If in Multi-terminal mode, offer the alternative execution target */}
            {isMultiTerminal && hasActiveTerminal && (
              <button
                onClick={() => onExecute(snippet, isSyncActive ? "single" : "broadcast")}
                title={
                  isSyncActive
                    ? `Run only in active terminal (${activeHostLabel})`
                    : `Broadcast to all ${connectedCount} terminals`
                }
                className="flex items-center justify-center rounded px-2 py-1.5 text-[10px] font-mono border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-high)] transition-colors shrink-0"
              >
                {isSyncActive ? "Active only" : `All (${connectedCount})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
