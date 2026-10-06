import { useEffect, useState, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useVaultStore } from "./stores/useVaultStore";
import { useHostStore } from "./stores/useHostStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useSnippetStore } from "./stores/useSnippetStore";
import { useTunnelStore } from "./stores/useTunnelStore";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { Sidebar, ActiveTab } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { ResizeHandles } from "./components/layout/ResizeHandles";
import { HostList } from "./components/hosts/HostList";
import { HostModal } from "./components/hosts/HostModal";
import { VaultModal } from "./components/vault/VaultModal";
import { TerminalWorkspace } from "./components/terminal/TerminalWorkspace";
import { WorkspaceView } from "./components/workspaces/WorkspaceView";
import { SftpView } from "./components/sftp/SftpView";
import { TunnelView } from "./components/tunnels/TunnelView";
import { SnippetView } from "./components/snippets/SnippetView";
import { KeychainView } from "./components/keychain/KeychainView";
import { ConfirmModal } from "./components/layout/ConfirmModal";
import { SnippetModal } from "./components/snippets/SnippetModal";
import { SettingsView } from "./components/settings/SettingsView";
import { useKeychainStore } from "./stores/useKeychainStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { useAutoLock } from "./hooks/useAutoLock";
import { useLiveSync } from "./hooks/useLiveSync";

