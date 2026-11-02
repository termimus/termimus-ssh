import React from "react";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileTerminalView } from "./MobileTerminalView";
import { HostList } from "../hosts/HostList";
import { SftpView } from "../sftp/SftpView";
import { KeychainView } from "../keychain/KeychainView";
import { SnippetView } from "../snippets/SnippetView";
import { TunnelView } from "../tunnels/TunnelView";
import { SettingsView } from "../settings/SettingsView";
import { WorkspaceView } from "../workspaces/WorkspaceView";
import { ActiveTab } from "../layout/Sidebar";

function MobilePageView({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 5 : 0,
      }}
    >
      {children}
    </div>
  );
}

interface MobileLayoutProps {
  activeNav: ActiveTab;
  onNavChange: (tab: ActiveTab) => void;
  visitedTabs: Set<ActiveTab>;
  onOpenTerminal: () => void;
  onOpenHosts: () => void;
  onOpenSftp: () => void;
  onOpenTunnels: () => void;
}

export function MobileLayout({
  activeNav,
  onNavChange,
  visitedTabs,
  onOpenTerminal,
  onOpenHosts,
  onOpenSftp,
  onOpenTunnels,
}: MobileLayoutProps) {
  const showTerminal = activeNav === "terminal";

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] text-[var(--text-primary)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]">
      {/* Mobile Header (Hidden or compact when terminal is active to maximize screen) */}
      {!showTerminal && (
        <MobileHeader
          activeNav={activeNav}
        />
      )}

      {/* Main View Area */}
      <main className="relative flex flex-1 overflow-hidden bg-[var(--canvas)]">
        {/* Mobile Terminal View */}
        <MobileTerminalView
          visible={showTerminal}
          onOpenHosts={onOpenHosts}
        />

        {/* Lazy Keep-Alive Views for Mobile */}
        {visitedTabs.has("hosts") && (
          <MobilePageView active={activeNav === "hosts"}>
            <HostList
              onOpenTerminal={onOpenTerminal}
              onOpenSftp={onOpenSftp}
              onOpenTunnels={onOpenTunnels}
            />
          </MobilePageView>
        )}

        {visitedTabs.has("keychain") && (
          <MobilePageView active={activeNav === "keychain"}>
            <KeychainView />
          </MobilePageView>
        )}

        {visitedTabs.has("sftp") && (
          <MobilePageView active={activeNav === "sftp"}>
            <SftpView />
          </MobilePageView>
        )}

        {visitedTabs.has("workspaces") && (
          <MobilePageView active={activeNav === "workspaces"}>
            <WorkspaceView onOpenTerminal={onOpenTerminal} />
          </MobilePageView>
        )}

        {visitedTabs.has("snippets") && (
          <MobilePageView active={activeNav === "snippets"}>
            <SnippetView />
          </MobilePageView>
        )}

        {visitedTabs.has("tunnels") && (
          <MobilePageView active={activeNav === "tunnels"}>
            <TunnelView />
          </MobilePageView>
        )}

        {visitedTabs.has("settings") && (
          <MobilePageView active={activeNav === "settings"}>
            <SettingsView />
          </MobilePageView>
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <MobileBottomNav
        activeNav={activeNav}
        onNavChange={onNavChange}
      />
    </div>
  );
}
