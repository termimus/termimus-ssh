import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Server,
  Loader2,
  AlertCircle,
  Unplug,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SelectMods, useSftpStore } from "../../stores/useSftpStore";
import { useHostStore } from "../../stores/useHostStore";
import { FilePane } from "./FilePane";
import { FileEditorModal } from "./FileEditorModal";
import { FileEntry } from "../../lib/api";
import { CustomSelect } from "../ui/CustomSelect";

function transferButtonTitle(files: FileEntry[], verb: "Upload" | "Download"): string {
  if (files.length === 0) {
    return `Select ${verb === "Upload" ? "local" : "remote"} items to ${verb.toLowerCase()}`;
  }
  if (files.length === 1) {
    const first = files[0];
    return first.is_dir
      ? `${verb} folder "${first.name}" (recursive)`
      : `${verb} "${first.name}"`;
  }
  const dirCount = files.filter((f) => f.is_dir).length;
  const fileCount = files.length - dirCount;
  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? "s" : ""}`);
  if (dirCount > 0) parts.push(`${dirCount} folder${dirCount > 1 ? "s" : ""}`);
  return `${verb} ${parts.join(" & ")} (folders recursive)`;
}

export function SftpView() {
  const hosts = useHostStore((s) => s.hosts);
  const [editingFile, setEditingFile] = useState<{ file: FileEntry; isRemote: boolean } | null>(
    null
  );

  // Shallow subscription: progress ticks during transfers must not re-render
  // this tree just because the whole state object is new.
  const {
    remoteHost,
    remoteSessionId,
    remotePath,
    remoteEntries,
    remoteLoading,
    selectedRemoteFiles,
    localPath,
    localEntries,
    localLoading,
    selectedLocalFiles,
    transferring,
    transferMessage,
    transferProgress,
    error,
    initLocal,
    navigateLocal,
    selectFiles,
    setSelection,
    clearSelection,
    selectAll,
    createLocalFolder,
    deleteLocalItems,
    connectRemote,
    navigateRemote,
    createRemoteFolder,
    deleteRemoteItems,
    disconnectRemote,
    uploadSelected,
    downloadSelected,
    cancelTransfer,
  } = useSftpStore(
    useShallow((s) => ({
      remoteHost: s.remoteHost,
      remoteSessionId: s.remoteSessionId,
      remotePath: s.remotePath,
      remoteEntries: s.remoteEntries,
      remoteLoading: s.remoteLoading,
      selectedRemoteFiles: s.selectedRemoteFiles,
      localPath: s.localPath,
      localEntries: s.localEntries,
      localLoading: s.localLoading,
      selectedLocalFiles: s.selectedLocalFiles,
      transferring: s.transferring,
      transferMessage: s.transferMessage,
      transferProgress: s.transferProgress,
      error: s.error,
      initLocal: s.initLocal,
      navigateLocal: s.navigateLocal,
      selectFiles: s.selectFiles,
      setSelection: s.setSelection,
      clearSelection: s.clearSelection,
      selectAll: s.selectAll,
      createLocalFolder: s.createLocalFolder,
      deleteLocalItems: s.deleteLocalItems,
      connectRemote: s.connectRemote,
      navigateRemote: s.navigateRemote,
      createRemoteFolder: s.createRemoteFolder,
      deleteRemoteItems: s.deleteRemoteItems,
      disconnectRemote: s.disconnectRemote,
      uploadSelected: s.uploadSelected,
      downloadSelected: s.downloadSelected,
      cancelTransfer: s.cancelTransfer,
    }))
  );

  // Stable pane callbacks. FilePane and its rows are memoized on handler
  // identity, so inline arrows in the JSX below would defeat that and
  // re-render every visible row on each store update.
  const handleConnectHost = useCallback(
    (hostId: string) => {
      const host = hosts.find((h) => h.id === hostId);
      if (host) connectRemote(host);
    },
    [hosts, connectRemote]
  );

  const selectLocal = useCallback(
    (entry: FileEntry, mods: SelectMods, ordered: FileEntry[]) =>
      selectFiles("local", entry, mods, ordered),
    [selectFiles]
  );
  const selectRemote = useCallback(
    (entry: FileEntry, mods: SelectMods, ordered: FileEntry[]) =>
      selectFiles("remote", entry, mods, ordered),
    [selectFiles]
  );

  const replaceLocalSelection = useCallback(
    (entries: FileEntry[]) => setSelection("local", entries),
    [setSelection]
  );
  const replaceRemoteSelection = useCallback(
    (entries: FileEntry[]) => setSelection("remote", entries),
    [setSelection]
  );

  const clearLocalSelection = useCallback(() => clearSelection("local"), [clearSelection]);
  const clearRemoteSelection = useCallback(() => clearSelection("remote"), [clearSelection]);

  const selectAllLocal = useCallback(
    (entries: FileEntry[]) => selectAll("local", entries),
    [selectAll]
  );
  const selectAllRemote = useCallback(
    (entries: FileEntry[]) => selectAll("remote", entries),
    [selectAll]
  );

  const refreshLocal = useCallback(() => navigateLocal(localPath), [navigateLocal, localPath]);
  const refreshRemote = useCallback(() => navigateRemote(remotePath), [navigateRemote, remotePath]);

  const openLocalFile = useCallback(
    (entry: FileEntry) => setEditingFile({ file: entry, isRemote: false }),
    []
  );
  const openRemoteFile = useCallback(
    (entry: FileEntry) => setEditingFile({ file: entry, isRemote: true }),
    []
  );

  const transferLocal = useCallback((entries: FileEntry[]) => uploadSelected(entries), [uploadSelected]);
  const transferRemote = useCallback(
    (entries: FileEntry[]) => downloadSelected(entries),
    [downloadSelected]
  );

  useEffect(() => {
    initLocal();
  }, [initLocal]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-3">
      {/* Top SFTP Control Bar */}
      <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--accent)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Remote Server:
            </span>
          </div>
          <div className="w-64 sm:w-80">
            <CustomSelect
              value={remoteHost?.id ?? ""}
              onChange={handleConnectHost}
              disabled={remoteLoading || transferring}
              placeholder="Select a host to connect..."
              options={[
                { value: "", label: "Select a host to connect..." },
                ...hosts.map((h) => ({
                  value: h.id,
                  label: h.label,
                  description: `(${h.username}@${h.address})`,
                })),
              ]}
            />
          </div>

          {remoteSessionId && (
            <button
              onClick={disconnectRemote}
              title="Disconnect SFTP"
              className="flex items-center gap-1 rounded bg-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-white"
            >
              <Unplug size={12} /> Disconnect
            </button>
          )}
        </div>

        {/* Transfer Status Banner */}
        {transferring && (
          <div className="flex items-center gap-2 text-xs text-[var(--accent)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{transferMessage}</span>
            {transferProgress && transferProgress.total > 0 && (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {transferProgress.done}/{transferProgress.total}
              </span>
            )}
            <button
              onClick={cancelTransfer}
              title="Cancel transfer"
              className="flex items-center gap-1 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-white"
            >
              <X size={10} /> Cancel
            </button>
          </div>
        )}
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          <AlertCircle size={14} className="shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {/* Dual Pane + Center Transfer Buttons */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        {/* Left Pane: Local Files */}
        <FilePane
          title="Local Machine"
          subtitle={localPath}
          path={localPath}
          entries={localEntries}
          loading={localLoading}
          selectedFiles={selectedLocalFiles}
          onSelect={selectLocal}
          onSelectionReplace={replaceLocalSelection}
          onClearSelection={clearLocalSelection}
          onSelectAll={selectAllLocal}
          onNavigate={navigateLocal}
          onCreateFolder={createLocalFolder}
          onDeleteItems={deleteLocalItems}
          onRefresh={refreshLocal}
          onOpenFile={openLocalFile}
          onTransfer={transferLocal}
        />

        {/* Center Transfer Buttons */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-2 px-1">
          <button
            onClick={() => uploadSelected()}
            disabled={
              selectedLocalFiles.length === 0 || !remoteSessionId || transferring
            }
            title={transferButtonTitle(selectedLocalFiles, "Upload")}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-md transition hover:bg-[var(--accent-hover)] disabled:opacity-20"
          >
            <ArrowRight size={16} />
          </button>

          <button
            onClick={() => downloadSelected()}
            disabled={
              selectedRemoteFiles.length === 0 || !remoteSessionId || transferring
            }
            title={transferButtonTitle(selectedRemoteFiles, "Download")}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-md transition hover:bg-[var(--accent-hover)] disabled:opacity-20"
          >
            <ArrowLeft size={16} />
          </button>
        </div>

        {/* Right Pane: Remote Server Files */}
        <FilePane
          title={remoteHost ? remoteHost.label : "Remote Server"}
          subtitle={
            remoteHost
              ? `${remoteHost.username}@${remoteHost.address}`
              : "No connection"
          }
          path={remotePath}
          entries={remoteEntries}
          loading={remoteLoading}
          selectedFiles={selectedRemoteFiles}
          onSelect={selectRemote}
          onSelectionReplace={replaceRemoteSelection}
          onClearSelection={clearRemoteSelection}
          onSelectAll={selectAllRemote}
          onNavigate={navigateRemote}
          onCreateFolder={createRemoteFolder}
          onDeleteItems={deleteRemoteItems}
          onRefresh={refreshRemote}
          onOpenFile={openRemoteFile}
          disabled={!remoteSessionId}
          onTransfer={transferRemote}
        />
      </div>

      {/* In-App SFTP File Editor Modal */}
      {editingFile && (
        <FileEditorModal
          file={editingFile.file}
          isRemote={editingFile.isRemote}
          sessionId={remoteSessionId}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            if (editingFile.isRemote) {
              navigateRemote(remotePath);
            } else {
              navigateLocal(localPath);
            }
          }}
        />
      )}
    </div>
  );
}
