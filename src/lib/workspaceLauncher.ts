import { useSessionStore } from "../stores/useSessionStore";
import type { Host, WorkspacePreset } from "./api";

/**
 * Launches a WorkspacePreset by building the entire split layout tree
 * atomically in one go, so all panes mount with their final quadrant
 * dimensions (preventing startup SIGWINCH resize artifacts).
 *
 * `hosts` must come from `resolvePresetHosts` (pane order, missing slots
 * already dropped); the layout collapses to fit when some are missing.
 */
export function launchWorkspacePreset(preset: WorkspacePreset, hosts: Host[]): void {
  if (hosts.length === 0) {
    throw new Error("No valid hosts found for this workspace preset.");
  }
  useSessionStore.getState().openClusterGroup(
    hosts,
    preset.layout,
    preset.broadcastOnLaunch,
    preset.name
  );
}
