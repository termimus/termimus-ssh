import { create } from "zustand";
import { api, FileEntry, Host } from "../lib/api";
import { parentPath } from "../lib/format";

export type SftpPane = "local" | "remote";

export interface SelectMods {
  /** Shift+click: extend selection as a range from the anchor */
  shift: boolean;
  /** Cmd (macOS) or Ctrl (Windows/Linux) click: toggle item in selection */
  mod: boolean;
}

interface TransferPlan {
  /** Destination directories to create, parents before children */
  dirs: string[];
  /** Files to transfer with structure preserved under the target dir */
  files: { from: string; to: string; name: string }[];
  /** Items that could not be scanned (unreadable subtrees etc.) */
  scanErrors: string[];
}

// Guard against symlink loops / pathological trees during recursive scans
const MAX_TRAVERSAL_DEPTH = 32;

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;

const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

/**
 * Walk the selected roots and produce a flat, ordered transfer plan.
 * Upload scans the local tree; download scans the remote tree.
 */
async function buildTransferPlan(
  direction: "upload" | "download",
  sessionId: string,
  roots: FileEntry[],
  targetDir: string
): Promise<TransferPlan> {
  const dirs: string[] = [];
  const files: { from: string; to: string; name: string }[] = [];
  const scanErrors: string[] = [];
  const visited = new Set<string>();

  const listChildren = (path: string): Promise<FileEntry[]> =>
    direction === "upload" ? api.listLocal(path) : api.listSftp(sessionId, path);

  const walkDir = async (entry: FileEntry, destDir: string, depth: number): Promise<void> => {
    if (depth > MAX_TRAVERSAL_DEPTH) {
      scanErrors.push(`${entry.path}: directory tree too deep (max ${MAX_TRAVERSAL_DEPTH})`);
      return;
    }
    if (visited.has(entry.path)) return; // already covered by another selected root
    visited.add(entry.path);

    const dest = joinPath(destDir, entry.name);
    dirs.push(dest);

    let children: FileEntry[];
    try {
      children = await listChildren(entry.path);
    } catch (e) {
      scanErrors.push(`${entry.path}: ${String(e)}`);
      return;
    }
    for (const child of children) {
      if (child.is_dir) {
        await walkDir(child, dest, depth + 1);
      } else {
        files.push({ from: child.path, to: joinPath(dest, child.name), name: child.name });
      }
    }
  };

  for (const root of roots) {
    if (root.is_dir) {
      await walkDir(root, targetDir, 0);
    } else {
      files.push({ from: root.path, to: joinPath(targetDir, root.name), name: root.name });
    }
  }

  // A selected folder and a file inside it may both be in the selection —
  // keep the first occurrence so the same destination is not written twice.
  const seen = new Set<string>();
  const uniqueFiles = files.filter((f) => (seen.has(f.to) ? false : (seen.add(f.to), true)));

  return { dirs, files: uniqueFiles, scanErrors };
}

/** Create a destination directory, tolerating "already exists". */
async function ensureDir(
  direction: "upload" | "download",
  sessionId: string,
  dir: string
): Promise<void> {
  try {
    if (direction === "upload") await api.mkdirSftp(sessionId, dir);
    else await api.mkdirLocal(dir);
  } catch (e) {
    // mkdir may fail because the directory already exists (most SFTP servers
    // return a generic failure for that). Verify via the parent listing.
    const parent = parentPath(dir);
    if (!parent || parent === dir) throw e;
    const siblings =
      direction === "upload" ? await api.listSftp(sessionId, parent) : await api.listLocal(parent);
    const exists = siblings.some((s) => s.name === baseName(dir) && s.is_dir);
    if (!exists) throw e;
  }
}

interface SftpState {
  // Remote state
  remoteHost: Host | null;
  remoteSessionId: string | null;
  remotePath: string;
  remoteEntries: FileEntry[];
  remoteLoading: boolean;
  selectedRemoteFiles: FileEntry[];
  remoteAnchorPath: string | null;

