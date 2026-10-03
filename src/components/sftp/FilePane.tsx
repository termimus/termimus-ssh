import { useState, useCallback, useMemo, memo, useEffect, useRef } from "react";
import {
  Folder,
  File,
  CornerLeftUp,
  RotateCw,
  FolderPlus,
  Trash2,
  Loader2,
  FileCode,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Search,
  X,
} from "lucide-react";
import { FileEntry } from "../../lib/api";
import { formatBytes, formatDate, parentPath } from "../../lib/format";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { SelectMods } from "../../stores/useSftpStore";

interface FilePaneProps {
  title: string;
  subtitle?: string;
  path: string;
  entries: FileEntry[];
  loading: boolean;
  selectedFiles: FileEntry[];
  /** Row click with modifier keys; orderedEntries is the visible sorted list for shift-range */
  onSelect: (entry: FileEntry, mods: SelectMods, orderedEntries: FileEntry[]) => void;
  onSelectionReplace: (entries: FileEntry[]) => void;
  onClearSelection: () => void;
  onSelectAll: (entries: FileEntry[]) => void;
  onNavigate: (path: string) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteItems: (entries: FileEntry[]) => Promise<void>;
  onRefresh: () => void;
  onOpenFile?: (entry: FileEntry) => void;
  disabled?: boolean;
  onTransfer?: (entries: FileEntry[]) => void;
}

type SortKey = "name" | "size" | "modified" | "kind";
type SortDir = "asc" | "desc";

function SortHeaderCell({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = sortKey === columnKey;
  return (
    <th
      className={`cursor-pointer py-1.5 select-none transition-colors hover:text-[var(--text-primary)] ${
        className ?? ""
      }`}
      onClick={() => onSort(columnKey)}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive &&
          (sortDir === "asc" ? (
            <ArrowUp size={10} className="text-[var(--primary)]" />
          ) : (
            <ArrowDown size={10} className="text-[var(--primary)]" />
          ))}
      </span>
    </th>
  );
}

