import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, FileEntry, Host } from "../lib/api";
import { parentPath } from "../lib/format";

export type SftpPane = "left" | "right";
export type SftpSourceType = "local" | "remote";

export interface SelectMods {
  /** Shift+click: extend selection as a range from the anchor */
  shift: boolean;
  /** Cmd (macOS) or Ctrl (Windows/Linux) click: toggle item in selection */
  mod: boolean;
}

/** A directory to create or a file to transfer inside a bulk transfer */
export interface TransferItem {
  from: string;
  to: string;
  name: string;
  /** 0 for directories */
  size: number;
}

interface TransferPlan {
  /** Destination directories to create, parents before children */
  dirs: TransferItem[];
  /** Files to transfer with structure preserved under the target dir */
  files: TransferItem[];
  /** Items that could not be scanned (unreadable subtrees etc.) */
  scanErrors: string[];
}

export type ConflictDecision = "ignore" | "replace";
export type ConflictAction = ConflictDecision | "replaceAll" | "cancel";

/** A planned destination that already exists on the other side */
export interface ConflictItem {
  /** Destination path; unique across the queue */
  key: string;
  name: string;
  from: string;
  to: string;
  isDir: boolean;
  size: number;
  existing: FileEntry | null;
}

interface ConflictQueue {
  items: ConflictItem[];
  index: number;
  decisions: Record<string, ConflictDecision>;
  resolve: (decisions: Record<string, ConflictDecision> | null) => void;
}

export interface TransferProgress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** Bytes of files already finished; byte events for the current file add on top */
  completedBytes: number;
  currentFile: { path: string; name: string; size: number } | null;
  currentFileDone: number;
  currentFileTotal: number;
}

interface TransferProgressEvent {
  sessionId: string;
  path: string;
  bytesDone: number;
  bytesTotal: number;
}

interface PaneEndpoint {
  isRemote: boolean;
  sessionId?: string | null;
  path: string;
  host?: Host | null;
}

// Guard against symlink loops / pathological trees during recursive scans
const MAX_TRAVERSAL_DEPTH = 32;

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;

const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

/** A listed entry name must be a single path component, or joining it onto the
 *  destination could escape the target dir (e.g. a hostile server's "../x"). */
const isSafeEntryName = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !/[/\\\0]/.test(name);

/**
 * Walk the selected roots and produce a flat, ordered transfer plan.
 */
