import { useState, useEffect } from "react";
import {
  X,
  Layers,
  Radio,
  Columns,
  Rows,
  Grid2X2,
  LayoutGrid,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useWorkspaceStore,
  PresetLayoutType,
  getPaneCountForLayout,
  getLayoutMeta,
} from "../../stores/useWorkspaceStore";
import { useHostStore } from "../../stores/useHostStore";
import { LayoutBlueprint } from "./WorkspaceCard";
import { CustomSelect } from "../ui/CustomSelect";

export function WorkspaceModal() {
  const { t } = useTranslation();
  const { isModalOpen, editingPreset, closeModal, savePreset } =
    useWorkspaceStore();
  const { hosts } = useHostStore();

  const layoutOptions: {
    id: PresetLayoutType;
    label: string;
    panes: number;
    icon: typeof Columns;
  }[] = [
    { id: "split-vertical", label: t("workspaces.modal.layouts.splitVertical"), panes: 2, icon: Columns },
    { id: "split-horizontal", label: t("workspaces.modal.layouts.splitHorizontal"), panes: 2, icon: Rows },
    { id: "grid-4", label: t("workspaces.modal.layouts.grid4"), panes: 4, icon: Grid2X2 },
    { id: "split-1-2", label: t("workspaces.modal.layouts.split12"), panes: 3, icon: LayoutGrid },
    { id: "split-2-1", label: t("workspaces.modal.layouts.split21"), panes: 3, icon: LayoutGrid },
    { id: "triple-column", label: t("workspaces.modal.layouts.tripleColumn"), panes: 3, icon: Columns },
  ];

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [layout, setLayout] = useState<PresetLayoutType>("split-vertical");
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [broadcastOnLaunch, setBroadcastOnLaunch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (editingPreset) {
      setName(editingPreset.name || "");
      setDescription(editingPreset.description || "");
      const activeLayout = editingPreset.layout || "split-vertical";
      setLayout(activeLayout);
      setBroadcastOnLaunch(editingPreset.broadcastOnLaunch || false);

      const requiredPanes = getPaneCountForLayout(activeLayout);
      const hostIds: string[] = [];
      for (let i = 0; i < requiredPanes; i++) {
        const found = editingPreset.nodes.find((n) => n.paneIndex === i);
        hostIds.push(found ? found.hostId : hosts[i % hosts.length]?.id || "");
      }
      setSelectedHostIds(hostIds);
      setError(null);
    }
  }, [editingPreset, hosts]);

  // Adjust host slots when layout changes
  const handleLayoutChange = (newLayout: PresetLayoutType) => {
    setLayout(newLayout);
    const requiredPanes = getPaneCountForLayout(newLayout);
    setSelectedHostIds((prev) => {
      const next = [...prev];
      while (next.length < requiredPanes) {
        // Pick an unused host if possible, or fallback to first
        const unused = hosts.find((h) => !next.includes(h.id));
        next.push(unused ? unused.id : hosts[0]?.id || "");
      }
      return next.slice(0, requiredPanes);
    });
  };

  const handleSelectHostForPane = (paneIndex: number, hostId: string) => {
    setSelectedHostIds((prev) => {
      const next = [...prev];
      next[paneIndex] = hostId;
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("workspaces.modal.errorNameRequired"));
      return;
    }

    const requiredPanes = getPaneCountForLayout(layout);
    const nodes = selectedHostIds.slice(0, requiredPanes).map((hostId, paneIndex) => ({
      paneIndex,
      hostId,
    }));

    if (nodes.some((n) => !n.hostId)) {
      setError(t("workspaces.modal.errorHostsRequired"));
      return;
    }

    savePreset(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        layout,
        nodes,
        broadcastOnLaunch,
      },
      editingPreset?.id ? editingPreset.id : undefined
    );
  };

  if (!isModalOpen) return null;

  const isEditing = Boolean(editingPreset && editingPreset.id);
  const layoutMeta = getLayoutMeta(layout);
  const nodeLabels = selectedHostIds.map((hid, idx) => {
    const h = hosts.find((item) => item.id === hid);
    return h ? h.label : `Pane ${idx + 1}`;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)]">
              <Layers size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {isEditing ? t("workspaces.modal.titleEdit") : t("workspaces.modal.titleNew")}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {t("workspaces.modal.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto p-6 gap-5">
          {error && (
            <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2 text-xs text-[var(--danger)]">
              {error}
            </div>
          )}

          {/* Preset Name & Description */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t("workspaces.modal.nameField")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspaces.modal.namePlaceholder")}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t("workspaces.modal.descriptionField")}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("workspaces.modal.descriptionPlaceholder")}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Layout Template Selector */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
              {t("workspaces.modal.layoutField")}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {layoutOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = layout === opt.id;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleLayoutChange(opt.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 shadow-sm"
                        : "border-[var(--border)] bg-[var(--canvas)] hover:border-[var(--primary)]/40 hover:bg-[var(--surface-high)]"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? "bg-[var(--primary)] text-black"
                          : "bg-[var(--surface-high)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">
                        {t("workspaces.modal.panesCount", { count: opt.panes })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Blueprint Preview & Host Assignments */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Left: Interactive Diagram Preview */}
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                {t("workspaces.modal.blueprintLabel")}
              </label>
              <div className="flex flex-1 flex-col justify-center rounded-xl border border-[var(--border)] bg-[var(--canvas)]/70 p-3">
                <LayoutBlueprint layout={layout} nodeLabels={nodeLabels} />
                <p className="mt-2 text-center text-[10px] text-[var(--text-muted)] font-mono">
                  {layoutMeta.description}
                </p>
              </div>
            </div>

            {/* Right: Host Selectors per Pane */}
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                {t("workspaces.modal.assignHostsLabel")}
              </label>
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: getPaneCountForLayout(layout) }).map((_, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-[var(--text-muted)] flex items-center justify-between">
                      <span>{t("workspaces.modal.paneTarget", { index: idx + 1 })}</span>
                    </label>
                    <CustomSelect
                      value={selectedHostIds[idx] || ""}
                      onChange={(val) => handleSelectHostForPane(idx, val)}
                      placeholder={hosts.length === 0 ? t("workspaces.modal.noHostsAvailable") : t("workspaces.modal.selectTargetHost")}
                      options={[
                        { value: "", label: t("workspaces.modal.emptyPaneOption") },
                        ...hosts.map((h) => ({
                          value: h.id,
                          label: h.label,
                          description: `(${h.username}@${h.address}:${h.port})`,
                        })),
                      ]}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Options: Auto-Broadcast Checkbox */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)]/50 p-3.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={broadcastOnLaunch}
                onChange={(e) => setBroadcastOnLaunch(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
              />
              <div className="flex items-center gap-2">
                <Radio
                  size={15}
                  className={broadcastOnLaunch ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}
                />
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {t("workspaces.modal.broadcastLabel")}
                </span>
              </div>
            </label>
            <p className="mt-1 ml-6 text-[11px] text-[var(--text-muted)]">
              {t("workspaces.modal.broadcastDesc")}
            </p>
          </div>

          {/* Form Actions Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={hosts.length === 0}
              className="rounded-xl bg-[var(--primary)] px-5 py-2 text-xs font-semibold text-black shadow-md hover:bg-[var(--primary)]/90 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isEditing ? t("workspaces.modal.updateButton") : t("workspaces.modal.saveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