export function FilePane({
  title,
  subtitle,
  path,
  entries,
  loading,
  selectedFiles,
  onSelect,
  onSelectionReplace,
  onClearSelection,
  onSelectAll,
  onNavigate,
  onCreateFolder,
  onDeleteItems,
  onRefresh,
  onOpenFile,
  disabled = false,
  onTransfer,
}: FilePaneProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "entry" | "background";
    entry?: FileEntry;
  } | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  // Filter hanya berlaku untuk listing tempat ia diketik, jadi buang saat pindah direktori
  useEffect(() => {
    setFilterQuery("");
    setIsFilterOpen(false);
  }, [path]);

  const handleSortClick = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const filteredEntries = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, filterQuery]);

  const sortedEntries = useMemo(() => {
    const byName = (a: FileEntry, b: FileEntry) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    const comparators: Record<SortKey, (a: FileEntry, b: FileEntry) => number> = {
      name: byName,
      size: (a, b) => a.size - b.size || byName(a, b),
      modified: (a, b) => (a.modified ?? 0) - (b.modified ?? 0) || byName(a, b),
      kind: (a, b) => (a.is_dir === b.is_dir ? 0 : a.is_dir ? -1 : 1) || byName(a, b),
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredEntries].sort((a, b) => {
      // Folders always listed before files, except when sorting by Kind itself
      if (sortKey !== "kind" && a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return comparators[sortKey](a, b) * dir;
    });
  }, [filteredEntries, sortKey, sortDir]);

  const selectedPaths = useMemo(
    () => new Set(selectedFiles.map((f) => f.path)),
    [selectedFiles]
  );

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  }, []);

  const handleEntryContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      e.stopPropagation();
      // Native behavior: right-clicking an unselected item selects just it
      if (!selectedPaths.has(entry.path)) {
        onSelectionReplace([entry]);
      }
      const x = Math.min(e.clientX, window.innerWidth - 220);
      const y = Math.min(e.clientY, window.innerHeight - 260);
      setContextMenu({ x, y, type: "entry", entry });
    },
    [selectedPaths, onSelectionReplace]
  );

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Only trigger on pane background (not on file rows which have their own handler)
    if (target.closest("tbody")) return;
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ x, y, type: "background" });
  }, []);

  // Click on empty pane area (outside rows/header) clears the selection
  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("tbody") || target.closest("thead")) return;
      onClearSelection();
    },
    [onClearSelection]
  );

  // Finder-style keyboard shortcuts, scoped to the pane that has focus
  const handlePaneKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        onSelectAll(sortedEntries);
      } else if (e.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        onClearSelection();
      }
    },
    [contextMenu, onClearSelection, onSelectAll, sortedEntries]
  );

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

  async function handleCreateFolderSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim());
    setNewFolderName("");
    setIsCreatingFolder(false);
  }

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, targets: FileEntry[]) => {
      e.stopPropagation();
      const single = targets.length === 1;
      const first = targets[0];
      const subject = single ? `"${first.name}"` : `${targets.length} selected items`;
      useConfirmStore.getState().confirm({
        title: single
          ? first.is_dir
            ? "Delete Folder"
            : "Delete File"
          : `Delete ${targets.length} Items`,
        message: `Are you sure you want to delete ${subject}${
          single && first.is_dir ? " and everything inside it" : ""
        }? This action cannot be undone.`,
        confirmLabel: "Delete",
        isDanger: true,
        onConfirm: async () => {
          await onDeleteItems(targets);
        },
      });
    },
    [onDeleteItems]
  );

  const handleRowClick = useCallback(
    (entry: FileEntry, mods: SelectMods) => {
      paneRef.current?.focus({ preventScroll: true });
      onSelect(entry, mods, sortedEntries);
    },
    [onSelect, sortedEntries]
  );

  // Stable adapter: the row-level trash button always deletes a single entry
  const handleRowDeleteClick = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      handleDeleteClick(e, [entry]);
    },
    [handleDeleteClick]
  );

  const handleRowDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (entry.is_dir) {
        onNavigate(entry.path);
      } else {
        onOpenFile?.(entry);
      }
    },
    [onNavigate, onOpenFile]
  );

  // Items the entry context menu acts on. Right-click already ensured the
  // clicked entry is part of the selection, so this is the selection itself.
  const menuTargets =
    contextMenu?.type === "entry" && contextMenu.entry
      ? selectedPaths.has(contextMenu.entry.path) && selectedFiles.length > 0
        ? selectedFiles
        : [contextMenu.entry]
      : [];
  const multiMenu = menuTargets.length > 1;
  const isLocalPane = title === "Local Machine";
  const transferLabel = multiMenu
    ? `${isLocalPane ? "Upload" : "Download"} ${menuTargets.length} Selected`
    : isLocalPane
      ? "Upload to Remote"
      : "Download to Local";

  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      onKeyDown={handlePaneKeyDown}
      onContextMenu={handlePaneContextMenu}
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--sidebar)] outline-none"
    >
      {/* Pane Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
              {title}
            </div>
            {subtitle && (
              <div className="truncate text-[10px] text-[var(--text-muted)]">
                {subtitle}
              </div>
            )}
          </div>
          {selectedFiles.length > 1 && (
            <span
              className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary)]"
              title={`${selectedFiles.length} items selected (⌘/Ctrl+A to select all, Esc to clear)`}
            >
              {selectedFiles.length} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (isFilterOpen) {
                setIsFilterOpen(false);
                setFilterQuery("");
              } else {
                setIsFilterOpen(true);
              }
            }}
            disabled={disabled}
            title="Filter files"
            aria-label="Filter files"
            className={`rounded p-1 hover:bg-[var(--border)] hover:text-white disabled:opacity-30 ${
              isFilterOpen ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
            }`}
          >
            <Search size={14} />
          </button>
          {isFilterOpen && (
            <div className="relative flex items-center">
              <input
                ref={filterInputRef}
                type="text"
                autoFocus
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilterQuery("");
                    setIsFilterOpen(false);
                  }
                }}
                placeholder="Filter..."
                aria-label="Filter files by name"
                className="w-28 rounded border border-[var(--border)] bg-[var(--background)] py-1 pl-2 pr-6 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none sm:w-40"
              />
              {filterQuery && (
                <button
                  onClick={() => {
                    setFilterQuery("");
                    filterInputRef.current?.focus();
                  }}
                  title="Clear filter"
                  aria-label="Clear filter"
                  className="absolute right-1 rounded p-0.5 text-[var(--text-muted)] hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => onNavigate(parentPath(path))}
            disabled={disabled || path === "/" || !path}
            title="Go up"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white disabled:opacity-30"
          >
            <CornerLeftUp size={14} />
          </button>
          <button
            onClick={() => setIsCreatingFolder((v) => !v)}
            disabled={disabled}
            title="New folder"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white disabled:opacity-30"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={onRefresh}
            disabled={disabled || loading}
            title="Refresh"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white disabled:opacity-30"
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Path Breadcrumb Bar */}
      <div className="border-b border-[var(--border)] bg-[var(--background)] px-3 py-1 text-[11px] font-mono text-[var(--text-muted)] truncate">
        {path || "/"}
      </div>

      {/* New Folder Inline Form */}
      {isCreatingFolder && (
        <form
          onSubmit={handleCreateFolderSubmit}
          className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--card)] p-2"
        >
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name..."
            className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="submit"
            className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs text-white"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingFolder(false)}
            className="text-xs text-[var(--text-muted)] hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* File Table */}
      <div className="flex-1 overflow-y-auto" onClick={handlePaneClick}>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--text-muted)]">
            <Loader2 size={18} className="animate-spin mr-2 text-[var(--accent)]" />
            Loading files...
          </div>
        ) : disabled ? (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--text-muted)]">
            Not connected
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--text-muted)]">
            Empty directory
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-xs text-[var(--text-muted)]">
            <Search size={16} className="opacity-50" />
            <span>
              No files matching "{filterQuery.trim()}"
            </span>
          </div>
        ) : (
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 bg-[var(--sidebar)] text-[10px] uppercase text-[var(--text-muted)] border-b border-[var(--border)]">
              <tr>
                <SortHeaderCell
                  label="Name"
                  columnKey="name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                  className="pl-3"
                />
                <SortHeaderCell
                  label="Size"
                  columnKey="size"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                  className="pr-2 w-20 text-right"
                />
                <SortHeaderCell
                  label="Modified"
                  columnKey="modified"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                  className="pr-3 w-32 text-right"
                />
                <SortHeaderCell
                  label="Kind"
                  columnKey="kind"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                  className="pr-2 w-20 text-right"
                />
                <th className="py-1.5 pr-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  isSelected={selectedPaths.has(entry.path)}
                  onSelect={handleRowClick}
                  onDoubleClick={handleRowDoubleClick}
                  onOpenFile={onOpenFile}
                  onDelete={handleRowDeleteClick}
                  onContextMenu={handleEntryContextMenu}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "entry" && contextMenu.entry ? (
            <>
              {/* Open / Navigate */}
              <button
                onClick={() => {
                  const entry = contextMenu.entry!;
                  if (entry.is_dir) onNavigate(entry.path);
                  else onOpenFile?.(entry);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
              >
                {contextMenu.entry.is_dir ? (
                  <>
                    <Folder size={13} />
                    <span>Open Folder</span>
                  </>
                ) : (
                  <>
                    <FileCode size={13} />
                    <span>Edit File</span>
                  </>
                )}
              </button>

              {/* Transfer (Upload / Download), works for files and folders */}
              {onTransfer && (
                <button
                  onClick={() => {
                    onTransfer(menuTargets);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group"
                >
                  <ArrowRight size={13} />
                  <span>{transferLabel}</span>
                </button>
              )}

              {/* Copy Path(s) */}
              <button
                onClick={async () => {
                  const value =
                    menuTargets.length > 1
                      ? menuTargets.map((t) => t.path).join("\n")
                      : menuTargets[0]?.path ?? "";
                  await navigator.clipboard.writeText(value);
                  showCopyToast(
                    menuTargets.length > 1
                      ? `Copied ${menuTargets.length} paths`
                      : "Copied file path"
                  );
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group"
              >
                <Copy size={13} />
                <span>{multiMenu ? `Copy ${menuTargets.length} Paths` : "Copy Path"}</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Delete */}
              <button
                onClick={(e) => {
                  handleDeleteClick(e, menuTargets);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group"
              >
                <Trash2 size={13} />
                <span>
                  {multiMenu
                    ? `Delete ${menuTargets.length} Items`
                    : contextMenu.entry.is_dir
                      ? "Delete Folder"
                      : "Delete File"}
                </span>
              </button>
            </>
          ) : (
            <>
              {/* New Folder */}
              <button
                onClick={() => {
                  setIsCreatingFolder(true);
                  setContextMenu(null);
                }}
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group disabled:opacity-40 disabled:pointer-events-none"
              >
                <FolderPlus size={13} />
                <span>New Folder</span>
              </button>

              {/* Select All */}
              <button
                onClick={() => {
                  onSelectAll(sortedEntries);
                  setContextMenu(null);
                }}
                disabled={disabled || sortedEntries.length === 0}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group disabled:opacity-40 disabled:pointer-events-none"
              >
                <Check size={13} />
                <span>Select All</span>
              </button>

              {/* Refresh */}
              <button
                onClick={() => {
                  onRefresh();
                  setContextMenu(null);
                }}
                disabled={disabled || loading}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group disabled:opacity-40 disabled:pointer-events-none"
              >
                <RotateCw size={13} />
                <span>Refresh Directory</span>
              </button>

              {/* Copy Current Path */}
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(path || "/");
                  showCopyToast("Copied directory path");
                  setContextMenu(null);
                }}
                disabled={disabled || !path}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group disabled:opacity-40 disabled:pointer-events-none"
              >
                <Copy size={13} />
                <span>Copy Directory Path</span>
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
// MEMOIZED FILE ROW COMPONENT (High performance in directories with 1000+ items)
// ══════════════════════════════════════════════════════════════════════════════

interface FileRowProps {
  entry: FileEntry;
  isSelected: boolean;
  onSelect: (entry: FileEntry, mods: SelectMods) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onOpenFile?: (entry: FileEntry) => void;
  onDelete: (e: React.MouseEvent, entry: FileEntry) => void;
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry) => void;
}

const FileRow = memo(function FileRow({
  entry,
  isSelected,
  onSelect,
  onDoubleClick,
  onOpenFile,
  onDelete,
  onContextMenu,
}: FileRowProps) {
  return (
    <tr
      onClick={(e) =>
        onSelect(entry, { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey })
      }
      onDoubleClick={() => onDoubleClick(entry)}
      onContextMenu={(e) => onContextMenu?.(e, entry)}
      className={`group cursor-pointer select-none transition-colors border-b border-[var(--border)]/30 ${
        isSelected
          ? "bg-[var(--accent)]/20 text-[var(--text-primary)]"
          : "hover:bg-[var(--card)] text-[var(--text-primary)]"
      }`}
    >
      <td className="py-1.5 pl-3 flex min-w-0 items-center gap-2">
        {entry.is_dir ? (
          <Folder size={14} className="shrink-0 text-[var(--accent)]" />
        ) : (
          <File size={14} className="shrink-0 text-[var(--text-muted)]" />
        )}
        <span className="truncate">{entry.name}</span>
      </td>
      <td className="py-1.5 pr-2 text-right text-[11px] text-[var(--text-muted)]">
        {entry.is_dir ? "-" : formatBytes(entry.size)}
      </td>
      <td className="py-1.5 pr-3 text-right text-[11px] text-[var(--text-muted)]">
        {formatDate(entry.modified)}
      </td>
      <td className="py-1.5 pr-2 text-right text-[11px] text-[var(--text-muted)]">
        {entry.is_dir ? "Folder" : "File"}
      </td>
      <td className="py-1.5 pr-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {!entry.is_dir && onOpenFile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(entry);
              }}
              title="Edit file"
              className="rounded p-0.5 text-[var(--text-muted)] opacity-0 hover:text-[var(--primary)] hover:bg-[var(--border)] group-hover:opacity-100 hover:opacity-100 transition-opacity"
            >
              <FileCode size={13} />
            </button>
          )}
          <button
            onClick={(e) => onDelete(e, entry)}
            title="Delete"
            className="rounded p-0.5 text-[var(--text-muted)] opacity-0 hover:text-[var(--danger)] hover:bg-[var(--border)] group-hover:opacity-100 hover:opacity-100 transition-opacity"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
});
