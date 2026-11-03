import { create } from "zustand";
import { api, Snippet, SnippetInput } from "../lib/api";
import { useRightPanelStore } from "./useRightPanelStore";

interface SnippetState {
  snippets: Snippet[];
  isLoading: boolean;
  error: string | null;
  isModalOpen: boolean;
  editingSnippet: Snippet | null;

  refresh: () => Promise<void>;
  saveSnippet: (input: SnippetInput, snippetId?: string) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  openCreateModal: () => void;
  openEditModal: (snippet: Snippet) => void;
  closeModal: () => void;
  /** Toggles the Snippets tab of the shared right panel (Alt+S). */
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useSnippetStore = create<SnippetState>((set, get) => ({
  snippets: [],
  isLoading: false,
  error: null,
  isModalOpen: false,
  editingSnippet: null,

  refresh: async () => {
    if (get().snippets.length === 0) {
      set({ isLoading: true, error: null });
    }
    try {
      const snippets = await api.listSnippets();
      set({ snippets, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveSnippet: async (input, snippetId) => {
    await api.saveSnippet(input, snippetId);
    await get().refresh();
    import("./useSyncStore").then((m) => m.useSyncStore.getState().triggerAutoPush()).catch(() => {});
  },

  deleteSnippet: async (id: string) => {
    await api.deleteSnippet(id);
    await get().refresh();
    import("./useSyncStore").then((m) => m.useSyncStore.getState().triggerAutoPush()).catch(() => {});
  },

  openCreateModal: () => set({ isModalOpen: true, editingSnippet: null }),
  openEditModal: (snippet) => set({ isModalOpen: true, editingSnippet: snippet }),
  closeModal: () => set({ isModalOpen: false, editingSnippet: null }),

  // Snippets live in a tab of the shared right panel (see useRightPanelStore).
  toggleSidebar: () => useRightPanelStore.getState().toggleTab("snippets"),

  setSidebarOpen: (open: boolean) => {
    const panel = useRightPanelStore.getState();
    if (open) panel.open("snippets");
    else if (panel.activeTab === "snippets") panel.close();
  },
}));
