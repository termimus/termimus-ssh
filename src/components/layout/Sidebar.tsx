import {
  Server,
  Layers,
  FolderOpen,
  Braces,
  Waypoints,
  KeyRound,
  Settings,
  CloudCheck,
  Lock,
  ArrowUpCircle,
} from "lucide-react";
import { useVaultStore } from "../../stores/useVaultStore";
import { useHostStore } from "../../stores/useHostStore";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useUpdateStore } from "../../stores/useUpdateStore";
import { openExternalUrl } from "../../lib/openUrl";
import kofiIcon from "../../assets/kofi.png";

export type ActiveTab = "hosts" | "workspaces" | "terminal" | "sftp" | "keychain" | "tunnels" | "snippets" | "settings";

interface SidebarProps {
  activeNav: ActiveTab;
  onNavChange: (tab: ActiveTab) => void;
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  const { isUnlocked, lock: lockVault } = useVaultStore();
  const { hosts } = useHostStore();
  const { snippets } = useSnippetStore();
  const { activeRuleIds } = useTunnelStore();
  const { items: keychainItems } = useKeychainStore();
  const { presets } = useWorkspaceStore();
  const { currentVersion, latestVersion, hasUpdate, releaseUrl } = useUpdateStore();

  const navItems: {
    icon: typeof Server;
    label: string;
    id: ActiveTab;
    badge?: string | number;
    badgeDot?: boolean;
  }[] = [
    { icon: Server, label: "Hosts", id: "hosts", badge: hosts.length || undefined },
    { icon: KeyRound, label: "Keychain", id: "keychain", badge: keychainItems.length || undefined },
    { icon: Layers, label: "Workspaces", id: "workspaces", badge: presets.length || undefined },
    { icon: FolderOpen, label: "SFTP Browser", id: "sftp" },
    { icon: Braces, label: "Snippets & Scripts", id: "snippets", badge: snippets.length || undefined },
    { icon: Waypoints, label: "Port Forwarding", id: "tunnels", badgeDot: activeRuleIds.size > 0 },
  ];

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--canvas)] select-none">
      {/* Navigation Items */}
      <nav className="flex flex-1 flex-col w-full overflow-y-auto gap-1 px-3 pt-3 pb-1">
        {navItems.map(({ icon: Icon, label, id, badge, badgeDot }, idx) => {
          const active = activeNav === id;
          return (
            <button
              key={`${id}-${idx}`}
              onClick={() => onNavChange(id)}
              className={`group relative flex h-10 w-full items-center rounded-xl transition-colors text-left overflow-hidden ${
                active
                  ? "bg-[var(--surface-high)] text-[var(--primary)] font-semibold shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                <Icon
                  size={18}
                  className={`shrink-0 transition-colors ${
                    active
                      ? "text-[var(--primary)]"
                      : "text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                  }`}
                />
              </div>
              <span
                className={`flex-1 text-left truncate text-[13px] ${
                  active ? "font-bold" : "font-medium"
                }`}
              >
                {label}
              </span>
              {(badge !== undefined || badgeDot) && (
                <div className="flex shrink-0 items-center pr-2.5">
                  {badge !== undefined && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                        active
                          ? "bg-[var(--surface-highest)] text-[var(--text-secondary)]"
                          : "bg-[var(--surface-container)] text-[var(--text-muted)]"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                  {badgeDot && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--secondary)]" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Pinned Bottom Section: Settings, Vault Status & Micro Footer */}
      <div className="shrink-0 flex flex-col w-full border-t border-[var(--border)] bg-[var(--surface-low)]">
        {/* Settings Action */}
        <div className="w-full px-3 pt-2 pb-0.5">
          <button
            onClick={() => onNavChange("settings")}
            className={`group relative flex h-10 w-full items-center rounded-xl transition-colors text-left overflow-hidden ${
              activeNav === "settings"
                ? "bg-[var(--surface-high)] text-[var(--primary)] font-semibold shadow-sm"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)]"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center relative">
              <Settings
                size={18}
                className={`shrink-0 transition-colors ${
                  activeNav === "settings"
                    ? "text-[var(--primary)]"
                    : "text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                }`}
              />
            </div>
            <span className="flex-1 text-left truncate text-[13px] font-medium">
              Settings
            </span>
            {hasUpdate && (
              <span className="mr-2 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[var(--primary)] border border-[var(--primary)]/30 animate-pulse">
                Update
              </span>
            )}
          </button>
        </div>

        {/* Vault Status & Micro-Footer */}
        <div className="w-full px-3 pb-2 pt-0.5">
          <div className="flex h-8 w-full items-center justify-between">
            <div className="flex min-w-0 items-center">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--surface-container)] cursor-default transition-colors">
                <CloudCheck
                  size={18}
                  className={isUnlocked ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}
                />
                {isUnlocked && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
                )}
              </div>
              <span className="ml-2 text-[11px] font-semibold text-[var(--text-primary)] truncate">
                {isUnlocked ? "Vault Unlocked" : "Vault Locked"}
              </span>
            </div>
            {isUnlocked && (
              <button
                onClick={lockVault}
                title="Lock vault"
                className="shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--warning)] cursor-pointer"
              >
                <Lock size={13} />
              </button>
            )}
          </div>

          {/* Micro Footer: Version / Update (left) + Mini Ko-fi pill (right) */}
          <div className="flex items-center justify-between overflow-hidden whitespace-nowrap px-1 pt-1.5 border-t border-[var(--border)]/40 mt-1">
            {hasUpdate ? (
              <button
                type="button"
                onClick={() => openExternalUrl(releaseUrl)}
                title={`Update available: v${latestVersion}. Click to open release page.`}
                className="group/upd flex items-center gap-1 font-mono text-[10px] text-[var(--primary)] hover:underline cursor-pointer font-semibold transition-colors"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--primary)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--primary)]" />
                </span>
                <span>Update v{latestVersion}</span>
                <ArrowUpCircle size={10} className="shrink-0 group-hover/upd:translate-y-[-1px] transition-transform" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavChange("settings")}
                title={`Termimus v${currentVersion} (Click to open Settings & About)`}
                className="font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer select-none"
              >
                v{currentVersion}
              </button>
            )}

            {/* Compact Ko-fi link */}
            <button
              type="button"
              onClick={() => openExternalUrl("https://ko-fi.com/termimus")}
              title="Support Termimus on Ko-fi"
              className="group/kofi inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
            >
              <img
                src={kofiIcon}
                alt="Ko-fi"
                className="w-3.5 h-auto object-contain transition-transform group-hover/kofi:scale-110 drop-shadow-xs"
              />
              <span className="font-medium">Support</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
