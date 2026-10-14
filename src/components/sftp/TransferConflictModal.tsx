import { useEffect } from "react";
import { AlertTriangle, File, Folder } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSftpStore } from "../../stores/useSftpStore";
import { formatBytes, formatDate } from "../../lib/format";

/**
 * Asked once per planned destination that already exists on the other side.
 * Ignore skips the item, Replace overwrites it, Replace All answers Replace
 * for every remaining conflict so the loop ends early.
 */
export function TransferConflictModal() {
  const { pendingConflicts, resolveConflict } = useSftpStore(
    useShallow((s) => ({
      pendingConflicts: s.pendingConflicts,
      resolveConflict: s.resolveConflict,
    }))
  );

  // Escape aborts the whole transfer, matching the Cancel button
  useEffect(() => {
    if (!pendingConflicts) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        resolveConflict("cancel");
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [pendingConflicts, resolveConflict]);

  if (!pendingConflicts) return null;

  const item = pendingConflicts.items[pendingConflicts.index];
  const isLast = pendingConflicts.index >= pendingConflicts.items.length - 1;
  const existing = item.existing;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer conflict"
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/15 text-[var(--warning)]">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {item.isDir ? "Folder already exists" : "File already exists"}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Conflict {pendingConflicts.index + 1} of {pendingConflicts.items.length}
            </p>
          </div>
        </div>

        {/* Conflicting item */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            {item.isDir ? (
              <Folder size={14} className="shrink-0 text-[var(--accent)]" />
            ) : (
              <File size={14} className="shrink-0 text-[var(--text-muted)]" />
            )}
            <span className="truncate text-xs font-semibold font-mono text-[var(--text-primary)]">
              {item.name}
            </span>
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-muted)]">Transfer from</span>
              <span className="truncate font-mono text-[var(--text-secondary)]" title={item.from}>
                {item.from}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-muted)]">Destination</span>
              <span className="truncate font-mono text-[var(--text-secondary)]" title={item.to}>
                {item.to}
              </span>
            </div>
            {!item.isDir && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-muted)]">Size</span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {formatBytes(item.size)}
                  {existing && existing.size !== item.size
                    ? ` (existing: ${formatBytes(existing.size)})`
                    : ""}
                </span>
              </div>
            )}
            {existing?.modified != null && !item.isDir && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-muted)]">Existing modified</span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {formatDate(existing.modified)}
                </span>
              </div>
            )}
          </div>
        </div>

        {item.isDir && (
          <p className="mb-3 text-[11px] text-[var(--text-muted)]">
            Replace merges the contents of both folders: files with the same name are overwritten,
            other files are kept.
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3.5">
          <button
            type="button"
            onClick={() => resolveConflict("cancel")}
            className="rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 transition"
          >
            Cancel Transfer
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolveConflict("ignore")}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-white transition"
            >
              Ignore
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => resolveConflict("replace")}
              className="rounded-xl bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-[var(--on-primary)] shadow-sm hover:bg-[var(--primary-hover)] transition"
            >
              Replace
            </button>
            {!isLast && (
              <button
                type="button"
                onClick={() => resolveConflict("replaceAll")}
                className="rounded-xl border border-[var(--primary)]/40 px-3.5 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/10 transition"
              >
                Replace All
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
