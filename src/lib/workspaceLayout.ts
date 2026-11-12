import type { Host, PresetLayoutType, PresetNode, WorkspacePreset } from "./api";
import { PaneNode, createLeafPane, createSplitPane, getAllLeafPanes } from "./layoutTree";

/** Every layout the preset system understands (mirrors the backend whitelist). */
export const PRESET_LAYOUTS: readonly PresetLayoutType[] = [
  "split-vertical",
  "split-horizontal",
  "grid-4",
  "split-1-2",
  "split-2-1",
  "triple-column",
];

export function isKnownPresetLayout(layout: string): layout is PresetLayoutType {
  return (PRESET_LAYOUTS as readonly string[]).includes(layout);
}

export function getPaneCountForLayout(layout: PresetLayoutType): number {
  switch (layout) {
    case "grid-4":
      return 4;
    case "split-1-2":
    case "split-2-1":
    case "triple-column":
      return 3;
    default:
      return 2;
  }
}

/** N equal-width columns, built as a right-leaning chain of row splits. */
function buildEvenRow(sessionIds: string[]): PaneNode {
  if (sessionIds.length === 1) return createLeafPane(sessionIds[0]);
  return createSplitPane(
    "row",
    createLeafPane(sessionIds[0]),
    buildEvenRow(sessionIds.slice(1)),
    100 / sessionIds.length
  );
}

/**
 * Builds the split tree for a preset launch. Each session id is used in
 * exactly one leaf: a pooled xterm element can only be mounted in one pane, so
 * a duplicated id would leave one pane blank. When fewer sessions than the
 * layout's pane count are given (e.g. some hosts were deleted), the layout
 * collapses to the closest shape that fits instead of padding with duplicates.
 */
export function buildPresetLayoutTree(sessionIds: string[], layout: string): PaneNode {
  if (sessionIds.length === 0) {
    throw new Error("buildPresetLayoutTree requires at least one session");
  }
  const [s0, s1, s2, s3] = sessionIds;
  const n = sessionIds.length;

  if (n === 1) return createLeafPane(s0);

  if (!isKnownPresetLayout(layout) || n > getPaneCountForLayout(layout)) {
    return buildEvenRow(sessionIds);
  }

  if (n === 2) {
    return createSplitPane(
      layout === "split-horizontal" ? "column" : "row",
      createLeafPane(s0),
      createLeafPane(s1)
    );
  }

  if (n === 3) {
    switch (layout) {
      case "split-1-2":
        return createSplitPane(
          "row",
          createLeafPane(s0),
          createSplitPane("column", createLeafPane(s1), createLeafPane(s2))
        );
      case "triple-column":
        return buildEvenRow(sessionIds);
      default:
        // split-2-1, and grid-4 with one host missing
        return createSplitPane(
          "column",
          createSplitPane("row", createLeafPane(s0), createLeafPane(s1)),
          createLeafPane(s2)
        );
    }
  }

  // n === 4, grid-4
  return createSplitPane(
    "column",
    createSplitPane("row", createLeafPane(s0), createLeafPane(s1)),
    createSplitPane("row", createLeafPane(s2), createLeafPane(s3))
  );
}

/**
 * Maps a live split tree to the closest preset layout, or null when it cannot
 * be represented (a single pane or more than 4 panes).
 */
export function detectPresetLayout(root: PaneNode): PresetLayoutType | null {
  const leafCount = getAllLeafPanes(root).length;
  if (root.type !== "split") return null;

  switch (leafCount) {
    case 2:
      return root.direction === "column" ? "split-horizontal" : "split-vertical";
    case 3:
      if (root.direction === "column") return "split-2-1";
      return root.children.some((c) => c.type === "split" && c.direction === "row")
        ? "triple-column"
        : "split-1-2";
    case 4:
      return "grid-4";
    default:
      return null;
  }
}

interface CaptureTab {
  id: string;
  hostId: string;
  isLocal?: boolean;
}

/**
 * Snapshots a terminal group's split into a preset draft. Panes showing a
 * local shell or a host that no longer exists are left unassigned (empty
 * hostId) so the preset modal forces the user to pick a host for them.
 */
export function captureGroupAsPreset(
  root: PaneNode,
  tabs: CaptureTab[],
  hosts: Host[]
): Pick<WorkspacePreset, "layout" | "nodes"> | null {
  const layout = detectPresetLayout(root);
  if (!layout) return null;

  const hostIds = new Set(hosts.map((h) => h.id));
  const nodes: PresetNode[] = getAllLeafPanes(root).map((pane, paneIndex) => {
    const tab = tabs.find((t) => t.id === pane.activeTabId);
    const usable = tab && !tab.isLocal && hostIds.has(tab.hostId);
    return { paneIndex, hostId: usable ? tab.hostId : "" };
  });

  return { layout, nodes };
}

/**
 * Resolves a preset's nodes to hosts in pane order. Each pane slot is counted
 * once; slots beyond the layout's pane count are ignored. `missing` is the
 * number of pane slots whose host could not be resolved.
 */
export function resolvePresetHosts(
  preset: Pick<WorkspacePreset, "layout" | "nodes">,
  hosts: Host[]
): { hosts: Host[]; missing: number } {
  const paneCount = isKnownPresetLayout(preset.layout)
    ? getPaneCountForLayout(preset.layout)
    : preset.nodes.length;

  const bySlot = new Map<number, string>();
  for (const node of preset.nodes) {
    if (node.paneIndex >= 0 && node.paneIndex < paneCount && !bySlot.has(node.paneIndex)) {
      bySlot.set(node.paneIndex, node.hostId);
    }
  }

  const resolved: Host[] = [];
  let missing = 0;
  for (let slot = 0; slot < paneCount; slot++) {
    const host = hosts.find((h) => h.id === bySlot.get(slot));
    if (host) resolved.push(host);
    else missing++;
  }
  return { hosts: resolved, missing };
}
