import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowLeft,
  Server,
  AlertCircle,
  Unplug,
  HardDrive,
  Upload,
  Download,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SelectMods, useSftpStore } from "../../stores/useSftpStore";
import { useHostStore } from "../../stores/useHostStore";
import { useDeviceLayout } from "../../hooks/useDeviceLayout";
import { FilePane } from "./FilePane";
import { FileEditorModal } from "./FileEditorModal";
import { TransferConflictModal } from "./TransferConflictModal";
import { TransferProgressOverlay } from "./TransferProgressOverlay";
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
  const { t } = useTranslation();
  const { isMobile } = useDeviceLayout();
  const [mobileTab, setMobileTab] = useState<"remote" | "local">("remote");
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-3">
      {/* Floating transfer progress widget (top-right, self-subscribing) */}
      <TransferProgressOverlay />

      {/* Top SFTP Control Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--accent)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Remote Server:
            </span>
          </div>
          <div className="w-56 sm:w-80">
            <CustomSelect
              value={remoteHost?.id ?? ""}
              onChange={handleConnectHost}
              disabled={remoteLoading || transferring}
              placeholder={t("sftp.selectHost")}
              searchable
              options={[
                { value: "", label: t("sftp.selectHost") },
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
              className="flex items-center gap-1 rounded bg-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-white cursor-pointer"
            >
              <Unplug size={12} /> {t("common.close")}
            </button>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          <AlertCircle size={14} className="shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {/* Mobile Mode: Segmented Pane Switcher */}
      {isMobile && (
        <div className="flex w-full shrink-0 rounded-xl bg-[var(--surface-container)] p-1 border border-[var(--border)] mb-2 select-none">
          <button
            type="button"
            onClick={() => setMobileTab("remote")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              mobileTab === "remote"
                ? "bg-[var(--primary)] text-black shadow-xs font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Server size={13} />
            <span className="truncate max-w-[130px]">{remoteHost ? remoteHost.label : t("sftp.remote")}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("local")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              mobileTab === "local"
                ? "bg-[var(--primary)] text-black shadow-xs font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <HardDrive size={13} />
            <span>{t("sftp.local")}</span>
          </button>
        </div>
      )}

      {/* Pane Viewport */}
      {isMobile ? (
        // Mobile Single Pane View
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {mobileTab === "remote" ? (
              <FilePane
                title={remoteHost ? remoteHost.label : t("sftp.remote")}
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
            ) : (
              <FilePane
                title={t("sftp.local")}
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
            )}
          </div>

          {/* Floating Mobile Action Bar when items are selected */}
          {mobileTab === "remote" && selectedRemoteFiles.length > 0 && (
            <div className="mt-2 flex shrink-0 items-center justify-between rounded-xl bg-[var(--surface-container)] border border-[var(--border)] p-2 shadow-lg">
              <span className="text-xs text-[var(--text-secondary)] font-mono">
                {selectedRemoteFiles.length} item{selectedRemoteFiles.length > 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                onClick={() => downloadSelected()}
                disabled={transferring || !remoteSessionId}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90 active:scale-95 disabled:opacity-40 cursor-pointer"
              >
                <Download size={13} />
                <span>Download to Local</span>
              </button>
            </div>
          )}

          {mobileTab === "local" && selectedLocalFiles.length > 0 && (
            <div className="mt-2 flex shrink-0 items-center justify-between rounded-xl bg-[var(--surface-container)] border border-[var(--border)] p-2 shadow-lg">
              <span className="text-xs text-[var(--text-secondary)] font-mono">
                {selectedLocalFiles.length} item{selectedLocalFiles.length > 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                onClick={() => uploadSelected()}
                disabled={transferring || !remoteSessionId}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90 active:scale-95 disabled:opacity-40 cursor-pointer"
              >
                <Upload size={13} />
                <span>Upload to Server</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        // Desktop / Tablet Dual Pane Side-by-Side
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          {/* Left Pane: Local Files */}
          <FilePane
            title={t("sftp.local")}
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
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-md transition hover:bg-[var(--accent-hover)] disabled:opacity-20 cursor-pointer"
            >
              <ArrowRight size={16} />
            </button>

            <button
              onClick={() => downloadSelected()}
              disabled={
                selectedRemoteFiles.length === 0 || !remoteSessionId || transferring
              }
              title={transferButtonTitle(selectedRemoteFiles, "Download")}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-md transition hover:bg-[var(--accent-hover)] disabled:opacity-20 cursor-pointer"
            >
              <ArrowLeft size={16} />
            </button>
          </div>

          {/* Right Pane: Remote Server Files */}
          <FilePane
            title={remoteHost ? remoteHost.label : t("sftp.remote")}
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
      )}

      {/* Transfer-conflict modal (self-subscribing, renders null when idle) */}
      <TransferConflictModal />

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