  // Local state
  localPath: string;
  localEntries: FileEntry[];
  localLoading: boolean;
  selectedLocalFiles: FileEntry[];
  localAnchorPath: string | null;

  // Transfer state
  transferring: boolean;
  transferMessage: string | null;
  transferProgress: { done: number; total: number } | null;
  cancelRequested: boolean;
  error: string | null;

  initLocal: () => Promise<void>;
  navigateLocal: (path: string) => Promise<void>;
  selectFiles: (
    pane: SftpPane,
    entry: FileEntry,
    mods: SelectMods,
    orderedEntries: FileEntry[]
  ) => void;
  setSelection: (pane: SftpPane, entries: FileEntry[]) => void;
  clearSelection: (pane: SftpPane) => void;
  selectAll: (pane: SftpPane, entries: FileEntry[]) => void;
  createLocalFolder: (name: string) => Promise<void>;
  deleteLocalItems: (entries: FileEntry[]) => Promise<void>;

  connectRemote: (host: Host) => Promise<void>;
  navigateRemote: (path: string) => Promise<void>;
  createRemoteFolder: (name: string) => Promise<void>;
  deleteRemoteItems: (entries: FileEntry[]) => Promise<void>;
  disconnectRemote: () => Promise<void>;

  uploadSelected: (entries?: FileEntry[]) => Promise<void>;
  downloadSelected: (entries?: FileEntry[]) => Promise<void>;
  cancelTransfer: () => void;
}

