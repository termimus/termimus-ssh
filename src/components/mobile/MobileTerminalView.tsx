import { useState, useCallback } from "react";
import { X, Terminal as TerminalIcon, Laptop, Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../../stores/useSessionStore";
import { XtermView, focusActiveTerminal } from "../terminal/XtermView";
import { MobileAccessoryBar } from "./MobileAccessoryBar";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import { api } from "../../lib/api";

const textEncoder = new TextEncoder();

interface MobileTerminalViewProps {
  visible: boolean;
  onOpenHosts?: () => void;
}

export function MobileTerminalView({ visible, onOpenHosts }: MobileTerminalViewProps) {
  const { t } = useTranslation();
  const isVirtualKeyboardOpen = useVirtualKeyboard();
  const [manualAccessoryOpen, setManualAccessoryOpen] = useState(true);

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
      focusActiveTerminal(activeTab.id);
    },
    [activeTab]
  );

  if (tabs.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center select-none"
        style={{ display: visible ? "flex" : "none" }}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--text-muted)] border border-[var(--border)]">
          <TerminalIcon className="h-8 w-8 stroke-[1.5]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t("terminal.noActiveSessions")}
          </h2>
          <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
            {t("terminal.launchPrompt")}
          </p>
        </div>
        {onOpenHosts && (
          <button
            type="button"
            onClick={onOpenHosts}
            className="mt-2 flex h-9 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 text-xs font-semibold text-black shadow-sm active:opacity-90 cursor-pointer"
          >
            {t("nav.hosts")}
          </button>
        )}
      </div>
    );
  }

  const showAccessoryBar = isVirtualKeyboardOpen || manualAccessoryOpen;

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden bg-[var(--canvas)]"
      style={{ display: visible ? "flex" : "none" }}
    >
      {/* Mobile Terminal Tab Bar */}
      <div className="flex h-9 w-full shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-container)] px-2 no-scrollbar select-none">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0 pr-2">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors cursor-pointer ${
                  isActive
                    ? "bg-[var(--surface-high)] font-semibold text-[var(--primary)] shadow-2xs"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-high)]"
                }`}
              >
                {tab.isLocal ? (
                  <Laptop className="h-3 w-3" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                <span className="max-w-[110px] truncate">{tab.hostLabel}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(tab.id);
                  }}
                  className="ml-0.5 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Toggle Key Accessory Bar button */}
        <button
          type="button"
          onClick={() => setManualAccessoryOpen((prev) => !prev)}
          className={`flex h-6.5 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-mono transition-colors cursor-pointer ${
            showAccessoryBar
              ? "bg-[var(--primary)]/15 text-[var(--primary)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-high)]"
          }`}
          title={showAccessoryBar ? "Hide Key Toolbar" : "Show Key Toolbar"}
        >
          <Keyboard size={12} />
          <span>Keys</span>
        </button>
      </div>

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
      {showAccessoryBar && (
        <MobileAccessoryBar
          onSendInput={handleSendInput}
          onClose={() => setManualAccessoryOpen(false)}
        />
      )}
    </div>
  );
}
