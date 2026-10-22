import { useCallback } from "react";
import { X, Terminal as TerminalIcon, Laptop } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../../stores/useSessionStore";
import { XtermView } from "../terminal/XtermView";
import { MobileAccessoryBar } from "./MobileAccessoryBar";
import { api } from "../../lib/api";

const textEncoder = new TextEncoder();

interface MobileTerminalViewProps {
  visible: boolean;
  onOpenHosts?: () => void;
}

export function MobileTerminalView({ visible, onOpenHosts }: MobileTerminalViewProps) {
  const { tabs, activeTabId, setActiveTab, closeSession } = useSessionStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      setActiveTab: s.setActiveTab,
      closeSession: s.closeSession,
    }))
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleSendInput = useCallback(
    (data: string) => {
      if (!activeTab) return;
      const encoded = Array.from(textEncoder.encode(data));
      if (activeTab.isLocal) {
        api.writeLocalPty(activeTab.id, encoded).catch(() => {});
      } else {
        api.writeSsh(activeTab.id, encoded).catch(() => {});
      }
    },
    [activeTab]
  );

  if (tabs.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center select-none"
        style={{ display: visible ? "flex" : "none" }}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--text-muted)]">
          <TerminalIcon className="h-8 w-8 stroke-[1.5]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">No Active Sessions</h2>
          <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
            Connect to a saved server from your hosts list to start a mobile terminal session.
          </p>
        </div>
        {onOpenHosts && (
          <button
            type="button"
            onClick={onOpenHosts}
            className="mt-2 flex h-9 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 text-xs font-semibold text-black shadow-sm active:opacity-90"
          >
            Go to Hosts
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden bg-[var(--canvas)]"
      style={{ display: visible ? "flex" : "none" }}
    >
      {/* Mobile Terminal Tab Bar (if multiple tabs exist) */}
      {tabs.length > 1 && (
        <div className="flex h-9 w-full shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-container)] px-2 no-scrollbar select-none">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors cursor-pointer ${
                  isActive
                    ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-high)]"
                }`}
              >
                {tab.isLocal ? (
                  <Laptop className="h-3 w-3" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                <span className="max-w-[120px] truncate">{tab.hostLabel}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(tab.id);
                  }}
                  className="ml-1 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: isActive && visible ? "visible" : "hidden",
                pointerEvents: isActive && visible ? "auto" : "none",
              }}
            >
              <XtermView
                sessionId={tab.id}
                hostId={tab.hostId}
                visible={isActive && visible}
                isFocused={isActive && visible}
              />
            </div>
          );
        })}
      </div>

      {/* Terminal Accessory Toolbar for Touchscreen Keyboard */}
      <MobileAccessoryBar onSendInput={handleSendInput} />
    </div>
  );
}