export const useSftpStore = create<SftpState>((set, get) => {
  const clearPaneSelection = (pane: SftpPane) => {
    if (pane === "local") set({ selectedLocalFiles: [], localAnchorPath: null });
    else set({ selectedRemoteFiles: [], remoteAnchorPath: null });
  };

  /** Execute a (possibly recursive) bulk transfer of the given roots. */
  const runTransfer = async (
    direction: "upload" | "download",
    sessionId: string,
    roots: FileEntry[],
    targetDir: string,
    refresh: () => Promise<void>
  ): Promise<void> => {
    if (roots.length === 0 || get().transferring) return;
    const verb = direction === "upload" ? "Uploading" : "Downloading";
    const mkDirVerb = direction === "upload" ? "Creating remote folder" : "Creating local folder";

    set({
      transferring: true,
      transferMessage: "Scanning selected items...",
      transferProgress: null,
      cancelRequested: false,
      error: null,
    });

    try {
      const plan = await buildTransferPlan(direction, sessionId, roots, targetDir);
      const failed: string[] = [...plan.scanErrors];
      const total = plan.files.length;
      let doneCount = 0;
      set({ transferProgress: { done: 0, total } });

      let cancelled = false;

      // 1) Create the directory structure (parents before children)
      for (const dir of plan.dirs) {
        if (get().cancelRequested) {
          cancelled = true;
          break;
        }
        set({ transferMessage: `${mkDirVerb}: ${dir}` });
        try {
          await ensureDir(direction, sessionId, dir);
        } catch (e) {
          failed.push(`${dir}: ${String(e)}`);
        }
      }

      // 2) Transfer files sequentially so the message tracks real progress
      if (!cancelled) {
        for (const file of plan.files) {
          if (get().cancelRequested) {
            cancelled = true;
            break;
          }
          set({
            transferMessage: `${verb}: ${file.name}`,
            transferProgress: { done: doneCount, total },
          });
          try {
            if (direction === "upload") await api.uploadSftp(sessionId, file.from, file.to);
            else await api.downloadSftp(sessionId, file.from, file.to);
            doneCount++;
          } catch (e) {
            failed.push(`${file.from}: ${String(e)}`);
          }
        }
      }

      set({ transferProgress: { done: doneCount, total } });
      await refresh();

      if (cancelled) {
        set({
          error: `Transfer cancelled at ${doneCount}/${total}.${
            failed.length > 0 ? ` ${failed.length} item(s) had failed before cancellation.` : ""
          }`,
        });
      } else if (failed.length > 0) {
        const sample = failed.slice(0, 5).join("\n");
        const more = failed.length > 5 ? `\n...and ${failed.length - 5} more` : "";
        set({ error: `${failed.length} item(s) failed to transfer:\n${sample}${more}` });
      }
    } finally {
      set({ transferring: false, transferMessage: null, transferProgress: null, cancelRequested: false });
    }
  };

  return {
    remoteHost: null,
    remoteSessionId: null,
    remotePath: "/",
    remoteEntries: [],
    remoteLoading: false,
    selectedRemoteFiles: [],
    remoteAnchorPath: null,

    localPath: "",
    localEntries: [],
    localLoading: false,
    selectedLocalFiles: [],
    localAnchorPath: null,

    transferring: false,
    transferMessage: null,
    transferProgress: null,
    cancelRequested: false,
    error: null,

    initLocal: async () => {
      // Preserve current local path if already initialized
      if (get().localPath && get().localEntries.length > 0) {
        return;
      }
      set({ localLoading: true, error: null });
      try {
        const home = await api.getLocalHomeDir();
        const entries = await api.listLocal(home);
        set({ localPath: home, localEntries: entries, localLoading: false });
      } catch (e) {
        set({ localLoading: false, error: `Local fs error: ${String(e)}` });
      }
    },

    navigateLocal: async (path: string) => {
      set({
        localLoading: true,
        error: null,
        selectedLocalFiles: [],
        localAnchorPath: null,
      });
      try {
        const entries = await api.listLocal(path);
        set({ localPath: path, localEntries: entries, localLoading: false });
      } catch (e) {
        set({ localLoading: false, error: `Failed to open ${path}: ${String(e)}` });
      }
    },

    selectFiles: (pane, entry, mods, orderedEntries) => {
      const state = get();
      const isLocal = pane === "local";
      const current = isLocal ? state.selectedLocalFiles : state.selectedRemoteFiles;
      const anchor = isLocal ? state.localAnchorPath : state.remoteAnchorPath;

      let next: FileEntry[];
      let nextAnchor = anchor;

      if (mods.shift && anchor) {
        const anchorIdx = orderedEntries.findIndex((e) => e.path === anchor);
        const targetIdx = orderedEntries.findIndex((e) => e.path === entry.path);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          const range = orderedEntries.slice(start, end + 1);
          if (mods.mod) {
            // Cmd/Ctrl+Shift: add the range to the existing selection
            const existing = new Set(current.map((e) => e.path));
            next = [...current, ...range.filter((e) => !existing.has(e.path))];
          } else {
            next = range;
          }
          // Anchor stays where the user last plain-clicked
        } else {
          next = [entry];
          nextAnchor = entry.path;
        }
      } else if (mods.mod) {
        const alreadySelected = current.some((e) => e.path === entry.path);
        if (alreadySelected) {
          next = current.filter((e) => e.path !== entry.path);
          // Anchor is kept even if deselected (Finder keeps it too)
        } else {
          next = [...current, entry];
          nextAnchor = entry.path;
        }
      } else {
        next = [entry];
        nextAnchor = entry.path;
      }

      if (isLocal) set({ selectedLocalFiles: next, localAnchorPath: nextAnchor });
      else set({ selectedRemoteFiles: next, remoteAnchorPath: nextAnchor });
    },

    setSelection: (pane, entries) => {
      const anchor = entries.length > 0 ? entries[entries.length - 1].path : null;
      if (pane === "local") set({ selectedLocalFiles: entries, localAnchorPath: anchor });
      else set({ selectedRemoteFiles: entries, remoteAnchorPath: anchor });
    },

    clearSelection: (pane) => clearPaneSelection(pane),

    selectAll: (pane, entries) => {
      const anchor =
        entries.length > 0 ? entries[entries.length - 1].path : null;
      if (pane === "local") set({ selectedLocalFiles: [...entries], localAnchorPath: anchor });
      else set({ selectedRemoteFiles: [...entries], remoteAnchorPath: anchor });
    },

    createLocalFolder: async (name: string) => {
      const { localPath, navigateLocal } = get();
      const target = `${localPath.replace(/\/$/, "")}/${name}`;
      await api.mkdirLocal(target);
      await navigateLocal(localPath);
    },

    deleteLocalItems: async (entries: FileEntry[]) => {
      const { localPath, navigateLocal } = get();
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          await api.deleteLocal(entry.path, entry.is_dir);
        } catch (e) {
          failed.push(`${entry.name}: ${String(e)}`);
        }
      }
      await navigateLocal(localPath);
      if (failed.length > 0) {
        set({ error: `Failed to delete ${failed.length} item(s):\n${failed.slice(0, 5).join("\n")}` });
      }
    },

    connectRemote: async (host: Host) => {
      const oldSession = get().remoteSessionId;
      if (oldSession) {
        api.disconnectSftp(oldSession).catch(() => {});
      }

      const sessionId = `sftp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      set({
        remoteLoading: true,
        remoteHost: host,
        remoteSessionId: sessionId,
        error: null,
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });

      try {
        const initialPath = await api.connectSftp(host.id, sessionId);
        const entries = await api.listSftp(sessionId, initialPath);
        set({
          remotePath: initialPath,
          remoteEntries: entries,
          remoteLoading: false,
        });
      } catch (e) {
        set({
          remoteLoading: false,
          error: `SFTP Connection failed: ${String(e)}`,
          remoteSessionId: null,
        });
      }
    },

    navigateRemote: async (path: string) => {
      const { remoteSessionId } = get();
      if (!remoteSessionId) return;

      set({
        remoteLoading: true,
        error: null,
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });
      try {
        const entries = await api.listSftp(remoteSessionId, path);
        set({ remotePath: path, remoteEntries: entries, remoteLoading: false });
      } catch (e) {
        set({ remoteLoading: false, error: `Remote list error: ${String(e)}` });
      }
    },

    createRemoteFolder: async (name: string) => {
      const { remoteSessionId, remotePath, navigateRemote } = get();
      if (!remoteSessionId) return;
      const target = `${remotePath.replace(/\/$/, "")}/${name}`;
      await api.mkdirSftp(remoteSessionId, target);
      await navigateRemote(remotePath);
    },

    deleteRemoteItems: async (entries: FileEntry[]) => {
      const { remoteSessionId, remotePath, navigateRemote } = get();
      if (!remoteSessionId) return;
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          await api.deleteSftp(remoteSessionId, entry.path, entry.is_dir);
        } catch (e) {
          failed.push(`${entry.name}: ${String(e)}`);
        }
      }
      await navigateRemote(remotePath);
      if (failed.length > 0) {
        set({ error: `Failed to delete ${failed.length} item(s):\n${failed.slice(0, 5).join("\n")}` });
      }
    },

    disconnectRemote: async () => {
      const { remoteSessionId } = get();
      if (remoteSessionId) {
        await api.disconnectSftp(remoteSessionId);
      }
      set({
        remoteHost: null,
        remoteSessionId: null,
        remoteEntries: [],
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });
    },

    uploadSelected: async (entries) => {
      const { selectedLocalFiles, remotePath, remoteSessionId, navigateRemote } = get();
      const roots = entries ?? selectedLocalFiles;
      if (!remoteSessionId || roots.length === 0) return;
      await runTransfer("upload", remoteSessionId, roots, remotePath, () =>
        navigateRemote(remotePath)
      );
    },

    downloadSelected: async (entries) => {
      const { selectedRemoteFiles, localPath, remoteSessionId, navigateLocal } = get();
      const roots = entries ?? selectedRemoteFiles;
      if (!remoteSessionId || roots.length === 0) return;
      await runTransfer("download", remoteSessionId, roots, localPath, () =>
        navigateLocal(localPath)
      );
    },

    cancelTransfer: () => set({ cancelRequested: true }),
  };
});
