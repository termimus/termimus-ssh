import { create } from "zustand";
import { api, Host } from "../lib/api";
import {
  PaneNode,
  SplitDirection,
  createInitialLayout,
  createLeafPane,
  createSplitPane,
  findPaneContainingTab,
  findPaneById,
  getAllLeafPanes,
  getAllSessionIdsInTree,
  generateGroupId,
  removeTabFromTree,
  splitLeafNode,
  moveTabToPane,
  setPaneActiveTab,
  updateSplitRatio,
} from "../lib/layoutTree";
import { disposeTerminalSession } from "../components/terminal/XtermView";

const textEncoder = new TextEncoder();
let cachedLocalShellName: string | null = null;

export interface SshTab {
  id: string; // session_id
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  connected: boolean;
  connecting: boolean;
  error?: string;
  isLocal?: boolean;
}

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface DragTarget {
  paneId: string;
  zone: DropZone;
}

export interface TerminalGroup {
  id: string; // group id
  rootPane: PaneNode;
  /** Optional display label shown in the top header tab (e.g. workspace preset name) */
  label?: string;
}

interface SessionState {
  tabs: SshTab[];
  activeTabId: string | null;

  // Multi-Group Workspace state (each group represents 1 tab in the top header)
  groups: TerminalGroup[];
  activeGroupId: string | null;

  // Active group's split layout & pane focus
  rootPane: PaneNode | null;
  activePaneId: string | null;
  maximizedPaneId: string | null;

  // Tab Drag & Drop state
  isDraggingTab: boolean;
  draggedTabId: string | null;
  dragSourcePaneId: string | null;
  pointerPos: { x: number; y: number };
  dragTarget: DragTarget | null;

  // Interconnection / Input Broadcast state (per-group)
  broadcastGroupIds: string[];
  toggleGroupBroadcast: (groupId?: string) => void;
  isGroupBroadcastActive: (groupId?: string) => boolean;
  getBroadcastTargetSessionIds: (sessionId: string) => string[];

  // Session lifecycle
  openSession: (host: Host, newGroup?: boolean) => Promise<string>;
  openLocalSession: (newGroup?: boolean) => Promise<string>;
  openLocalSessionInSplit: (
    targetPaneId: string,
    direction: SplitDirection,
    side?: "first" | "second"
  ) => string;
  /**
   * Atomically creates a new session AND splits the target pane in one state update.
   * This avoids the double-render / lost-progress-log bug that occurs when
   * openSession (which docks the tab into the active pane) is followed by a
   * separate splitPane call — the intermediate dock render would mount XtermView,
   * start the SSH connection and register progress listeners, then the split would
   * unmount/remount the component, resetting all React state and losing logs.
   */
  openSessionInSplit: (
    host: Host,
    targetPaneId: string,
    direction: SplitDirection,
    side?: "first" | "second"
  ) => string;
  openClusterGroup: (
    nodes: { host: Host; paneIndex: number }[],
    layout:
      | "split-vertical"
      | "split-horizontal"
      | "grid-4"
      | "split-1-2"
      | "split-2-1"
      | "triple-column",
    broadcast?: boolean,
    label?: string
  ) => string[];
  closeSession: (sessionId: string) => Promise<void>;
  closeGroup: (groupId: string) => Promise<void>;
  setActiveTab: (sessionId: string) => void;
  setActiveGroup: (groupId: string) => void;
  setSessionConnected: (sessionId: string, connected: boolean) => void;
  setSessionError: (sessionId: string, error: string) => void;
  sendTextToActiveSession: (text: string) => Promise<boolean>;
  sendSnippetToTerminals: (
    text: string,
    targetMode?: "auto" | "broadcast" | "single"
  ) => Promise<{ ok: boolean; count: number; targets: string[] }>;

  // Pane & Split layout operations
  focusPane: (paneId: string) => void;
  setPaneTab: (paneId: string, tabId: string) => void;
  splitPane: (
    targetPaneId: string,
    tabId: string,
    direction: SplitDirection,
    side?: "first" | "second"
  ) => void;
  moveTabToPane: (targetPaneId: string, tabId: string) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  toggleMaximizePane: (paneId: string) => void;
  reorderGroups: (sourceGroupId: string, targetGroupId: string) => void;
  reorderTabs: (sourceTabId: string, targetTabId: string) => void;