async function buildTransferPlan(
  source: PaneEndpoint,
  roots: FileEntry[],
  targetDir: string
): Promise<TransferPlan> {
  const dirs: TransferItem[] = [];
  const files: TransferItem[] = [];
  const scanErrors: string[] = [];
  const visited = new Set<string>();

  const listChildren = (path: string): Promise<FileEntry[]> =>
    source.isRemote
      ? api.listSftp(source.sessionId!, path)
      : api.listLocal(path);

  const walkDir = async (entry: FileEntry, destDir: string, depth: number): Promise<void> => {
    if (depth > MAX_TRAVERSAL_DEPTH) {
      scanErrors.push(`${entry.path}: directory tree too deep (max ${MAX_TRAVERSAL_DEPTH})`);
      return;
    }
    if (visited.has(entry.path)) return; // already covered by another selected root
    visited.add(entry.path);

    const dest = joinPath(destDir, entry.name);
    dirs.push({ from: entry.path, to: dest, name: entry.name, size: 0 });

    let children: FileEntry[];
    try {
      children = await listChildren(entry.path);
    } catch (e) {
      scanErrors.push(`${entry.path}: ${String(e)}`);
      return;
    }
    for (const child of children) {
      if (!isSafeEntryName(child.name)) {
        scanErrors.push(`${entry.path}: skipped entry with unsafe name ${JSON.stringify(child.name)}`);
        continue;
      }
      if (child.is_dir) {
        await walkDir(child, dest, depth + 1);
      } else {
        files.push({
          from: child.path,
          to: joinPath(dest, child.name),
          name: child.name,
          size: child.size,
        });
      }
    }
  };

  for (const root of roots) {
    if (root.is_dir) {
      await walkDir(root, targetDir, 0);
    } else {
      files.push({
        from: root.path,
        to: joinPath(targetDir, root.name),
        name: root.name,
        size: root.size,
      });
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
  target: PaneEndpoint,
  dir: string
): Promise<void> {
  try {
    if (target.isRemote) await api.mkdirSftp(target.sessionId!, dir);
    else await api.mkdirLocal(dir);
  } catch (e) {
    // mkdir may fail because the directory already exists. Verify via parent listing.
    const parent = parentPath(dir);
    if (!parent || parent === dir) throw e;
    const siblings =
      target.isRemote
        ? await api.listSftp(target.sessionId!, parent)
        : await api.listLocal(parent);
    const exists = siblings.some((s) => s.name === baseName(dir) && s.is_dir);
    if (!exists) throw e;
  }
}

/**
 * Stat every planned destination and, for the ones that already exist, let the
 * user decide via the conflict modal.
 */
async function resolveTransferConflicts(
  target: PaneEndpoint,
  plan: TransferPlan,
  openQueue: (items: ConflictItem[]) => Promise<Record<string, ConflictDecision> | null>
): Promise<{ dirs: TransferItem[]; files: TransferItem[] } | null> {
  const dests = [...plan.dirs.map((d) => d.to), ...plan.files.map((f) => f.to)];
  let stats: (FileEntry | null)[];
  try {
    stats =
      target.isRemote
        ? await api.sftpStatMany(target.sessionId!, dests)
        : await api.localStatMany(dests);
  } catch {
    return { dirs: plan.dirs, files: plan.files };
  }

  const items: ConflictItem[] = [];
  plan.dirs.forEach((dir, i) => {
    if (stats[i]) {
      items.push({
        key: dir.to,
        name: dir.name,
        from: dir.from,
        to: dir.to,
        isDir: true,
        size: 0,
        existing: stats[i],
      });
    }
  });
  plan.files.forEach((file, i) => {
    const stat = stats[plan.dirs.length + i];
    if (stat) {
      items.push({
        key: file.to,
        name: file.name,
        from: file.from,
        to: file.to,
        isDir: false,
        size: file.size,
        existing: stat,
      });
    }
  });

  if (items.length === 0) {
    return { dirs: plan.dirs, files: plan.files };
  }

  const decisions = await openQueue(items);
  if (!decisions) return null;

  const ignoredPrefixes = Object.entries(decisions)
    .filter(([, d]) => d === "ignore")
    .map(([key]) => `${key.replace(/\/+$/, "")}/`);
  const isIgnored = (dest: string) =>
    decisions[dest] === "ignore" || ignoredPrefixes.some((p) => dest.startsWith(p));

  return {
    dirs: plan.dirs.filter((d) => !isIgnored(d.to)),
    files: plan.files.filter((f) => !isIgnored(f.to)),
  };
}

export interface SftpState {
  // Left Pane State (Local first, can switch to remote server)
  leftSourceType: SftpSourceType;
  leftHost: Host | null;
  leftSessionId: string | null;
  leftPath: string;
  leftEntries: FileEntry[];
  leftLoading: boolean;
  selectedLeftFiles: FileEntry[];
  leftAnchorPath: string | null;

  // Right Pane State (Remote server)
  rightHost: Host | null;
  rightSessionId: string | null;
  rightPath: string;
  rightEntries: FileEntry[];
  rightLoading: boolean;
  selectedRightFiles: FileEntry[];
  rightAnchorPath: string | null;

  // Backward-compatible mirror fields
  remoteHost: Host | null;
  remoteSessionId: string | null;
  remotePath: string;
  remoteEntries: FileEntry[];
  remoteLoading: boolean;
  selectedRemoteFiles: FileEntry[];
  remoteAnchorPath: string | null;

  localPath: string;
  localEntries: FileEntry[];
  localLoading: boolean;
  selectedLocalFiles: FileEntry[];
  localAnchorPath: string | null;

  // Transfer State
  activeTransferSessionId: string | null;
  transferring: boolean;
  transferMessage: string | null;
  transferProgress: TransferProgress | null;
  cancelRequested: boolean;
  pendingConflicts: ConflictQueue | null;
  error: string | null;

  // Left Pane Operations
  initLocal: () => Promise<void>;
  setLeftSourceLocal: () => Promise<void>;
  connectLeftRemote: (host: Host) => Promise<void>;
  disconnectLeft: () => Promise<void>;

  // Right Pane Operations
  connectRightRemote: (host: Host) => Promise<void>;
  connectRemote: (host: Host) => Promise<void>; // alias to connectRightRemote
  disconnectRight: () => Promise<void>;
  disconnectRemote: () => Promise<void>; // alias to disconnectRight

  // Generic Pane Operations
  navigatePane: (pane: SftpPane, path: string) => Promise<void>;
  navigateLocal: (path: string) => Promise<void>;
  navigateRemote: (path: string) => Promise<void>;
  selectFiles: (
    pane: SftpPane,
    entry: FileEntry,
    mods: SelectMods,
    orderedEntries: FileEntry[]
  ) => void;
  setSelection: (pane: SftpPane, entries: FileEntry[]) => void;
  clearSelection: (pane: SftpPane) => void;
  selectAll: (pane: SftpPane, entries: FileEntry[]) => void;
  createFolder: (pane: SftpPane, name: string) => Promise<void>;
  createLocalFolder: (name: string) => Promise<void>;
  createRemoteFolder: (name: string) => Promise<void>;
  deleteItems: (pane: SftpPane, entries: FileEntry[]) => Promise<void>;
  deleteLocalItems: (entries: FileEntry[]) => Promise<void>;
  deleteRemoteItems: (entries: FileEntry[]) => Promise<void>;

  // Transfers
  transferLeftToRight: (entries?: FileEntry[]) => Promise<void>;
  transferRightToLeft: (entries?: FileEntry[]) => Promise<void>;
  uploadSelected: (entries?: FileEntry[]) => Promise<void>; // alias to transferLeftToRight
  downloadSelected: (entries?: FileEntry[]) => Promise<void>; // alias to transferRightToLeft
  cancelTransfer: () => void;

  resolveConflict: (action: ConflictAction) => void;
  applyTransferBytes: (event: TransferProgressEvent) => void;
}

export const useSftpStore = create<SftpState>((set, get) => {
  const clearPaneSelection = (pane: SftpPane) => {
    if (pane === "left") {
      set({
        selectedLeftFiles: [],
        leftAnchorPath: null,
        selectedLocalFiles: [],
        localAnchorPath: null,
      });
    } else {
      set({
        selectedRightFiles: [],
        rightAnchorPath: null,
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });
    }
  };

  /** Execute a (possibly recursive) bulk transfer between source and target endpoints */
  const runTransfer = async (
    fromPane: SftpPane,
    roots: FileEntry[],
    refreshTarget: () => Promise<void>
  ): Promise<void> => {
    const state = get();
    if (roots.length === 0 || state.transferring) return;

    const source: PaneEndpoint =
      fromPane === "left"
        ? {
            isRemote: state.leftSourceType === "remote",
            sessionId: state.leftSessionId,
            path: state.leftPath,
            host: state.leftHost,
          }
        : {
            isRemote: true,
            sessionId: state.rightSessionId,
            path: state.rightPath,
            host: state.rightHost,
          };

    const target: PaneEndpoint =
      fromPane === "left"
        ? {
            isRemote: true,
            sessionId: state.rightSessionId,
            path: state.rightPath,
            host: state.rightHost,
          }
        : {
            isRemote: state.leftSourceType === "remote",
            sessionId: state.leftSessionId,
            path: state.leftPath,
            host: state.leftHost,
          };

    if (source.isRemote && !source.sessionId) return;
    if (target.isRemote && !target.sessionId) return;

    // Determine user-friendly action verb
    let verb = "Copying";
    if (!source.isRemote && target.isRemote) verb = "Uploading";
    else if (source.isRemote && !target.isRemote) verb = "Downloading";
    else if (source.isRemote && target.isRemote) {
      verb = `Transferring to ${target.host?.label ?? "server"}`;
    }

    const mkDirVerb = target.isRemote
      ? `Creating folder on ${target.host?.label ?? "remote"}`
      : "Creating local folder";

    // Track active session id whose byte events we should listen to
    const activeSession = source.isRemote ? source.sessionId! : target.sessionId!;

    set({
      transferring: true,
      activeTransferSessionId: activeSession,
      transferMessage: "Scanning selected items...",
      transferProgress: null,
      cancelRequested: false,
      error: null,
    });

    try {
      const plan = await buildTransferPlan(source, roots, target.path);
      const failed: string[] = [...plan.scanErrors];

      const effective = await resolveTransferConflicts(target, plan, (items) =>
        new Promise<Record<string, ConflictDecision> | null>((resolve) =>
          set({ pendingConflicts: { items, index: 0, decisions: {}, resolve } })
        )
      );
      if (!effective) {
        set({ error: "Transfer cancelled." });
        return;
      }
      const { dirs, files } = effective;

      const total = files.length;
      const bytesTotal = files.reduce((sum, f) => sum + f.size, 0);
      let doneCount = 0;
      let completedBytes = 0;
      const baseProgress = (): TransferProgress => ({
        done: doneCount,
        total,
        bytesDone: completedBytes,
        bytesTotal,
        completedBytes,
        currentFile: null,
        currentFileDone: 0,
        currentFileTotal: 0,
      });
      set({ transferProgress: baseProgress() });

      let cancelled = false;

      // 1) Create the directory structure (parents before children)
      for (const dir of dirs) {
        if (get().cancelRequested) {
          cancelled = true;
          break;
        }
        set({ transferMessage: `${mkDirVerb}: ${dir.to}` });
        try {
          await ensureDir(target, dir.to);
        } catch (e) {
          failed.push(`${dir.to}: ${String(e)}`);
        }
      }

      // 2) Transfer files sequentially so message tracks real progress
      if (!cancelled) {
        for (const file of files) {
          if (get().cancelRequested) {
            cancelled = true;
            break;
          }
          set({
            transferMessage: `${verb}: ${file.name}`,
            transferProgress: {
              ...baseProgress(),
              currentFile: { path: file.from, name: file.name, size: file.size },
              currentFileTotal: file.size,
            },
          });
          try {
            if (!source.isRemote && target.isRemote) {
              await api.uploadSftp(target.sessionId!, file.from, file.to);
            } else if (source.isRemote && !target.isRemote) {
              await api.downloadSftp(source.sessionId!, file.from, file.to);
            } else if (source.isRemote && target.isRemote) {
              await api.transferRemoteSftp(
                source.sessionId!,
                file.from,
                target.sessionId!,
                file.to
              );
            }
            doneCount++;
            completedBytes += file.size;
          } catch (e) {
            failed.push(`${file.from}: ${String(e)}`);
          }
        }
      }

      set({ transferProgress: baseProgress() });
      await refreshTarget();

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
      set({
        transferring: false,
        activeTransferSessionId: null,
        transferMessage: null,
        transferProgress: null,
        cancelRequested: false,
      });
    }
  };

  return {
    // Left Pane
    leftSourceType: "local",
    leftHost: null,
    leftSessionId: null,
    leftPath: "",
    leftEntries: [],
    leftLoading: false,
    selectedLeftFiles: [],
    leftAnchorPath: null,

    // Right Pane
    rightHost: null,
    rightSessionId: null,
    rightPath: "/",
    rightEntries: [],
    rightLoading: false,
    selectedRightFiles: [],
    rightAnchorPath: null,

    // Backward-compatible mirrors
    localPath: "",
    localEntries: [],
    localLoading: false,
    selectedLocalFiles: [],
    localAnchorPath: null,

    remoteHost: null,
    remoteSessionId: null,
    remotePath: "/",
    remoteEntries: [],
    remoteLoading: false,
    selectedRemoteFiles: [],
    remoteAnchorPath: null,

    // Transfers
    activeTransferSessionId: null,
    transferring: false,
    transferMessage: null,
    transferProgress: null,
    cancelRequested: false,
    pendingConflicts: null,
    error: null,

    initLocal: async () => {
      if (get().leftSourceType !== "local") return;
      if (get().leftPath && get().leftEntries.length > 0) {
        return;
      }
      set({ leftLoading: true, localLoading: true, error: null });
      try {
        const home = await api.getLocalHomeDir();
        const entries = await api.listLocal(home);
        set({
          leftPath: home,
          leftEntries: entries,
          leftLoading: false,
          localPath: home,
          localEntries: entries,
          localLoading: false,
        });
      } catch (e) {
        set({
          leftLoading: false,
          localLoading: false,
          error: `Local fs error: ${String(e)}`,
        });
      }
    },

    setLeftSourceLocal: async () => {
      const oldSession = get().leftSessionId;
      if (oldSession) {
        api.disconnectSftp(oldSession).catch(() => {});
      }
      set({
        leftSourceType: "local",
        leftHost: null,
        leftSessionId: null,
        leftLoading: true,
        selectedLeftFiles: [],
        leftAnchorPath: null,
        localLoading: true,
        selectedLocalFiles: [],
        localAnchorPath: null,
        error: null,
      });
      try {
        const home = get().localPath || (await api.getLocalHomeDir());
        const entries = await api.listLocal(home);
        set({
          leftPath: home,
          leftEntries: entries,
          leftLoading: false,
          localPath: home,
          localEntries: entries,
          localLoading: false,
        });
      } catch (e) {
        set({
          leftLoading: false,
          localLoading: false,
          error: `Local fs error: ${String(e)}`,
        });
      }
    },

    connectLeftRemote: async (host: Host) => {
      const oldSession = get().leftSessionId;
      if (oldSession) {
        api.disconnectSftp(oldSession).catch(() => {});
      }

      const sessionId = `sftp-left-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      set({
        leftSourceType: "remote",
        leftHost: host,
        leftSessionId: sessionId,
        leftLoading: true,
        error: null,
        selectedLeftFiles: [],
        leftAnchorPath: null,
      });

      try {
        const initialPath = await api.connectSftp(host.id, sessionId);
        const entries = await api.listSftp(sessionId, initialPath);
        set({
          leftPath: initialPath,
          leftEntries: entries,
          leftLoading: false,
        });
      } catch (e) {
        set({
          leftLoading: false,
          error: `Left SFTP Connection failed: ${String(e)}`,
          leftSessionId: null,
        });
      }
    },

    disconnectLeft: async () => {
      await get().setLeftSourceLocal();
    },

    connectRightRemote: async (host: Host) => {
      const oldSession = get().rightSessionId;
      if (oldSession) {
        api.disconnectSftp(oldSession).catch(() => {});
      }

      const sessionId = `sftp-right-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      set({
        rightLoading: true,
        rightHost: host,
        rightSessionId: sessionId,
        remoteLoading: true,
        remoteHost: host,
        remoteSessionId: sessionId,
        error: null,
        selectedRightFiles: [],
        rightAnchorPath: null,
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });

      try {
        const initialPath = await api.connectSftp(host.id, sessionId);
        const entries = await api.listSftp(sessionId, initialPath);
        set({
          rightPath: initialPath,
          rightEntries: entries,
          rightLoading: false,
          remotePath: initialPath,
          remoteEntries: entries,
          remoteLoading: false,
        });
      } catch (e) {
        set({
          rightLoading: false,
          remoteLoading: false,
          error: `SFTP Connection failed: ${String(e)}`,
          rightSessionId: null,
          remoteSessionId: null,
        });
      }
    },

    connectRemote: async (host: Host) => {
      return get().connectRightRemote(host);
    },

    disconnectRight: async () => {
      const { rightSessionId } = get();
      if (rightSessionId) {
        await api.disconnectSftp(rightSessionId);
      }
      set({
        rightHost: null,
        rightSessionId: null,
        rightEntries: [],
        selectedRightFiles: [],
        rightAnchorPath: null,
        remoteHost: null,
        remoteSessionId: null,
        remoteEntries: [],
        selectedRemoteFiles: [],
        remoteAnchorPath: null,
      });
    },

    disconnectRemote: async () => {
      return get().disconnectRight();
    },

    navigatePane: async (pane: SftpPane, path: string) => {
      const isLeft = pane === "left";
      if (isLeft) {
        const { leftSourceType, leftSessionId } = get();
        set({
          leftLoading: true,
          localLoading: leftSourceType === "local",
          error: null,
          selectedLeftFiles: [],
          leftAnchorPath: null,
          selectedLocalFiles: leftSourceType === "local" ? [] : get().selectedLocalFiles,
        });
        try {
          const entries =
            leftSourceType === "local"
              ? await api.listLocal(path)
              : await api.listSftp(leftSessionId!, path);
          set({
            leftPath: path,
            leftEntries: entries,
            leftLoading: false,
            localPath: leftSourceType === "local" ? path : get().localPath,
            localEntries: leftSourceType === "local" ? entries : get().localEntries,
            localLoading: false,
          });
        } catch (e) {
          set({
            leftLoading: false,
            localLoading: false,
            error: `Failed to open ${path}: ${String(e)}`,
          });
        }
      } else {
        const { rightSessionId } = get();
        if (!rightSessionId) return;
        set({
          rightLoading: true,
          remoteLoading: true,
          error: null,
          selectedRightFiles: [],
          rightAnchorPath: null,
          selectedRemoteFiles: [],
          remoteAnchorPath: null,
        });
        try {
          const entries = await api.listSftp(rightSessionId, path);
          set({
            rightPath: path,
            rightEntries: entries,
            rightLoading: false,
            remotePath: path,
            remoteEntries: entries,
            remoteLoading: false,
          });
        } catch (e) {
          set({
            rightLoading: false,
            remoteLoading: false,
            error: `Remote list error: ${String(e)}`,
          });
        }
      }
    },

    navigateLocal: async (path: string) => {
      return get().navigatePane("left", path);
    },

    navigateRemote: async (path: string) => {
      return get().navigatePane("right", path);
    },

    selectFiles: (pane, entry, mods, orderedEntries) => {
      const state = get();
      const isLeft = pane === "left";
      const current = isLeft ? state.selectedLeftFiles : state.selectedRightFiles;
      const anchor = isLeft ? state.leftAnchorPath : state.rightAnchorPath;

      let next: FileEntry[];
      let nextAnchor = anchor;

      if (mods.shift && anchor) {
        const anchorIdx = orderedEntries.findIndex((e) => e.path === anchor);
        const targetIdx = orderedEntries.findIndex((e) => e.path === entry.path);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          const range = orderedEntries.slice(start, end + 1);
          if (mods.mod) {
            const existing = new Set(current.map((e) => e.path));
            next = [...current, ...range.filter((e) => !existing.has(e.path))];
          } else {
            next = range;
          }
        } else {
          next = [entry];
          nextAnchor = entry.path;
        }
      } else if (mods.mod) {
        const alreadySelected = current.some((e) => e.path === entry.path);
        if (alreadySelected) {
          next = current.filter((e) => e.path !== entry.path);
        } else {
          next = [...current, entry];
          nextAnchor = entry.path;
        }
      } else {
        next = [entry];
        nextAnchor = entry.path;
      }

      if (isLeft) {
        set({
          selectedLeftFiles: next,
          leftAnchorPath: nextAnchor,
          selectedLocalFiles: next,
          localAnchorPath: nextAnchor,
        });
      } else {
        set({
          selectedRightFiles: next,
          rightAnchorPath: nextAnchor,
          selectedRemoteFiles: next,
          remoteAnchorPath: nextAnchor,
        });
      }
    },

    setSelection: (pane, entries) => {
      const anchor = entries.length > 0 ? entries[entries.length - 1].path : null;
      if (pane === "left") {
        set({
          selectedLeftFiles: entries,
          leftAnchorPath: anchor,
          selectedLocalFiles: entries,
          localAnchorPath: anchor,
        });
      } else {
        set({
          selectedRightFiles: entries,
          rightAnchorPath: anchor,
          selectedRemoteFiles: entries,
          remoteAnchorPath: anchor,
        });
      }
    },

    clearSelection: (pane) => clearPaneSelection(pane),

    selectAll: (pane, entries) => {
      const anchor = entries.length > 0 ? entries[entries.length - 1].path : null;
      if (pane === "left") {
        set({
          selectedLeftFiles: [...entries],
          leftAnchorPath: anchor,
          selectedLocalFiles: [...entries],
          localAnchorPath: anchor,
        });
      } else {
        set({
          selectedRightFiles: [...entries],
          rightAnchorPath: anchor,
          selectedRemoteFiles: [...entries],
          remoteAnchorPath: anchor,
        });
      }
    },

    createFolder: async (pane: SftpPane, name: string) => {
      const isLeft = pane === "left";
      const { leftSourceType, leftSessionId, leftPath, rightSessionId, rightPath, navigatePane } = get();

      if (isLeft) {
        if (leftSourceType === "local") {
          const target = `${leftPath.replace(/\/$/, "")}/${name}`;
          await api.mkdirLocal(target);
        } else if (leftSessionId) {
          const target = `${leftPath.replace(/\/$/, "")}/${name}`;
          await api.mkdirSftp(leftSessionId, target);
        }
        await navigatePane("left", leftPath);
      } else {
        if (!rightSessionId) return;
        const target = `${rightPath.replace(/\/$/, "")}/${name}`;
        await api.mkdirSftp(rightSessionId, target);
        await navigatePane("right", rightPath);
      }
    },

    createLocalFolder: async (name: string) => {
      return get().createFolder("left", name);
    },

    createRemoteFolder: async (name: string) => {
      return get().createFolder("right", name);
    },

    deleteItems: async (pane: SftpPane, entries: FileEntry[]) => {
      const isLeft = pane === "left";
      const { leftSourceType, leftSessionId, leftPath, rightSessionId, rightPath, navigatePane } = get();
      const failed: string[] = [];

      if (isLeft) {
        for (const entry of entries) {
          try {
            if (leftSourceType === "local") {
              await api.deleteLocal(entry.path, entry.is_dir);
            } else if (leftSessionId) {
              await api.deleteSftp(leftSessionId, entry.path, entry.is_dir);
            }
          } catch (e) {
            failed.push(`${entry.name}: ${String(e)}`);
          }
        }
        await navigatePane("left", leftPath);
      } else {
        if (!rightSessionId) return;
        for (const entry of entries) {
          try {
            await api.deleteSftp(rightSessionId, entry.path, entry.is_dir);
          } catch (e) {
            failed.push(`${entry.name}: ${String(e)}`);
          }
        }
        await navigatePane("right", rightPath);
      }

      if (failed.length > 0) {
        set({ error: `Failed to delete ${failed.length} item(s):\n${failed.slice(0, 5).join("\n")}` });
      }
    },

    deleteLocalItems: async (entries: FileEntry[]) => {
      return get().deleteItems("left", entries);
    },

    deleteRemoteItems: async (entries: FileEntry[]) => {
      return get().deleteItems("right", entries);
    },

    transferLeftToRight: async (entries) => {
      const { selectedLeftFiles, rightSessionId, navigatePane, rightPath } = get();
      const roots = entries ?? selectedLeftFiles;
      if (!rightSessionId || roots.length === 0) return;
      await runTransfer("left", roots, () => navigatePane("right", rightPath));
    },

    transferRightToLeft: async (entries) => {
      const { selectedRightFiles, rightSessionId, navigatePane, leftPath } = get();
      const roots = entries ?? selectedRightFiles;
      if (!rightSessionId || roots.length === 0) return;
      await runTransfer("right", roots, () => navigatePane("left", leftPath));
    },

    uploadSelected: async (entries) => {
      return get().transferLeftToRight(entries);
    },

    downloadSelected: async (entries) => {
      return get().transferRightToLeft(entries);
    },

    cancelTransfer: () => set({ cancelRequested: true }),

    resolveConflict: (action) => {
      const queue = get().pendingConflicts;
      if (!queue) return;

      if (action === "cancel") {
        queue.resolve(null);
        set({ pendingConflicts: null });
        return;
      }

      const item = queue.items[queue.index];
      const decisions: Record<string, ConflictDecision> = { ...queue.decisions };

      if (action === "replaceAll") {
        for (let i = queue.index; i < queue.items.length; i++) {
          if (!decisions[queue.items[i].key]) decisions[queue.items[i].key] = "replace";
        }
        queue.resolve(decisions);
        set({ pendingConflicts: null });
        return;
      }

      decisions[item.key] = action;
      if (action === "ignore" && item.isDir) {
        const prefix = `${item.key.replace(/\/+$/, "")}/`;
        for (const q of queue.items) {
          if (q.key.startsWith(prefix)) decisions[q.key] = "ignore";
        }
      }

      let next = queue.index + 1;
      while (next < queue.items.length && decisions[queue.items[next].key]) next++;
      if (next >= queue.items.length) {
        queue.resolve(decisions);
        set({ pendingConflicts: null });
      } else {
        set({
          pendingConflicts: {
            items: queue.items,
            index: next,
            decisions,
            resolve: queue.resolve,
          },
        });
      }
    },

    applyTransferBytes: (event) => {
      const state = get();
      const prog = state.transferProgress;
      if (!prog?.currentFile) return;
      // Match active transfer session
      if (state.activeTransferSessionId && event.sessionId !== state.activeTransferSessionId) {
        return;
      }
      if (event.path !== prog.currentFile.path) return;
      const currentTotal = Math.max(prog.currentFile.size, event.bytesTotal);
      const done = Math.min(event.bytesDone, currentTotal);
      set({
        transferProgress: {
          ...prog,
          bytesTotal: prog.bytesTotal - prog.currentFile.size + currentTotal,
          bytesDone: prog.completedBytes + done,
          currentFileDone: done,
          currentFileTotal: currentTotal,
        },
      });
    },
  };
});

listen<TransferProgressEvent>("sftp-transfer-progress", (e) => {
  useSftpStore.getState().applyTransferBytes(e.payload);
}).catch(() => {});
