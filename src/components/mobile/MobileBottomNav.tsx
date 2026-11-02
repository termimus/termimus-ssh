import { useTranslation } from "react-i18next";
import {
  Server,
  Terminal,
  KeyRound,
  Settings,
  FolderOpen,
  Braces,
} from "lucide-react";
import { ActiveTab } from "../layout/Sidebar";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useTunnelStore } from "../../stores/useTunnelStore";

interface MobileBottomNavProps {
  activeNav: ActiveTab;
  onNavChange: (tab: ActiveTab) => void;
}

export function MobileBottomNav({ activeNav, onNavChange }: MobileBottomNavProps) {
  const { t } = useTranslation();
  const tabsCount = useSessionStore((s) => s.tabs.length);
  const hostsCount = useHostStore((s) => s.hosts.length);
  const activeTunnelsCount = useTunnelStore((s) => s.activeRuleIds.size);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof Server;
    badge?: number;
    badgeDot?: boolean;
  }> = [
    {
      id: "hosts",
      label: t("nav.hosts"),
      icon: Server,
      badge: hostsCount || undefined,
    },
    {
      id: "terminal",
      label: t("nav.terminal"),
      icon: Terminal,
      badge: tabsCount || undefined,
    },
    {
      id: "keychain",
      label: t("nav.keychain"),
      icon: KeyRound,
    },
    {
      id: "sftp",
      label: "SFTP",
      icon: FolderOpen,
    },
    {
      id: "snippets",
      label: t("nav.snippets"),
      icon: Braces,
    },
    {
      id: "settings",
      label: t("nav.settings"),
      icon: Settings,
      badgeDot: activeTunnelsCount > 0,
    },
  ];

  return (
    <nav className="flex w-full shrink-0 items-center justify-around border-t border-[var(--border)] bg-[var(--surface-container)] px-1 py-1 pb-1.5 select-none z-20">
      {navItems.map(({ id, label, icon: Icon, badge, badgeDot }) => {
        const active = activeNav === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavChange(id)}
            className={`relative flex min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-center transition-colors active:scale-95 cursor-pointer ${
              active
                ? "text-[var(--primary)] font-semibold"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <div className="relative flex items-center justify-center">
              <Icon className={`h-5 w-5 transition-transform ${active ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
              {badge !== undefined && badge > 0 && (
                <span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[9px] font-bold text-black leading-none">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
              {badgeDot && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[var(--surface-container)]" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
