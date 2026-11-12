import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import i18n from "../i18n";
import { api, PortForwardRule, PortForwardInput } from "../lib/api";

interface TunnelState {
  rules: PortForwardRule[];
  activeRuleIds: Set<string>;
  isLoading: boolean;
  error: string | null;
  isModalOpen: boolean;
  editingRule: PortForwardRule | null;
  /** Rules with a start/stop in flight (several can run at once). */
  busyRuleIds: Set<string>;

  refresh: () => Promise<void>;
  saveRule: (input: PortForwardInput, ruleId?: string) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  toggleTunnel: (rule: PortForwardRule) => Promise<void>;
  openCreateModal: () => void;
  openEditModal: (rule: PortForwardRule) => void;
  closeModal: () => void;
  clearError: () => void;
}

export const useTunnelStore = create<TunnelState>((set, get) => ({
  rules: [],
  activeRuleIds: new Set(),
  isLoading: false,
  error: null,
  isModalOpen: false,
  editingRule: null,
  busyRuleIds: new Set(),

  refresh: async () => {
    if (get().rules.length === 0) {
      set({ isLoading: true, error: null });
    }
    try {
      const [rules, active] = await Promise.all([
        api.listTunnelRules(),
        api.listActiveTunnels(),
      ]);
      set({ rules, activeRuleIds: new Set(active), isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  saveRule: async (input, ruleId) => {
    await api.saveTunnelRule(input, ruleId);
    await get().refresh();
  },

  deleteRule: async (id: string) => {
    const { activeRuleIds } = get();
    if (activeRuleIds.has(id)) {
      await api.stopTunnel(id).catch(() => {});
    }
    await api.deleteTunnelRule(id);
    await get().refresh();
  },

  toggleTunnel: async (rule: PortForwardRule) => {
    const { activeRuleIds, busyRuleIds } = get();
    if (busyRuleIds.has(rule.id)) return;
    const isActive = activeRuleIds.has(rule.id);
    set((s) => ({ busyRuleIds: new Set(s.busyRuleIds).add(rule.id), error: null }));

    try {
      if (isActive) {
        await api.stopTunnel(rule.id);
      } else {
        await api.startTunnel(rule.id);
      }
      await get().refresh();
    } catch (e) {
      set({ error: i18n.t("tunnels.toggleError", { label: rule.label, error: String(e) }) });
    } finally {
      set((s) => {
        const next = new Set(s.busyRuleIds);
        next.delete(rule.id);
        return { busyRuleIds: next };
      });
    }
  },

  openCreateModal: () => set({ isModalOpen: true, editingRule: null }),
  openEditModal: (rule) => set({ isModalOpen: true, editingRule: rule }),
  closeModal: () => set({ isModalOpen: false, editingRule: null }),
  clearError: () => set({ error: null }),
}));

// The backend emits this whenever a tunnel task ends — including on its own
// (SSH connection lost, listener error), when no user action would trigger a
// refresh. Re-read the authoritative active list rather than patching the set
// locally, so a quick Stop → Start of the same rule can't be clobbered by the
// old run's late event.
listen<{ rule_id: string; unexpected: boolean }>("tunnel-ended", async (event) => {
  const { rule_id, unexpected } = event.payload;
  const store = useTunnelStore.getState();
  await store.refresh();
  if (unexpected && !useTunnelStore.getState().activeRuleIds.has(rule_id)) {
    const rule = useTunnelStore.getState().rules.find((r) => r.id === rule_id);
    useTunnelStore.setState({
      error: i18n.t("tunnels.connectionLost", { label: rule?.label ?? rule_id }),
    });
  }
}).catch((e) => console.error("Failed to listen tunnel-ended:", e));
