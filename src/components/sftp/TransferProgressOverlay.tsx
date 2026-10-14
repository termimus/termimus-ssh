import { Loader2, X } from "lucide-react";
import { useSftpStore } from "../../stores/useSftpStore";
import { formatBytes } from "../../lib/format";

/**
 * Floating transfer indicator pinned to the top-right of the SFTP view.
 * Subscribes to the store directly so progress ticks (~10/s) re-render only
 * this widget and never the panes or the control bar.
 */
export function TransferProgressOverlay() {
  const transferring = useSftpStore((s) => s.transferring);
  const progress = useSftpStore((s) => s.transferProgress);
  const message = useSftpStore((s) => s.transferMessage);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);

  if (!transferring) return null;

  const percent =
    progress && progress.bytesTotal > 0
      ? Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100))
      : 0;
  const scanning = !progress;

  return (
    <div className="absolute right-3 top-3 z-30 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 select-none">
      <div className="flex items-center gap-2">
        <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {scanning ? "Preparing transfer..." : `Transfer ${percent}%`}
        </span>
        <button
          onClick={cancelTransfer}
          title="Cancel transfer"
          className="ml-auto flex shrink-0 items-center gap-1 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-white"
        >
          <X size={10} /> Cancel
        </button>
      </div>

      {/* Bar: indeterminate pulse while scanning, byte-accurate afterwards */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        {scanning ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--primary)]/60" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150 ease-linear"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--text-muted)]">
        <span>
          {progress ? `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}` : ""}
        </span>
        {progress && progress.total > 0 && (
          <span>
            {progress.done}/{progress.total} files
          </span>
        )}
      </div>

      <div className="mt-1 truncate text-[10px] text-[var(--text-muted)]" title={message ?? ""}>
        {progress?.currentFile?.name ?? message}
      </div>
    </div>
  );
}
