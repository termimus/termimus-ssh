import React from "react";
import { ResizeHandles } from "../layout/ResizeHandles";
import { Header } from "../layout/Header";
import { Sidebar, ActiveTab } from "../layout/Sidebar";
import { TerminalWorkspace } from "../terminal/TerminalWorkspace";
import { WorkspaceView } from "../workspaces/WorkspaceView";
import { HostList } from "../hosts/HostList";
import { SftpView } from "../sftp/SftpView";
import { KeychainView } from "../keychain/KeychainView";
import { TunnelView } from "../tunnels/TunnelView";
import { SnippetView } from "../snippets/SnippetView";
import { SettingsView } from "../settings/SettingsView";
import { useDeviceLayout } from "../../hooks/useDeviceLayout";

function DesktopPageView({ active, children }: { active: boolean; children: React.ReactNode }) {
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

interface DesktopLayoutProps {
  activeNav: ActiveTab;
  onNavChange: (tab: ActiveTab) => void;
  visitedTabs: Set<ActiveTab>;
  onOpenTerminal: () => void;
  onOpenHosts: () => void;
  onOpenSftp: () => void;
  onOpenTunnels: () => void;
  onOpenWorkspaces: () => void;
  onOpenSettings: () => void;
}

export function DesktopLayout({
  activeNav,
  onNavChange,
  visitedTabs,
  onOpenTerminal,
  onOpenHosts,
  onOpenSftp,
  onOpenTunnels,
  onOpenWorkspaces,
  onOpenSettings,
}: DesktopLayoutProps) {
  const { isAndroidOrIos } = useDeviceLayout();
  const showTerminal = activeNav === "terminal";

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] text-[var(--text-primary)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]">
      {/* Invisible edge/corner handles restoring OS resize cursors on desktop frameless window (omitted on mobile/tablet) */}
      {!isAndroidOrIos && <ResizeHandles />}

      {/* Top Unified Window Bar: Insets safe area on tablet, hides minimize/maximize/close buttons on mobile/tablet */}
      <Header
        activeNav={activeNav}
        onGoHome={onOpenHosts}
        onSelectTab={onOpenTerminal}
        onOpenSyncSettings={onOpenSettings}
        isTerminalActive={showTerminal}
        hideWindowActions={isAndroidOrIos}
      />

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Obsidian Sidebar — hidden when terminal is active so terminal gets fullscreen width */}
        {!showTerminal && (
          <Sidebar
            activeNav={activeNav}
            onNavChange={onNavChange}
          />
        )}

        {/* Viewport Content Area */}
        <main className="relative flex flex-1 overflow-hidden bg-[var(--canvas)]">
          {/* Terminal sessions stay mounted and retain their layout geometry (never collapse to 0x0),
              preventing bogus SIGWINCH resize events (which breaks htop/curses TUIs). */}
          <TerminalWorkspace
            visible={showTerminal}
            onOpenWorkspaces={onOpenWorkspaces}
          />

          {/* Lazy-mounted Native-Grade Keep-Alive Views */}
          {visitedTabs.has("workspaces") && (
            <DesktopPageView active={activeNav === "workspaces"}>
              <WorkspaceView onOpenTerminal={onOpenTerminal} />
            </DesktopPageView>
          )}

          {visitedTabs.has("hosts") && (
            <DesktopPageView active={activeNav === "hosts"}>
              <HostList
                onOpenTerminal={onOpenTerminal}
                onOpenSftp={onOpenSftp}
                onOpenTunnels={onOpenTunnels}
              />
            </DesktopPageView>
          )}

          {visitedTabs.has("sftp") && (
            <DesktopPageView active={activeNav === "sftp"}>
              <SftpView />
            </DesktopPageView>
          )}

          {visitedTabs.has("keychain") && (
            <DesktopPageView active={activeNav === "keychain"}>
              <KeychainView />
            </DesktopPageView>
          )}

          {visitedTabs.has("tunnels") && (
            <DesktopPageView active={activeNav === "tunnels"}>
              <TunnelView />
            </DesktopPageView>
          )}

          {visitedTabs.has("snippets") && (
            <DesktopPageView active={activeNav === "snippets"}>
              <SnippetView />
            </DesktopPageView>
          )}

          {visitedTabs.has("settings") && (
            <DesktopPageView active={activeNav === "settings"}>
              <SettingsView />
            </DesktopPageView>
          )}
        </main>
      </div>
    </div>
  );
}
