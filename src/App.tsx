import { useEffect, useState, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useVaultStore } from "./stores/useVaultStore";
import { useHostStore } from "./stores/useHostStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useSnippetStore } from "./stores/useSnippetStore";
import { useTunnelStore } from "./stores/useTunnelStore";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useKeychainStore } from "./stores/useKeychainStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { useAutoLock } from "./hooks/useAutoLock";
import { useLiveSync } from "./hooks/useLiveSync";
import { useDeviceLayout } from "./hooks/useDeviceLayout";
import { ActiveTab } from "./components/layout/Sidebar";
import { DesktopLayout } from "./components/desktop/DesktopLayout";
import { MobileLayout } from "./components/mobile/MobileLayout";
import { HostModal } from "./components/hosts/HostModal";
import { VaultModal } from "./components/vault/VaultModal";
import { AppLockScreen } from "./components/vault/AppLockScreen";
import { SnippetModal } from "./components/snippets/SnippetModal";
import { ConfirmModal } from "./components/layout/ConfirmModal";

function App() {
  const { isMobile } = useDeviceLayout();
  const [activeNav, setActiveNav] = useState<ActiveTab>("hosts");
  const [visitedTabs, setVisitedTabs] = useState<Set<ActiveTab>>(() => new Set(["hosts"]));

  const isUnlocked = useVaultStore((s) => s.isUnlocked);
  const isAppLocked = useVaultStore((s) => s.isAppLocked);
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

  // Enforce small minimum window size on desktop so users can snap/tile to half screen
  useEffect(() => {
    if (!isMobile) {
      getCurrentWindow()
        .setMinSize(new LogicalSize(480, 360))
        .catch(() => {});
    }
  }, [isMobile]);

  useEffect(() => {
    refreshVault();
    useUpdateStore.getState().init();
  }, [refreshVault]);

  useEffect(() => {
    if (isUnlocked) {
      // Preload all domain data in parallel on unlock so badges and tabs
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
  useEffect(() => {
    if (tabsCount > prevTabsCountRef.current) {
      handleNavChange("terminal");
    } else if (prevTabsCountRef.current > 0 && tabsCount === 0 && activeNav === "terminal") {
      handleNavChange("hosts");
    }
    prevTabsCountRef.current = tabsCount;
  }, [tabsCount, activeNav, handleNavChange]);

  // Disable default browser context menu across the app (sidebar, empty areas, cards).
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

  return (
    <>
      {/* Dynamic Responsive Layout: Mobile Phone (< 768px) vs Desktop/Tablet (>= 768px) */}
      {isMobile ? (
        <MobileLayout
          activeNav={activeNav}
          onNavChange={handleNavChange}
          visitedTabs={visitedTabs}
          onOpenTerminal={openTerminal}
          onOpenHosts={openHosts}
          onOpenSftp={openSftp}
          onOpenTunnels={openTunnels}
        />
      ) : (
        <DesktopLayout
          activeNav={activeNav}
          onNavChange={handleNavChange}
          visitedTabs={visitedTabs}
          onOpenTerminal={openTerminal}
          onOpenHosts={openHosts}
          onOpenSftp={openSftp}
          onOpenTunnels={openTunnels}
          onOpenWorkspaces={openWorkspaces}
          onOpenSettings={openSettings}
        />
      )}

      {/* Full App Lock Screen (Header padlock): opaque overlay above everything,
          sessions/terminals keep running underneath */}
      {isAppLocked && <AppLockScreen />}

      {/* Vault Setup/Unlock Modal (superseded by AppLockScreen while app-locked) */}
      {!isUnlocked && !isAppLocked && <VaultModal />}
      <HostModal onOpenKeychain={openKeychain} />
      <SnippetModal />
      <ConfirmModal />
    </>
  );
}

export default App;
