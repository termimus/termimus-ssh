import { create } from "zustand";
import {
  api,
  PresetLayoutType,
  PresetNode,
  WorkspacePreset,
  WorkspacePresetInput,
} from "../lib/api";
import { getPaneCountForLayout, isKnownPresetLayout } from "../lib/workspaceLayout";

export type { PresetLayoutType, PresetNode, WorkspacePreset, WorkspacePresetInput };

export { getPaneCountForLayout };

const LAYOUT_I18N_KEY: Record<PresetLayoutType, string> = {
  "split-vertical": "splitVertical",
  "split-horizontal": "splitHorizontal",
  "grid-4": "grid4",
  "split-1-2": "split12",
  "split-2-1": "split21",
  "triple-column": "tripleColumn",
};

/** Translation keys + pane count for a layout; safe for unknown layout strings. */
export function getLayoutMeta(layout: PresetLayoutType | string): {
  labelKey: string;
  descriptionKey: string;
  panes: number;
} {
  if (!isKnownPresetLayout(layout)) {
    // Unknown layout (e.g. synced/imported from another app version):
    // render something sane instead of crashing the Workspaces page.
    return {
      labelKey: "workspaces.layoutUnknown",
      descriptionKey: "workspaces.layoutUnknown",
      panes: 2,
    };
  }
  const key = LAYOUT_I18N_KEY[layout];
  return {
    labelKey: `workspaces.modal.layouts.${key}`,
    descriptionKey: `workspaces.modal.layoutDescriptions.${key}`,
    panes: getPaneCountForLayout(layout),
  };
}

interface WorkspaceState {
  presets: WorkspacePreset[];
  isLoading: boolean;
  error: string | null;
  isModalOpen: boolean;
  editingPreset: WorkspacePreset | null;

  refresh: () => Promise<void>;
  openCreateModal: (initialPreset?: Partial<WorkspacePreset>) => void;
  openEditModal: (preset: WorkspacePreset) => void;
  closeModal: () => void;
  savePreset: (
    preset: WorkspacePresetInput,
    id?: string
  ) => Promise<string>;
  deletePreset: (id: string) => Promise<void>;
  duplicatePreset: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  presets: [],
  // True until the first refresh settles, so the page shows a spinner rather
  // than flashing the "no presets" empty state.
  isLoading: true,
  error: null,
  isModalOpen: false,
  editingPreset: null,

  refresh: async () => {
    if (get().presets.length === 0) {
      set({ isLoading: true, error: null });
    }
    try {
      let presets = await api.listWorkspacePresets();

      // One-time automatic migration from legacy localStorage to SQLite
      if (presets.length === 0) {
        try {
          const raw = localStorage.getItem("termimus_workspace_presets");
          if (raw) {
            const parsed = JSON.parse(raw);
            const legacyPresets: WorkspacePreset[] = parsed?.state?.presets || [];
            if (Array.isArray(legacyPresets) && legacyPresets.length > 0) {
              for (const p of legacyPresets) {
                await api.saveWorkspacePreset(
                  {
                    name: p.name,
                    description: p.description,
                    layout: p.layout,
                    nodes: p.nodes,
                    broadcastOnLaunch: p.broadcastOnLaunch,
                  },
                  p.id
                );
              }
              localStorage.removeItem("termimus_workspace_presets");
              presets = await api.listWorkspacePresets();
            }
          }
        } catch {
          // Non-fatal legacy migration fallback
        }
      }

      set({ presets, isLoading: false, error: null });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  openCreateModal: (initialPreset) => {
    const dummy: WorkspacePreset = {
      id: "",
      name: initialPreset?.name || "",
      description: initialPreset?.description || "",
      layout: initialPreset?.layout || "split-vertical",
      nodes: initialPreset?.nodes || [],
      broadcastOnLaunch: initialPreset?.broadcastOnLaunch || false,
      createdAt: "",
      updatedAt: "",
    };
    set({ isModalOpen: true, editingPreset: dummy });
  },

  openEditModal: (preset) => {
    set({ isModalOpen: true, editingPreset: preset });
  },

  closeModal: () => {
    set({ isModalOpen: false, editingPreset: null });
  },

  savePreset: async (input, id) => {
    const saved = await api.saveWorkspacePreset(input, id);
    set({ isModalOpen: false, editingPreset: null });
    await get().refresh();
    return saved.id;
  },

  deletePreset: async (id: string) => {
    await api.deleteWorkspacePreset(id);
    await get().refresh();
  },

  duplicatePreset: async (id: string) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;
    await api.saveWorkspacePreset({
      name: `${preset.name} (Copy)`,
      description: preset.description,
      layout: preset.layout,
      nodes: preset.nodes,
      broadcastOnLaunch: preset.broadcastOnLaunch,
    });
    await get().refresh();
  },
}));