// Helper component for native-feel stacked views:
// Keeps views mounted in the DOM once visited, switching visibility in 0ms
// with zero unmount cost, zero redundant IPC fetches, and perfect scroll/input preservation.
function PageView({ active, children }: { active: boolean; children: React.ReactNode }) {
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

function App() {
  const [activeNav, setActiveNav] = useState<ActiveTab>("hosts");
  const [visitedTabs, setVisitedTabs] = useState<Set<ActiveTab>>(() => new Set(["hosts"]));

  const isUnlocked = useVaultStore((s) => s.isUnlocked);
  const refreshVault = useVaultStore((s) => s.refresh);
  const refreshHosts = useHostStore((s) => s.refresh);
  const refreshKeychain = useKeychainStore((s) => s.refresh);
  const tabsCount = useSessionStore((s) => s.tabs.length);
  const prevTabsCountRef = useRef(tabsCount);

  const handleNavChange = useCallback((tab: ActiveTab) => {
    setActiveNav(tab);
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const openHosts = useCallback(() => handleNavChange("hosts"), [handleNavChange]);
  const openTerminal = useCallback(() => handleNavChange("terminal"), [handleNavChange]);
  const openSftp = useCallback(() => handleNavChange("sftp"), [handleNavChange]);
  const openTunnels = useCallback(() => handleNavChange("tunnels"), [handleNavChange]);
  const openWorkspaces = useCallback(() => handleNavChange("workspaces"), [handleNavChange]);
  const openKeychain = useCallback(() => handleNavChange("keychain"), [handleNavChange]);
  const openSettings = useCallback(() => handleNavChange("settings"), [handleNavChange]);

  // Active auto-lock watcher based on user settings (idle timer, focus loss, on-close).
  useAutoLock();

  // Background real-time WebSocket live sync manager
  useLiveSync();

  // Enforce small minimum window size (480x360) so users can snap/tile to half screen
  // on sub-1080p displays (e.g. 1366x768 half is 683px, 1280x800 half is 640px).
  useEffect(() => {
    getCurrentWindow()
      .setMinSize(new LogicalSize(480, 360))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshVault();
    useUpdateStore.getState().init();
  }, [refreshVault]);

  useEffect(() => {
    if (isUnlocked) {
      // Preload all domain data in parallel on unlock so sidebar badges and tabs
      // are instantly available with zero spinner delay.
      refreshHosts();
      refreshKeychain();
      useSnippetStore.getState().refresh();
      useTunnelStore.getState().refresh();
      useWorkspaceStore.getState().refresh();
    }
  }, [isUnlocked, refreshHosts, refreshKeychain]);

  // When a new tab/session is opened, switch to the terminal view;
  // when all tabs close, automatically return to hosts view.
  // Note: Only tracks tabsCount changes, so switching active tabs causes ZERO App re-renders.
  useEffect(() => {
    if (tabsCount > prevTabsCountRef.current) {
      handleNavChange("terminal");
    } else if (prevTabsCountRef.current > 0 && tabsCount === 0 && activeNav === "terminal") {
      handleNavChange("hosts");
    }
    prevTabsCountRef.current = tabsCount;
  }, [tabsCount, activeNav, handleNavChange]);

  // Disable default browser context menu across the app (sidebar, empty areas, cards).
  // Dedicated custom context menus (Terminal in XtermView, Tabs in Header) handle their own events.
  useEffect(() => {
    function handleGlobalContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (!isInput) {
        e.preventDefault();
      }
    }
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => window.removeEventListener("contextmenu", handleGlobalContextMenu);
  }, []);

  const showTerminal = activeNav === "terminal";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--canvas)] text-[var(--text-primary)]">
      {/* Invisible edge/corner handles restoring OS resize cursors on this frameless window */}
      <ResizeHandles />

      {/* Top Unified Frameless Window Bar (Termius-style: Menu + Tabs + Window Controls) */}
      <Header
        activeNav={activeNav}
        onGoHome={openHosts}
        onSelectTab={openTerminal}
        onOpenSyncSettings={openSettings}
        isTerminalActive={showTerminal}
      />

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Obsidian Sidebar — hidden when terminal is active so terminal gets fullscreen width */}
        {!showTerminal && (
          <Sidebar
            activeNav={activeNav}
            onNavChange={handleNavChange}
          />
        )}

        {/* Viewport Content Area */}
        <main className="relative flex flex-1 overflow-hidden bg-[var(--canvas)]">
          {/* Terminal sessions stay mounted and retain their layout geometry (never collapse to 0x0),
              preventing bogus SIGWINCH resize events (which breaks htop/curses TUIs). */}
          <TerminalWorkspace
            visible={showTerminal}
            onOpenWorkspaces={openWorkspaces}
          />

          {/* Lazy-mounted Native-Grade Keep-Alive Views:
              Each view is mounted on first visit and preserved across tab switches.
              Switches happen in 0ms (1 frame), scroll positions are remembered,
              and inputs/folder drill-downs stay intact. */}
          {visitedTabs.has("workspaces") && (
            <PageView active={activeNav === "workspaces"}>
              <WorkspaceView onOpenTerminal={openTerminal} />
            </PageView>
          )}

          {visitedTabs.has("hosts") && (
            <PageView active={activeNav === "hosts"}>
              <HostList
                onOpenTerminal={openTerminal}
                onOpenSftp={openSftp}
                onOpenTunnels={openTunnels}
              />
            </PageView>
          )}

          {visitedTabs.has("sftp") && (
            <PageView active={activeNav === "sftp"}>
              <SftpView />
            </PageView>
          )}

          {visitedTabs.has("keychain") && (
            <PageView active={activeNav === "keychain"}>
              <KeychainView />
            </PageView>
          )}

          {visitedTabs.has("tunnels") && (
            <PageView active={activeNav === "tunnels"}>
              <TunnelView />
            </PageView>
          )}

          {visitedTabs.has("snippets") && (
            <PageView active={activeNav === "snippets"}>
              <SnippetView />
            </PageView>
          )}

          {visitedTabs.has("settings") && (
            <PageView active={activeNav === "settings"}>
              <SettingsView />
            </PageView>
          )}
        </main>
      </div>

      {/* Vault Setup/Unlock Modal */}
      {!isUnlocked && <VaultModal />}

      {/* Host Create/Edit Modal */}
      <HostModal onOpenKeychain={openKeychain} />

      {/* Snippet Create/Edit Modal */}
      <SnippetModal />

      {/* App-wide Delete & Action Confirmation Modal */}
      <ConfirmModal />
    </div>
  );
}

export default App;
