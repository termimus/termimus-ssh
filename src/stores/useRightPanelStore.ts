import { create } from "zustand";

export type RightPanelTab = "snippets" | "ai";

export const RIGHT_PANEL_DEFAULT_WIDTH = 352;
export const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 820;
/** The terminal must always keep at least this share of the window. */
const RIGHT_PANEL_MAX_WINDOW_FRACTION = 0.6;

/** Clamps a panel width to [min, max], where max also depends on the window width. */
export function clampRightPanelWidth(width: number): number {
  const windowMax =
    typeof window !== "undefined"
      ? Math.floor(window.innerWidth * RIGHT_PANEL_MAX_WINDOW_FRACTION)
      : RIGHT_PANEL_MAX_WIDTH;
  const max = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, windowMax));
  return Math.round(Math.min(max, Math.max(RIGHT_PANEL_MIN_WIDTH, width)));
}

interface RightPanelState {
  isOpen: boolean;
  activeTab: RightPanelTab;
  /** Panel width in px (user-adjustable by dragging its left edge). */
  width: number;

  /** Live width update while dragging (not persisted until `commitWidth`). */
  setWidth: (width: number) => void;
  /** Persist the current width (call on drag end / keyboard resize). */
  commitWidth: () => void;
  resetWidth: () => void;

  /** Header button: open on the last used tab, or close. */
  toggle: () => void;
  /** Open the panel, optionally switching to `tab`. */
  open: (tab?: RightPanelTab) => void;
  close: () => void;
  setTab: (tab: RightPanelTab) => void;
  /**
   * Shortcut semantics (Alt+S / Alt+I): close if the panel is already showing
   * `tab`, otherwise open it on `tab` (switching from the other tab).
   */
  toggleTab: (tab: RightPanelTab) => void;
}

const STORAGE_KEY = "termimus_right_panel";

type Persisted = Pick<RightPanelState, "isOpen" | "activeTab" | "width">;

function loadInitial(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        isOpen: !!parsed.isOpen,
        activeTab: parsed.activeTab === "ai" ? "ai" : "snippets",
        width:
          typeof parsed.width === "number"
            ? clampRightPanelWidth(parsed.width)
            : RIGHT_PANEL_DEFAULT_WIDTH,
      };
    }
    // Migrate from the old per-sidebar flags.
    const aiOpen = localStorage.getItem("termimus_ai_sidebar_open") === "true";
    const snippetsOpen = localStorage.getItem("termimus_snippet_sidebar_open") === "true";
    return {
      isOpen: aiOpen || snippetsOpen,
      activeTab: aiOpen ? "ai" : "snippets",
      width: RIGHT_PANEL_DEFAULT_WIDTH,
    };
  } catch {
    return { isOpen: false, activeTab: "snippets", width: RIGHT_PANEL_DEFAULT_WIDTH };
  }
}

function persist(state: Persisted) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ isOpen: state.isOpen, activeTab: state.activeTab, width: state.width })
    );
  } catch {
    // ignore (private mode / blocked storage)
  }
}

/**
 * Single right-hand panel hosting Snippets and AI Copilot as tabs, replacing
 * the two independent sidebars that could both be open at once.
 */
export const useRightPanelStore = create<RightPanelState>((set, get) => {
  const update = (next: Partial<Persisted>) => {
    set(next);
    const { isOpen, activeTab, width } = get();
    persist({ isOpen, activeTab, width });
  };

  return {
    ...loadInitial(),

    toggle: () => update({ isOpen: !get().isOpen }),
    open: (tab) => update({ isOpen: true, activeTab: tab ?? get().activeTab }),
    close: () => update({ isOpen: false }),
    setTab: (tab) => update({ activeTab: tab }),
    toggleTab: (tab) => {
      const { isOpen, activeTab } = get();
      if (isOpen && activeTab === tab) update({ isOpen: false });
      else update({ isOpen: true, activeTab: tab });
    },

    setWidth: (width) => set({ width: clampRightPanelWidth(width) }),
    commitWidth: () => update({ width: clampRightPanelWidth(get().width) }),
    resetWidth: () => update({ width: RIGHT_PANEL_DEFAULT_WIDTH }),
  };
});
