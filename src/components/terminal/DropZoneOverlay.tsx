import { useRef } from "react";
import { Columns2, Rows2, Move } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore, DropZone } from "../../stores/useSessionStore";

interface DropZoneOverlayProps {
  paneId: string;
}

export function DropZoneOverlay({ paneId }: DropZoneOverlayProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDraggingTab, dragTarget, setDragTarget } = useSessionStore(
    useShallow((s) => ({
      isDraggingTab: s.isDraggingTab,
      dragTarget: s.dragTarget,
      setDragTarget: s.setDragTarget,
    }))
  );

  if (!isDraggingTab) return null;

  const isCurrentTarget = dragTarget?.paneId === paneId;
  const currentZone = isCurrentTarget ? dragTarget.zone : null;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    let zone: DropZone = "center";
    if (relX < 0.22) {
      zone = "left";
    } else if (relX > 0.78) {
      zone = "right";
    } else if (relY < 0.22) {
      zone = "top";
    } else if (relY > 0.78) {
      zone = "bottom";
    } else {
      zone = "center";
    }

    if (!dragTarget || dragTarget.paneId !== paneId || dragTarget.zone !== zone) {
      setDragTarget({ paneId, zone });
    }
  };

  const handlePointerLeave = () => {
    if (dragTarget?.paneId === paneId) {
      setDragTarget(null);
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="absolute inset-0 z-40 bg-[var(--canvas)]/40 backdrop-blur-[1px] transition-colors"
    >
      {/* Visual Drop Target Highlight */}
      {currentZone === "left" && (
        <div className="absolute inset-y-2 left-2 w-[calc(50%-12px)] rounded-lg border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/15 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-[var(--primary)] shadow-lg animate-in fade-in duration-150">
          <Columns2 size={24} className="stroke-[2.2]" />
          <span className="text-xs font-semibold tracking-wide uppercase">{t("terminal.dropZone.splitLeft")}</span>
        </div>
      )}

      {currentZone === "right" && (
        <div className="absolute inset-y-2 right-2 w-[calc(50%-12px)] rounded-lg border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/15 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-[var(--primary)] shadow-lg animate-in fade-in duration-150">
          <Columns2 size={24} className="stroke-[2.2]" />
          <span className="text-xs font-semibold tracking-wide uppercase">{t("terminal.dropZone.splitRight")}</span>
        </div>
      )}

      {currentZone === "top" && (
        <div className="absolute inset-x-2 top-2 h-[calc(50%-12px)] rounded-lg border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/15 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-[var(--primary)] shadow-lg animate-in fade-in duration-150">
          <Rows2 size={24} className="stroke-[2.2]" />
          <span className="text-xs font-semibold tracking-wide uppercase">{t("terminal.dropZone.splitTop")}</span>
        </div>
      )}

      {currentZone === "bottom" && (
        <div className="absolute inset-x-2 bottom-2 h-[calc(50%-12px)] rounded-lg border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/15 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-[var(--primary)] shadow-lg animate-in fade-in duration-150">
          <Rows2 size={24} className="stroke-[2.2]" />
          <span className="text-xs font-semibold tracking-wide uppercase">{t("terminal.dropZone.splitBottom")}</span>
        </div>
      )}

      {currentZone === "center" && (
        <div className="absolute inset-2 rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--surface-high)]/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-[var(--text-primary)] shadow-lg animate-in fade-in duration-150">
          <Move size={22} className="text-[var(--primary)]" />
          <span className="text-xs font-semibold tracking-wide uppercase text-[var(--primary)]">
            {t("terminal.dropZone.dock")}
          </span>
        </div>
      )}
    </div>
  );
}
