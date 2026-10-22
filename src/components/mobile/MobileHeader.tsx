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

const TAB_TITLES: Record<ActiveTab, { title: string; icon: typeof Server }> = {
  hosts: { title: "Hosts", icon: Server },
  terminal: { title: "Terminal", icon: Terminal },
  keychain: { title: "Keychain", icon: KeyRound },
  workspaces: { title: "Workspaces", icon: Server },
  sftp: { title: "SFTP Browser", icon: FolderOpen },
  snippets: { title: "Snippets", icon: Braces },
  tunnels: { title: "Port Forwarding", icon: Waypoints },
  settings: { title: "Settings", icon: Settings },
};

export function MobileHeader({ activeNav, onNewItem }: MobileHeaderProps) {
  const { isUnlocked, lock: lockVault } = useVaultStore();
  const tabsCount = useSessionStore((s) => s.tabs.length);
  const openHostModal = useHostStore((s) => s.openCreateModal);

  const { title, icon: Icon } = TAB_TITLES[activeNav] || { title: "Termimus", icon: Server };

  return (
    <header className="flex h-13 w-full shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-container)] px-3 pt-[env(safe-area-inset-top,0px)] select-none">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-high)] text-[var(--primary)] shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{title}</h1>
          <p className="text-[10px] text-[var(--text-muted)] leading-none">
            {activeNav === "terminal" ? `${tabsCount} active session${tabsCount > 1 ? "s" : ""}` : "Termimus"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* New Item Button for Hosts */}
        {activeNav === "hosts" && (
          <button
            type="button"
            onClick={() => {
              if (onNewItem) onNewItem();
              else openHostModal();
            }}
            className="flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-semibold text-black shadow-sm active:opacity-80"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Host</span>
          </button>
        )}

        {/* Lock Vault Button */}
        {isUnlocked && (
          <button
            type="button"
            onClick={lockVault}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-secondary)] active:text-[var(--text-primary)]"
            title="Lock Vault"
          >
            <Lock className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
