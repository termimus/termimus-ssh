import type { ReactNode } from "react";
import { Braces, Sparkles, PanelRightClose } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRightPanelStore, RightPanelTab } from "../../stores/useRightPanelStore";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { useAiStore, AI_COPILOT_SHORTCUT_LABEL } from "../../stores/useAiStore";

/**
 * Tab switcher rendered in the left part of each panel's header row, so the
 * panel keeps a single header instead of a tab bar stacked on a title bar.
 */
export function RightPanelTabs() {
  const { t } = useTranslation();
  const { activeTab, setTab } = useRightPanelStore(
    useShallow((s) => ({ activeTab: s.activeTab, setTab: s.setTab }))
  );
  const snippetCount = useSnippetStore((s) => s.snippets.length);
  const aiBusy = useAiStore((s) => s.isGenerating || s.isExplaining);

  const tabs: {
    id: RightPanelTab;
    label: string;
    /** Full name for the tooltip. */
    title: string;
    icon: typeof Braces;
    shortcut: string;
    badge?: ReactNode;
  }[] = [
    {
      id: "ai",
      label: "AI",
      title: t("settings.tabs.ai"),
      icon: Sparkles,
      shortcut: AI_COPILOT_SHORTCUT_LABEL,
      badge: aiBusy ? (
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
      ) : undefined,
    },
    {
      id: "snippets",
      label: "Snippets",
      title: t("nav.snippets"),
      icon: Braces,
      shortcut: "Alt+S",
      badge: (
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-container)] px-1.5 text-[10px] font-mono text-[var(--text-muted)]">
          {snippetCount}
        </span>
      ),
    }
  ];

  return (
    <div role="tablist" aria-label="Side panel tabs" className="flex min-w-0 items-center gap-0.5">
      {tabs.map(({ id, label, title, icon: Icon, shortcut, badge }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(id)}
            title={`${title} (${shortcut})`}
            className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors cursor-pointer ${
              active
                ? "bg-[var(--primary)]/10 text-[var(--primary)] font-semibold"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon size={14} className="shrink-0" />
            <span className="truncate">{label}</span>
            {badge}
          </button>
        );
      })}
    </div>
  );
}

/** Close button shared by both panel headers. */
export function RightPanelCloseButton() {
  const close = useRightPanelStore((s) => s.close);
  return (
    <button
      type="button"
      onClick={close}
      title="Close side panel"
      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
    >
      <PanelRightClose size={15} />
    </button>
  );
}