  // Drag and Drop operations
  startDragTab: (tabId: string, sourcePaneId: string | null, x: number, y: number) => void;
  updateDragPos: (x: number, y: number) => void;
  setDragTarget: (target: DragTarget | null) => void;
  endDragTab: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  groups: [],
  activeGroupId: null,

  rootPane: null,
  activePaneId: null,
  maximizedPaneId: null,

  isDraggingTab: false,
  draggedTabId: null,
  dragSourcePaneId: null,
  pointerPos: { x: 0, y: 0 },
  dragTarget: null,

  broadcastGroupIds: [],

  openSession: async (host: Host, newGroup = true) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newTab: SshTab = {
      id: sessionId,
      hostId: host.id,
      hostLabel: host.label,
      hostAddress: `${host.username}@${host.address}`,
      connected: false,
      connecting: true,
    };

    set((state) => {
      // If newGroup is requested (e.g. from HostList / Header + button) or no groups exist:
      if (newGroup || state.groups.length === 0 || !state.activeGroupId) {
        const initial = createInitialLayout(sessionId);
        const newGroupObj: TerminalGroup = {
          id: generateGroupId(),
          rootPane: initial,
        };

        return {
          tabs: [...state.tabs, newTab],
          activeTabId: sessionId,
          groups: [...state.groups, newGroupObj],
          activeGroupId: newGroupObj.id,
          rootPane: initial,
          activePaneId: initial.id,
          maximizedPaneId: null,
        };
      }

      // Otherwise, dock into the current active group's focused pane
      const currentGroup =
        state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0];

      const currentActivePane =
        (state.activePaneId && findPaneById(currentGroup.rootPane, state.activePaneId)) ||
        getAllLeafPanes(currentGroup.rootPane)[0];

      const targetPaneId = currentActivePane ? currentActivePane.id : currentGroup.rootPane.id;
      const updatedRoot = moveTabToPane(currentGroup.rootPane, targetPaneId, sessionId);

      const updatedGroups = state.groups.map((g) =>
        g.id === currentGroup.id ? { ...g, rootPane: updatedRoot } : g
      );

      return {
        tabs: [...state.tabs, newTab],
        activeTabId: sessionId,
        groups: updatedGroups,
        activeGroupId: currentGroup.id,
        rootPane: updatedRoot,
        activePaneId: targetPaneId,
      };
    });

    return sessionId;
  },

  openSessionInSplit: (
    host: Host,
    targetPaneId: string,
    direction: SplitDirection,
    side: "first" | "second" = "second"
  ) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newTab: SshTab = {
      id: sessionId,
      hostId: host.id,
      hostLabel: host.label,
      hostAddress: `${host.username}@${host.address}`,
      connected: false,
      connecting: true,
    };

    set((state) => {
      // Fallback: If no group exists yet, create initial group
      if (!state.activeGroupId || state.groups.length === 0 || !state.rootPane) {
        const initial = createInitialLayout(sessionId);
        const newGroupObj: TerminalGroup = {
          id: generateGroupId(),
          rootPane: initial,
        };

        return {
          tabs: [...state.tabs, newTab],
          activeTabId: sessionId,
          groups: [...state.groups, newGroupObj],
          activeGroupId: newGroupObj.id,
          rootPane: initial,
          activePaneId: initial.id,
          maximizedPaneId: null,
        };
      }

      const targetGroup =
        state.groups.find((g) => Boolean(findPaneById(g.rootPane, targetPaneId))) ||
        state.groups.find((g) => g.id === state.activeGroupId) ||
        state.groups[0];

      // Ensure targetPaneId exists in active group's rootPane; fallback to first leaf if not found
      let effectiveTargetPaneId = targetPaneId;
      if (!findPaneById(targetGroup.rootPane, effectiveTargetPaneId)) {
        const leaves = getAllLeafPanes(targetGroup.rootPane);
        if (leaves.length > 0) {
          effectiveTargetPaneId = leaves[0].id;
        }
      }

      // Directly split the target leaf into two panes with the new sessionId
      const updatedRoot = splitLeafNode(
        targetGroup.rootPane,
        effectiveTargetPaneId,
        sessionId,
        direction,
        side
      );

      const updatedGroups = state.groups.map((g) =>
        g.id === targetGroup.id ? { ...g, rootPane: updatedRoot } : g
      );

      const newPane = findPaneContainingTab(updatedRoot, sessionId);

      return {
        tabs: [...state.tabs, newTab],
        groups: updatedGroups,
        activeGroupId: targetGroup.id,
        rootPane: updatedRoot,
        activePaneId: newPane ? newPane.id : state.activePaneId,
        activeTabId: sessionId,
        maximizedPaneId: null, // exit maximized on split
      };
    });

    return sessionId;
  },

  openLocalSession: async (newGroup = true) => {
    const sessionId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    let shellName = cachedLocalShellName || "terminal";
    try {
      const defaultShell = await api.getDefaultLocalShell();
      shellName = defaultShell.split("/").pop()?.split("\\").pop() || "terminal";
      cachedLocalShellName = shellName;
    } catch {
      // fallback
    }

    const newTab: SshTab = {
      id: sessionId,
      hostId: "local",
      hostLabel: `Local (${shellName})`,
      hostAddress: "localhost",
      connected: false,
      connecting: true,
      isLocal: true,
    };

    set((state) => {
      if (newGroup || state.groups.length === 0 || !state.activeGroupId) {
        const initial = createInitialLayout(sessionId);
        const newGroupObj: TerminalGroup = {
          id: generateGroupId(),
          rootPane: initial,
          label: `Local: ${shellName}`,
        };

        return {
          tabs: [...state.tabs, newTab],
          activeTabId: sessionId,
          groups: [...state.groups, newGroupObj],
          activeGroupId: newGroupObj.id,
          rootPane: initial,
          activePaneId: initial.id,
          maximizedPaneId: null,
        };
      }

      const currentGroup =
        state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0];

      const currentActivePane =
        (state.activePaneId && findPaneById(currentGroup.rootPane, state.activePaneId)) ||
        getAllLeafPanes(currentGroup.rootPane)[0];

      const targetPaneId = currentActivePane ? currentActivePane.id : currentGroup.rootPane.id;
      const updatedRoot = moveTabToPane(currentGroup.rootPane, targetPaneId, sessionId);

      const updatedGroups = state.groups.map((g) =>
        g.id === currentGroup.id ? { ...g, rootPane: updatedRoot } : g
      );

      return {
        tabs: [...state.tabs, newTab],
        activeTabId: sessionId,
        groups: updatedGroups,
        activeGroupId: currentGroup.id,
        rootPane: updatedRoot,
        activePaneId: targetPaneId,
      };
    });

    return sessionId;
  },

  openLocalSessionInSplit: (
    targetPaneId: string,
    direction: SplitDirection,
    side: "first" | "second" = "second"
  ) => {
    const sessionId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const existingLocal = get().tabs.find((t) => t.isLocal || t.id.startsWith("local-"));
    const match = existingLocal?.hostLabel?.match(/\((.*?)\)/);
    const shellName = cachedLocalShellName || (match ? match[1] : "terminal");

    const newTab: SshTab = {
      id: sessionId,
      hostId: "local",
      hostLabel: `Local (${shellName})`,
      hostAddress: "localhost",
      connected: false,
      connecting: true,
      isLocal: true,
    };

    if (!cachedLocalShellName) {
      api
        .getDefaultLocalShell()
        .then((def) => {
          const name = def.split("/").pop()?.split("\\").pop();
          if (name) {
            cachedLocalShellName = name;
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === sessionId && t.hostLabel === "Local (terminal)"
                  ? { ...t, hostLabel: `Local (${name})` }
                  : t
              ),
            }));
          }
        })
        .catch(() => {});
    }

    set((state) => {
      if (!state.activeGroupId || state.groups.length === 0 || !state.rootPane) {
        const initial = createInitialLayout(sessionId);
        const newGroupObj: TerminalGroup = {
          id: generateGroupId(),
          rootPane: initial,
          label: `Local: ${shellName}`,
        };

        return {
          tabs: [...state.tabs, newTab],
          activeTabId: sessionId,
          groups: [...state.groups, newGroupObj],
          activeGroupId: newGroupObj.id,
          rootPane: initial,
          activePaneId: initial.id,
          maximizedPaneId: null,
        };
      }

      const targetGroup =
        state.groups.find((g) => Boolean(findPaneById(g.rootPane, targetPaneId))) ||
        state.groups.find((g) => g.id === state.activeGroupId) ||
        state.groups[0];

      let effectiveTargetPaneId = targetPaneId;
      if (!findPaneById(targetGroup.rootPane, effectiveTargetPaneId)) {
        const leaves = getAllLeafPanes(targetGroup.rootPane);
        if (leaves.length > 0) {
          effectiveTargetPaneId = leaves[0].id;
        }
      }

      const updatedRoot = splitLeafNode(
        targetGroup.rootPane,
        effectiveTargetPaneId,
        sessionId,
        direction,
        side
      );

      const updatedGroups = state.groups.map((g) =>
        g.id === targetGroup.id ? { ...g, rootPane: updatedRoot } : g
      );

      const newPane = findPaneContainingTab(updatedRoot, sessionId);

      return {
        tabs: [...state.tabs, newTab],
        groups: updatedGroups,
        activeGroupId: targetGroup.id,
        rootPane: updatedRoot,
        activePaneId: newPane ? newPane.id : state.activePaneId,
        activeTabId: sessionId,
        maximizedPaneId: null,
      };
    });

    return sessionId;
  },

  openClusterGroup: (nodes, layout, broadcast = false, label) => {
    if (nodes.length === 0) return [];

    const sessionEntries = nodes.map((n, idx) => {
      const sessionId = `session-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`;
      const tab: SshTab = {
        id: sessionId,
        hostId: n.host.id,
        hostLabel: n.host.label,
        hostAddress: `${n.host.username}@${n.host.address}`,
        connected: false,
        connecting: true,
      };
      return { sessionId, tab };
    });

    const sessionIds = sessionEntries.map((e) => e.sessionId);
    const newTabs = sessionEntries.map((e) => e.tab);

    // Build the layout tree atomically in one go
    let rootPane: PaneNode;
    if (sessionIds.length <= 1) {
      rootPane = createLeafPane(sessionIds[0]);
    } else if (layout === "split-vertical") {
      rootPane = createSplitPane(
        "row",
        createLeafPane(sessionIds[0]),
        createLeafPane(sessionIds[1] || sessionIds[0])
      );
    } else if (layout === "split-horizontal") {
      rootPane = createSplitPane(
        "column",
        createLeafPane(sessionIds[0]),
        createLeafPane(sessionIds[1] || sessionIds[0])
      );
    } else if (layout === "grid-4") {
      const s0 = sessionIds[0];
      const s1 = sessionIds[1] || s0;
      const s2 = sessionIds[2] || s0;
      const s3 = sessionIds[3] || s1;
      const top = createSplitPane("row", createLeafPane(s0), createLeafPane(s1));
      const bottom = createSplitPane("row", createLeafPane(s2), createLeafPane(s3));
      rootPane = createSplitPane("column", top, bottom);
    } else if (layout === "split-1-2") {
      const s0 = sessionIds[0];
      const s1 = sessionIds[1] || s0;
      const s2 = sessionIds[2] || s0;
      const right = createSplitPane("column", createLeafPane(s1), createLeafPane(s2));
      rootPane = createSplitPane("row", createLeafPane(s0), right);
    } else if (layout === "split-2-1") {
      const s0 = sessionIds[0];
      const s1 = sessionIds[1] || s0;
      const s2 = sessionIds[2] || s0;
      const top = createSplitPane("row", createLeafPane(s0), createLeafPane(s1));
      rootPane = createSplitPane("column", top, createLeafPane(s2));
    } else if (layout === "triple-column") {
      const s0 = sessionIds[0];
      const s1 = sessionIds[1] || s0;
      const s2 = sessionIds[2] || s0;
      const rightTwo = createSplitPane("row", createLeafPane(s1), createLeafPane(s2), 50);
      rootPane = createSplitPane("row", createLeafPane(s0), rightTwo, 33.3);
    } else {
      rootPane = createLeafPane(sessionIds[0]);
    }

    const newGroup: TerminalGroup = {
      id: generateGroupId(),
      label,
      rootPane,
    };

    set((state) => ({
      tabs: [...state.tabs, ...newTabs],
      groups: [...state.groups, newGroup],
      activeGroupId: newGroup.id,
      rootPane,
      activePaneId: getAllLeafPanes(rootPane)[0]?.id || null,
      activeTabId: sessionIds[0],
      maximizedPaneId: null,
      broadcastGroupIds: broadcast
        ? [...state.broadcastGroupIds, newGroup.id]
        : state.broadcastGroupIds,
    }));

    return sessionIds;
  },

  closeSession: async (sessionId: string) => {
    // 1. Clean up xterm instance & Tauri event listeners
    try {
      disposeTerminalSession(sessionId);
    } catch (e) {
      console.warn("Failed to dispose xterm instance:", e);
    }

    // 2. Disconnect SSH / Local backend
    const tabToClose = get().tabs.find((t) => t.id === sessionId);
    try {
      if (tabToClose?.isLocal) {
        await api.killLocalPty(sessionId);
      } else {
        await api.disconnectSsh(sessionId);
      }
    } catch (e) {
      console.warn("Failed to disconnect cleanly:", e);
    }

    set((state) => {
      const remainingTabs = state.tabs.filter((t) => t.id !== sessionId);

      // Remove tab from all groups and prune any empty groups
      const updatedGroups: TerminalGroup[] = [];
      for (const group of state.groups) {
        const updatedRoot = removeTabFromTree(group.rootPane, sessionId);
        if (updatedRoot !== null) {
          updatedGroups.push({ ...group, rootPane: updatedRoot });
        }
      }

      if (updatedGroups.length === 0) {
        return {
          tabs: remainingTabs,
          activeTabId: null,
          groups: [],
          activeGroupId: null,
          rootPane: null,
          activePaneId: null,
          maximizedPaneId: null,
          broadcastGroupIds: [],
        };
      }

      // Clean up broadcast IDs for groups that no longer exist
      const validBroadcastGroupIds = state.broadcastGroupIds.filter((bgId) =>
        updatedGroups.some((g) => g.id === bgId)
      );

      // Check if current active group is still alive
      let nextActiveGroup = updatedGroups.find((g) => g.id === state.activeGroupId);
      if (!nextActiveGroup) {
        nextActiveGroup = updatedGroups[0];
      }

      const leaves = getAllLeafPanes(nextActiveGroup.rootPane);
      let nextActivePaneId = state.activePaneId;
      let nextActiveTabId = state.activeTabId;

      const paneStillExists = leaves.find((l) => l.id === nextActivePaneId);
      if (paneStillExists) {
        nextActiveTabId = paneStillExists.activeTabId;
      } else if (leaves.length > 0) {
        nextActivePaneId = leaves[0].id;
        nextActiveTabId = leaves[0].activeTabId;
      } else {
        nextActivePaneId = null;
        nextActiveTabId = null;
      }

      let nextMaximized = state.maximizedPaneId;
      if (nextMaximized && !leaves.some((l) => l.id === nextMaximized)) {
        nextMaximized = null;
      }

      return {
        tabs: remainingTabs,
        groups: updatedGroups,
        activeGroupId: nextActiveGroup.id,
        rootPane: nextActiveGroup.rootPane,
        activePaneId: nextActivePaneId,
        activeTabId: nextActiveTabId,
        maximizedPaneId: nextMaximized,
        broadcastGroupIds: validBroadcastGroupIds,
      };
    });
  },

  closeGroup: async (groupId: string) => {
    const { groups, closeSession } = get();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const sessionIds = getAllSessionIdsInTree(group.rootPane);
    for (const sid of sessionIds) {
      await closeSession(sid);
    }
  },

  setActiveGroup: (groupId: string) => {
    set((state) => {
      const group = state.groups.find((g) => g.id === groupId);
      if (!group) return {};

      const leaves = getAllLeafPanes(group.rootPane);
      const activePane = leaves[0] || null;

      return {
        activeGroupId: groupId,
        rootPane: group.rootPane,
        activePaneId: activePane ? activePane.id : null,
        activeTabId: activePane ? activePane.activeTabId : null,
        maximizedPaneId: null,
      };
    });
  },

  setActiveTab: (sessionId: string) => {
    set((state) => {
      // Find which group contains this sessionId
      const targetGroup = state.groups.find((g) =>
        findPaneContainingTab(g.rootPane, sessionId)
      );

      if (!targetGroup) {
        return { activeTabId: sessionId };
      }

      const pane = findPaneContainingTab(targetGroup.rootPane, sessionId);
      if (!pane) {
        return { activeTabId: sessionId };
      }

      const updatedRoot = setPaneActiveTab(targetGroup.rootPane, pane.id, sessionId);
      const updatedGroups = state.groups.map((g) =>
        g.id === targetGroup.id ? { ...g, rootPane: updatedRoot } : g
      );

      return {
        activeGroupId: targetGroup.id,
        groups: updatedGroups,
        rootPane: updatedRoot,
        activePaneId: pane.id,
        activeTabId: sessionId,
      };
    });
  },

  focusPane: (paneId: string) => {
    set((state) => {
      if (!state.rootPane) return {};
      const pane = findPaneById(state.rootPane, paneId);
      if (!pane) return {};
      return {
        activePaneId: paneId,
        activeTabId: pane.activeTabId,
      };
    });
  },

  setPaneTab: (paneId: string, tabId: string) => {
    set((state) => {
      if (!state.rootPane || !state.activeGroupId) return {};
      const updatedRoot = setPaneActiveTab(state.rootPane, paneId, tabId);
      const updatedGroups = state.groups.map((g) =>
        g.id === state.activeGroupId ? { ...g, rootPane: updatedRoot } : g
      );

      return {
        groups: updatedGroups,
        rootPane: updatedRoot,
        activePaneId: paneId,
        activeTabId: tabId,
      };
    });
  },

  splitPane: (
    targetPaneId: string,
    tabId: string,
    direction: SplitDirection,
    side: "first" | "second" = "second"
  ) => {
    set((state) => {
      if (!state.activeGroupId || state.groups.length === 0) return {};

      // 1. Remove tabId from any other group if it originated elsewhere
      let updatedGroups: TerminalGroup[] = [];
      for (const group of state.groups) {
        if (group.id !== state.activeGroupId) {
          const cleaned = removeTabFromTree(group.rootPane, tabId);
          if (cleaned !== null) {
            updatedGroups.push({ ...group, rootPane: cleaned });
          }
        }
      }

      // 2. Perform the split inside the active group
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId);
      if (!activeGroup) return {};

      const updatedRoot = splitLeafNode(
        activeGroup.rootPane,
        targetPaneId,
        tabId,
        direction,
        side
      );

      updatedGroups.push({ ...activeGroup, rootPane: updatedRoot });

      // Preserve original group order
      updatedGroups.sort(
        (a, b) =>
          state.groups.findIndex((g) => g.id === a.id) -
          state.groups.findIndex((g) => g.id === b.id)
      );

      const newPane = findPaneContainingTab(updatedRoot, tabId);
      return {
        groups: updatedGroups,
        rootPane: updatedRoot,
        activePaneId: newPane ? newPane.id : state.activePaneId,
        activeTabId: tabId,
        maximizedPaneId: null, // exit maximized on split
      };
    });
  },

  moveTabToPane: (targetPaneId: string, tabId: string) => {
    set((state) => {
      if (!state.activeGroupId) return {};

      // Remove tab from other groups if applicable
      let updatedGroups: TerminalGroup[] = [];
      for (const group of state.groups) {
        if (group.id !== state.activeGroupId) {
          const cleaned = removeTabFromTree(group.rootPane, tabId);
          if (cleaned !== null) {
            updatedGroups.push({ ...group, rootPane: cleaned });
          }
        }
      }

      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId);
      if (!activeGroup) return {};

      const updatedRoot = moveTabToPane(activeGroup.rootPane, targetPaneId, tabId);
      updatedGroups.push({ ...activeGroup, rootPane: updatedRoot });

      updatedGroups.sort(
        (a, b) =>
          state.groups.findIndex((g) => g.id === a.id) -
          state.groups.findIndex((g) => g.id === b.id)
      );

      return {
        groups: updatedGroups,
        rootPane: updatedRoot,
        activePaneId: targetPaneId,
        activeTabId: tabId,
      };
    });
  },

  setSplitRatio: (splitId: string, ratio: number) => {
    set((state) => {
      if (!state.rootPane || !state.activeGroupId) return {};
      const updatedRoot = updateSplitRatio(state.rootPane, splitId, ratio);
      const updatedGroups = state.groups.map((g) =>
        g.id === state.activeGroupId ? { ...g, rootPane: updatedRoot } : g
      );
      return {
        groups: updatedGroups,
        rootPane: updatedRoot,
      };
    });
  },

  toggleMaximizePane: (paneId: string) => {
    set((state) => ({
      maximizedPaneId: state.maximizedPaneId === paneId ? null : paneId,
    }));
  },

  reorderGroups: (sourceGroupId: string, targetGroupId: string) => {
    set((state) => {
      const groups = [...state.groups];
      const sourceIndex = groups.findIndex((g) => g.id === sourceGroupId);
      const targetIndex = groups.findIndex((g) => g.id === targetGroupId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return {};
      }
      const [moved] = groups.splice(sourceIndex, 1);
      groups.splice(targetIndex, 0, moved);
      return { groups };
    });
  },

  reorderTabs: (sourceTabId: string, targetTabId: string) => {
    set((state) => {
      const tabs = [...state.tabs];
      const sourceIndex = tabs.findIndex((t) => t.id === sourceTabId);
      const targetIndex = tabs.findIndex((t) => t.id === targetTabId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return {};
      }
      const [moved] = tabs.splice(sourceIndex, 1);
      tabs.splice(targetIndex, 0, moved);
      return { tabs };
    });
  },

  setSessionConnected: (sessionId: string, connected: boolean) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === sessionId ? { ...t, connected, connecting: false } : t
      ),
    }));
  },

  setSessionError: (sessionId: string, error: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === sessionId ? { ...t, error, connecting: false } : t
      ),
    }));
  },

  toggleGroupBroadcast: (groupId?: string) => {
    set((state) => {
      const targetGid = groupId || state.activeGroupId;
      if (!targetGid) return {};
      const exists = state.broadcastGroupIds.includes(targetGid);
      return {
        broadcastGroupIds: exists
          ? state.broadcastGroupIds.filter((id) => id !== targetGid)
          : [...state.broadcastGroupIds, targetGid],
      };
    });
  },

  isGroupBroadcastActive: (groupId?: string) => {
    const { broadcastGroupIds, activeGroupId } = get();
    const targetGid = groupId || activeGroupId;
    return targetGid ? broadcastGroupIds.includes(targetGid) : false;
  },

  getBroadcastTargetSessionIds: (sessionId: string) => {
    const { groups, tabs, broadcastGroupIds } = get();
    // 1. Find which group contains this sessionId
    const group = groups.find((g) => findPaneContainingTab(g.rootPane, sessionId));
    if (!group) return [sessionId];

    // 2. Check if broadcast is active for this group
    if (!broadcastGroupIds.includes(group.id)) {
      return [sessionId];
    }

    // 3. Get all active tabs currently shown in the leaf panes of this group
    const leafPanes = getAllLeafPanes(group.rootPane);
    const activeLeafTabIds = leafPanes.map((l) => l.activeTabId);

    // 4. Filter only connected sessions
    const connectedTargets = activeLeafTabIds.filter((tid) => {
      const tab = tabs.find((t) => t.id === tid);
      return tab && tab.connected;
    });

    return connectedTargets.length > 0 ? connectedTargets : [sessionId];
  },

  sendTextToActiveSession: async (text: string) => {
    const { activeTabId, tabs, getBroadcastTargetSessionIds } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTabId || !activeTab || !activeTab.connected) {
      return false;
    }
    const payload = text.endsWith("\n") ? text : `${text}\n`;
    const bytes = Array.from(textEncoder.encode(payload));

    const targetSessionIds = getBroadcastTargetSessionIds(activeTabId);
    await Promise.all(
      targetSessionIds.map((sid) => {
        const targetTab = tabs.find((t) => t.id === sid);
        const writeFn = targetTab?.isLocal ? api.writeLocalPty : api.writeSsh;
        return writeFn(sid, bytes).catch((e) => console.error("write broadcast failed:", e));
      })
    );
    return true;
  },

  sendSnippetToTerminals: async (
    text: string,
    targetMode: "auto" | "broadcast" | "single" = "auto"
  ) => {
    const { activeTabId, tabs, activeGroupId, groups, getBroadcastTargetSessionIds } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTabId || !activeTab || !activeTab.connected) {
      return { ok: false, count: 0, targets: [] };
    }

    const payload = text.endsWith("\n") ? text : `${text}\n`;
    const bytes = Array.from(textEncoder.encode(payload));

    let targetSessionIds: string[] = [];

    if (targetMode === "single") {
      targetSessionIds = [activeTabId];
    } else if (targetMode === "broadcast") {
      const currentGroup = groups.find((g) => g.id === activeGroupId);
      if (currentGroup) {
        const leafPanes = getAllLeafPanes(currentGroup.rootPane);
        targetSessionIds = leafPanes
          .map((l) => l.activeTabId)
          .filter((tid) => {
            const t = tabs.find((tab) => tab.id === tid);
            return t && t.connected;
          });
      }
      if (targetSessionIds.length === 0) {
        targetSessionIds = [activeTabId];
      }
    } else {
      targetSessionIds = getBroadcastTargetSessionIds(activeTabId);
    }

    await Promise.all(
      targetSessionIds.map((sid) => {
        const targetTab = tabs.find((t) => t.id === sid);
        const writeFn = targetTab?.isLocal ? api.writeLocalPty : api.writeSsh;
        return writeFn(sid, bytes).catch((e) => console.error("write snippet failed:", e));
      })
    );

    const targetLabels = targetSessionIds.map(
      (sid) => tabs.find((t) => t.id === sid)?.hostLabel || sid
    );

    return { ok: true, count: targetSessionIds.length, targets: targetLabels };
  },

  startDragTab: (tabId: string, sourcePaneId: string | null, x: number, y: number) => {
    set({
      isDraggingTab: true,
      draggedTabId: tabId,
      dragSourcePaneId: sourcePaneId,
      pointerPos: { x, y },
      dragTarget: null,
    });
  },

  updateDragPos: (x: number, y: number) => {
    set({ pointerPos: { x, y } });
  },

  setDragTarget: (target: DragTarget | null) => {
    set({ dragTarget: target });
  },

  endDragTab: () => {
    const { draggedTabId, dragTarget, splitPane, moveTabToPane } = get();
    if (draggedTabId && dragTarget) {
      const { paneId, zone } = dragTarget;
      if (zone === "left") {
        splitPane(paneId, draggedTabId, "row", "first");
      } else if (zone === "right") {
        splitPane(paneId, draggedTabId, "row", "second");
      } else if (zone === "top") {
        splitPane(paneId, draggedTabId, "column", "first");
      } else if (zone === "bottom") {
        splitPane(paneId, draggedTabId, "column", "second");
      } else if (zone === "center") {
        moveTabToPane(paneId, draggedTabId);
      }
    }

    set({
      isDraggingTab: false,
      draggedTabId: null,
      dragSourcePaneId: null,
      dragTarget: null,
    });
  },
}));
