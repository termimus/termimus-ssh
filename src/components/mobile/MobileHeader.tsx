import { useTranslation } from "react-i18next";
import { Lock, Plus, Server, Terminal, KeyRound, Settings, Braces, Waypoints, FolderOpen } from "lucide-react";
import { useVaultStore } from "../../stores/useVaultStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { ActiveTab } from "../layout/Sidebar";

interface MobileHeaderProps {
  activeNav: ActiveTab;
  onOpenQuickConnect?: () => void;
  onNewItem?: () => void;
}

const TAB_ICONS: Record<ActiveTab, typeof Server> = {
  hosts: Server,
  terminal: Terminal,
  keychain: KeyRound,
  workspaces: Server,
  sftp: FolderOpen,
  snippets: Braces,
  tunnels: Waypoints,
  settings: Settings,
};

export function MobileHeader({ activeNav, onNewItem }: MobileHeaderProps) {
  const { t } = useTranslation();
  const isVaultInitialized = useVaultStore((s) => s.isInitialized);
  const lockApp = useVaultStore((s) => s.lockApp);
  const tabsCount = useSessionStore((s) => s.tabs.length);
  const openHostModal = useHostStore((s) => s.openCreateModal);

  const Icon = TAB_ICONS[activeNav] || Server;

  const getTitle = () => {
    switch (activeNav) {
      case "hosts": return t("nav.hosts");
      case "terminal": return t("nav.terminal");
      case "keychain": return t("nav.keychain");
      case "workspaces": return t("nav.workspaces");
      case "sftp": return t("nav.sftp");
      case "snippets": return t("nav.snippets");
      case "tunnels": return t("nav.tunnels");
      case "settings": return t("nav.settings");
      default: return "Termimus";
    }
  };

  return (
    <header className="flex h-13 w-full shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-container)] px-3 pt-[env(safe-area-inset-top,0px)] select-none">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-high)] text-[var(--primary)] shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{getTitle()}</h1>
          <p className="text-[10px] text-[var(--text-muted)] leading-none">
            {activeNav === "terminal" ? `${tabsCount} active session${tabsCount !== 1 ? "s" : ""}` : "Termimus"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {/* New Item Button for Hosts */}
        {activeNav === "hosts" && (
          <button
            type="button"
            onClick={() => {
              if (onNewItem) onNewItem();
              else openHostModal();
            }}
            className="flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-semibold text-black shadow-sm active:opacity-80 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>{t("hosts.newHost")}</span>
          </button>
        )}

        {/* Lock App Button */}
        {isVaultInitialized && (
          <button
            type="button"
            onClick={lockApp}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-secondary)] active:text-[var(--text-primary)] cursor-pointer"
            title="Lock App"
          >
            <Lock className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
