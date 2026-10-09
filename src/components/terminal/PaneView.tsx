import {
  Columns2,
  Rows2,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  Radio,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { PaneLeaf, findPaneById } from "../../lib/layoutTree";
import { useSessionStore } from "../../stores/useSessionStore";
import { useHostStore } from "../../stores/useHostStore";
import { useTerminalThemeStore } from "../../stores/useTerminalThemeStore";
import { getTerminalTheme } from "../../lib/terminalThemes";
import { XtermView } from "./XtermView";
import { DropZoneOverlay } from "./DropZoneOverlay";

interface PaneViewProps {
  pane: PaneLeaf;
  visible?: boolean;
}

export function PaneView({ pane, visible = true }: PaneViewProps) {
  const {
    tabs,
    groups,
    rootPane,
    activePaneId,
    activeGroupId,
    maximizedPaneId,
    focusPane,
    setPaneTab,
    closeSession,
    toggleMaximizePane,
    splitPane,
    startDragTab,
    openSessionInSplit,
    broadcastGroupIds,
    toggleGroupBroadcast,
  } = useSessionStore(
    useShallow((s) => ({
      tabs: s.tabs,
      groups: s.groups,
      rootPane: s.rootPane,
      activePaneId: s.activePaneId,
      activeGroupId: s.activeGroupId,
      maximizedPaneId: s.maximizedPaneId,
      focusPane: s.focusPane,
      setPaneTab: s.setPaneTab,
      closeSession: s.closeSession,
      toggleMaximizePane: s.toggleMaximizePane,
      splitPane: s.splitPane,
      startDragTab: s.startDragTab,
      openSessionInSplit: s.openSessionInSplit,
      broadcastGroupIds: s.broadcastGroupIds,
      toggleGroupBroadcast: s.toggleGroupBroadcast,
    }))
  );

  const hosts = useHostStore((s) => s.hosts);
  const themeId = useTerminalThemeStore((s) => s.themeId);
  const themeBg = getTerminalTheme(themeId).xterm.background ?? "#0a0e14";
  const isFocused = activePaneId === pane.id;
  const isMaximized = maximizedPaneId === pane.id;

  // Blend the pane header's background/border with the active terminal theme
  // (instead of a fixed --surface color) so a split layout reads as one
  // cohesive panel regardless of which theme (dark or light) is active.
  const isLight = (() => {
    const c = themeBg.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16) || 0;
    const g = parseInt(c.slice(2, 4), 16) || 0;
    const b = parseInt(c.slice(4, 6), 16) || 0;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  })();

  const headerBg = isFocused
    ? isLight
      ? "rgba(0, 0, 0, 0.05)"
      : "rgba(255, 255, 255, 0.06)"
    : isLight
      ? "rgba(0, 0, 0, 0.08)"
      : "rgba(0, 0, 0, 0.28)";

  const headerBorder = isFocused
    ? "rgba(0, 210, 180, 0.35)"
    : isLight
      ? "rgba(0, 0, 0, 0.12)"
      : "rgba(255, 255, 255, 0.08)";

  const currentGroup = groups.find((g) => findPaneById(g.rootPane, pane.id));
  const groupId = currentGroup ? currentGroup.id : (activeGroupId || undefined);
  const isBroadcast = groupId ? broadcastGroupIds.includes(groupId) : false;

  // The pane header is only shown when the workspace is actually split into multiple panes.
  // When there's only 1 pane (or when a pane is maximized), the top window Header acts as the sole tab bar,
  // preventing double/duplicate tab UI and maximizing terminal vertical space.
  const currentRootPane = currentGroup ? currentGroup.rootPane : rootPane;
  const isSplit = currentRootPane?.type === "split" && !maximizedPaneId;

  const activeTab = tabs.find((t) => t.id === pane.activeTabId);
  const paneTabs = pane.tabIds
    .map((id) => tabs.find((t) => t.id === id))
    .filter(Boolean);

  const handlePointerDownTab = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string
  ) => {
    if (e.button !== 0) return; // Only primary button

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - e.clientX;
      const dy = moveEvent.clientY - e.clientY;
      if (Math.hypot(dx, dy) > 5) {
        startDragTab(tabId, pane.id, moveEvent.clientX, moveEvent.clientY);
        cleanup();
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const handleSplitRight = () => {
    if (!activeTab) return;
    // If pane has another tab, split that tab off to the right
    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "row", "second");
      return;
    }

    // Otherwise, duplicate current session to the same host in a right split atomically
    const host = hosts.find((h) => h.id === activeTab.hostId);
    if (host) {
      openSessionInSplit(host, pane.id, "row", "second");
    }
  };

  const handleSplitDown = () => {
    if (!activeTab) return;
    // If pane has another tab, split that tab off down
    const otherTabId = pane.tabIds.find((id) => id !== pane.activeTabId);
    if (otherTabId) {
      splitPane(pane.id, otherTabId, "column", "second");
      return;
    }

    // Otherwise, duplicate current session to the same host in a down split atomically
    const host = hosts.find((h) => h.id === activeTab.hostId);
    if (host) {
      openSessionInSplit(host, pane.id, "column", "second");
    }
  };

  return (
    <div
      onClick={() => focusPane(pane.id)}
      style={{ backgroundColor: themeBg }}
      className={`relative flex h-full w-full flex-col overflow-hidden transition-all ${
        isSplit
          ? isBroadcast
            ? isFocused
              ? "ring-2 ring-[var(--primary)] shadow-md"
              : "ring-1 ring-[var(--primary)]/50"
            : isFocused
              ? "ring-1 ring-[var(--primary)]/70 shadow-sm"
              : isLight
                ? "ring-1 ring-black/15"
                : "ring-1 ring-white/10"
          : ""
      }`}
    >
      {/* Pane Header — Cohesively tinted with the active terminal theme */}
      {isSplit && (
        <div
          style={{
            backgroundColor: headerBg,
            borderBottomColor: headerBorder,
          }}
          className="flex h-6.5 w-full shrink-0 select-none items-center justify-between border-b px-2 text-xs transition-colors"
        >
          {/* Left: Server info (or mini-tabs if multiple sessions docked in this single pane) */}
          <div className="flex h-full flex-1 items-center gap-1.5 overflow-x-auto py-0.5 min-w-0">
            {paneTabs.length > 1 ? (
              paneTabs.map((tab) => {
                if (!tab) return null;
                const isActiveInPane = tab.id === pane.activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPaneTab(pane.id, tab.id);
                      focusPane(pane.id);
                    }}
                    onPointerDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        closeSession(tab.id);
                        return;
                      }
                      handlePointerDownTab(e, tab.id);
                    }}
                    title="Drag to split screen or dock. Middle-click or ✕ to close."
                    className={`group relative flex h-5.5 max-w-[160px] cursor-grab active:cursor-grabbing items-center gap-1.5 rounded-md px-2 text-[11px] font-mono transition-all select-none ${
                      isActiveInPane
                        ? isFocused
                          ? isLight
                            ? "bg-black/10 text-black border border-[var(--primary)]/50 shadow-2xs font-medium"
                            : "bg-white/15 text-[var(--text-primary)] border border-[var(--primary)]/40 shadow-2xs font-medium"
                          : isLight
                            ? "bg-black/5 text-black/80 border border-black/10 font-medium"
                            : "bg-white/5 text-[var(--text-primary)] border border-white/10 font-medium"
                        : isLight
                          ? "text-black/60 hover:bg-black/5 hover:text-black border border-transparent"
                          : "text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)] border border-transparent"
                    }`}
                  >
                    {tab.connecting ? (
                      <Loader2 size={10} className="animate-spin text-[var(--primary)] shrink-0" />
                    ) : (
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          tab.connected ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]" : "bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.5)]"
                        }`}
                      />
                    )}
                    <span className="truncate flex-1 min-w-0 text-center leading-none translate-y-[0.5px]">{tab.hostLabel}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSession(tab.id);
                      }}
                      title="Close tab"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all cursor-pointer ${
                        isActiveInPane
                          ? "opacity-60 hover:opacity-100 hover:bg-white/15 text-[var(--text-muted)] hover:text-white"
                          : "opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-white/15 text-[var(--text-muted)] hover:text-white"
                      }`}
                    >
                      <X size={10} strokeWidth={2.2} />
                    </button>
                  </div>
                );
              })
            ) : (
              <div
                onPointerDown={(e) => activeTab && handlePointerDownTab(e, activeTab.id)}
                title="Drag to move or split pane"
                className="flex items-center gap-2 cursor-grab active:cursor-grabbing font-mono text-[11px] truncate select-none"
              >
                {activeTab?.connecting ? (
                  <Loader2 size={11} className="animate-spin text-[var(--primary)] shrink-0" />
                ) : (
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      activeTab?.connected ? "bg-[var(--primary)]" : "bg-[var(--danger)]"
                    }`}
                  />
                )}
                <span className="font-medium text-[var(--text-primary)] truncate">
                  {activeTab?.hostLabel || "Terminal"}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] truncate hidden sm:inline">
                  {activeTab?.hostAddress}
                </span>
                {isBroadcast && (
                  <span className="flex items-center gap-1 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-mono font-medium text-[var(--primary)] border border-[var(--primary)]/30 shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-ping shrink-0" />
                    SYNC
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right: Quick Split, Interconnection & Window Controls */}
          <div className="flex items-center gap-1 pl-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleGroupBroadcast(groupId);
              }}
              title={
                isBroadcast
                  ? "Broadcast Input Active — Click to disconnect terminals (Alt+B)"
                  : "Interconnect Terminals — Broadcast input to all split panes (Alt+B)"
              }
              className={`flex h-5 items-center gap-1 rounded px-1.5 text-xs transition-colors ${
                isBroadcast
                  ? "bg-[var(--primary)] text-black font-semibold shadow-sm hover:opacity-90"
                  : isLight
                    ? "text-black/60 hover:bg-black/10 hover:text-[var(--primary)]"
                    : "text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--primary)]"
              }`}
            >
              <Radio size={11} className={isBroadcast ? "animate-pulse" : ""} />
              <span className="text-[10px] font-mono">{isBroadcast ? "SYNC ON" : "SYNC"}</span>
            </button>
            <div className={`h-3 w-[1px] shrink-0 mx-0.5 ${isLight ? "bg-black/15" : "bg-white/15"}`} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSplitRight();
              }}
              title="Split Right (Columns)"
              className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                isLight
                  ? "text-black/60 hover:bg-black/10 hover:text-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--primary)]"
              }`}
            >
              <Columns2 size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSplitDown();
              }}
              title="Split Down (Rows)"
              className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                isLight
                  ? "text-black/60 hover:bg-black/10 hover:text-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--primary)]"
              }`}
            >
              <Rows2 size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximizePane(pane.id);
              }}
              title={isMaximized ? "Restore Split View" : "Maximize Pane"}
              className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                isLight
                  ? "text-black/60 hover:bg-black/10 hover:text-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--primary)]"
              }`}
            >
              {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (activeTab) {
                  closeSession(activeTab.id);
                }
              }}
              title="Close Active Terminal"
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--danger)] hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Terminal Viewport Area */}
      <div className="relative flex-1 overflow-hidden">
        {pane.tabIds.map((tabId) => {
          const tab = tabs.find((t) => t.id === tabId);
          if (!tab) return null;
          const isTabActive = tab.id === pane.activeTabId;

          return (
            <XtermView
              key={tab.id}
              sessionId={tab.id}
              hostId={tab.hostId}
              visible={visible && isTabActive}
              isFocused={isFocused && isTabActive}
            />
          );
        })}

        {/* Drop Zone Overlay (Split Indicators) when a tab is dragged */}
        <DropZoneOverlay paneId={pane.id} />
      </div>
    </div>
  );
}
