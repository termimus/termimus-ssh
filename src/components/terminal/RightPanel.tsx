import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useRightPanelStore,
  RightPanelTab,
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
} from "../../stores/useRightPanelStore";
import { SnippetSidebar } from "../snippets/SnippetSidebar";
import { AiSidebar } from "./AiSidebar";

/** Keyboard resize step (px); Shift multiplies it. */
const KEY_STEP = 16;

/**
 * Single right-hand panel hosting Snippets and AI Copilot as tabs.
 *
 * Each tab is mounted lazily on first visit and then kept mounted (hidden when
 * inactive), so switching tabs preserves the Copilot's draft prompt/mode and
 * the snippet search state. The left edge is draggable to resize the panel.
 */
export function RightPanel() {
  const { isOpen, activeTab, width } = useRightPanelStore(
    useShallow((s) => ({ isOpen: s.isOpen, activeTab: s.activeTab, width: s.width }))
  );
  const [visited, setVisited] = useState<Set<RightPanelTab>>(() => new Set([activeTab]));

  useEffect(() => {
    setVisited((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  // Re-clamp when the window shrinks so the terminal always keeps enough room.
  useEffect(() => {
    const onResize = () => {
      const { width: w, setWidth } = useRightPanelStore.getState();
      if (clampRightPanelWidth(w) !== w) setWidth(w);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!isOpen) return null;

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--canvas)] z-20"
      aria-label="Side panel"
    >
      <RightPanelResizeHandle width={width} />

      {visited.has("snippets") && (
        <div className={activeTab === "snippets" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <SnippetSidebar />
        </div>
      )}
      {visited.has("ai") && (
        <div className={activeTab === "ai" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <AiSidebar active={activeTab === "ai"} />
        </div>
      )}
    </aside>
  );
}

/**
 * Draggable left edge. Width updates live while dragging (the terminal's
 * debounced ResizeObserver refits it) and is persisted on release.
 * Double-click resets; arrow keys resize when focused.
 */
function RightPanelResizeHandle({ width }: { width: number }) {
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; frame: number | null } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, frame: null };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const clientX = e.clientX;
    // Coalesce to one store update per frame.
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    d.frame = requestAnimationFrame(() => {
      d.frame = null;
      // Panel sits on the right: dragging left (smaller X) makes it wider.
      useRightPanelStore.getState().setWidth(d.startWidth + (d.startX - clientX));
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    useRightPanelStore.getState().setWidth(d.startWidth + (d.startX - e.clientX));
    useRightPanelStore.getState().commitWidth();
    drag.current = null;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const store = useRightPanelStore.getState();
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    if (e.key === "ArrowLeft") store.setWidth(width + step);
    else if (e.key === "ArrowRight") store.setWidth(width - step);
    else if (e.key === "Home") store.resetWidth();
    else return;
    e.preventDefault();
    store.commitWidth();
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuenow={width}
        aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
        tabIndex={0}
        title="Drag to resize · Double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => useRightPanelStore.getState().resetWidth()}
        onKeyDown={onKeyDown}
        className={`group absolute left-0 top-0 z-40 h-full w-1.5 cursor-col-resize select-none outline-none transition-colors hover:bg-[var(--primary)]/60 focus-visible:bg-[var(--primary)]/60 ${
          isDragging ? "bg-[var(--primary)]" : ""
        }`}
      >
        <div
          className={`absolute inset-y-0 left-0 m-auto h-8 w-[2px] rounded-full bg-[var(--text-muted)] transition-opacity ${
            isDragging ? "opacity-100 bg-white" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>

      {/* Full-window cover while dragging so the xterm canvas can't steal the pointer
          and the col-resize cursor stays put. */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}
