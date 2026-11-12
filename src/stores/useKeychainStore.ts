import { create } from "zustand";
import {
  api,
  KeychainItem,
  KeychainKeyInput,
  KeychainIdentityInput,
} from "../lib/api";
import { useHostStore } from "./useHostStore";

interface KeychainState {
  items: KeychainItem[];
  isLoading: boolean;
  /** Last error from loading the Keychain, shown with a Retry action. */
  error: string | null;
  searchQuery: string;

  isKeyModalOpen: boolean;
  editingKey: KeychainItem | null;

  isIdentityModalOpen: boolean;
  editingIdentity: KeychainItem | null;

  refresh: () => Promise<void>;
  saveKey: (input: KeychainKeyInput, itemId?: string) => Promise<KeychainItem>;
  saveIdentity: (input: KeychainIdentityInput, itemId?: string) => Promise<KeychainItem>;
  deleteItem: (id: string) => Promise<void>;

  setSearchQuery: (query: string) => void;
  openCreateKeyModal: () => void;
  openEditKeyModal: (item: KeychainItem) => void;
  closeKeyModal: () => void;

  openCreateIdentityModal: () => void;
  openEditIdentityModal: (item: KeychainItem) => void;
  closeIdentityModal: () => void;
}

export const useKeychainStore = create<KeychainState>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  searchQuery: "",

  isKeyModalOpen: false,
  editingKey: null,

  isIdentityModalOpen: false,
  editingIdentity: null,

  refresh: async () => {
    // Only flash isLoading when items are empty to avoid UI flicker
    if (get().items.length === 0) {
      set({ isLoading: true });
    }
    try {
      const items = await api.listKeychain();
      set({ items, isLoading: false, error: null });
    } catch (e) {
      console.error("Failed to load Keychain:", e);
      set({ isLoading: false, error: String(e) });
    }
  },

  saveKey: async (input, itemId) => {
    const item = await api.saveKeychainKey(input, itemId);
    await get().refresh();
    return item;
  },

  saveIdentity: async (input, itemId) => {
    const item = await api.saveKeychainIdentity(input, itemId);
    await get().refresh();
    return item;
  },

  deleteItem: async (id) => {
    await api.deleteKeychainItem(id);
    await get().refresh();
    // Hosts that used this credential had their credential_id nulled by the
    // DB (ON DELETE SET NULL); reload them so the UI doesn't keep a stale link.
    await useHostStore.getState().refresh();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  openCreateKeyModal: () => set({ isKeyModalOpen: true, editingKey: null }),
  openEditKeyModal: (item) => set({ isKeyModalOpen: true, editingKey: item }),
  closeKeyModal: () => set({ isKeyModalOpen: false, editingKey: null }),

  openCreateIdentityModal: () =>
    set({ isIdentityModalOpen: true, editingIdentity: null }),
  openEditIdentityModal: (item) =>
    set({ isIdentityModalOpen: true, editingIdentity: item }),
  closeIdentityModal: () =>
    set({ isIdentityModalOpen: false, editingIdentity: null }),
}));
