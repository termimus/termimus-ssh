import { useState, useEffect } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Shield,
  Cpu,
  Server,
  KeyRound,
} from "lucide-react";
import { AiProviderSummary } from "../../lib/api";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAiStore, AI_COPILOT_SHORTCUT_LABEL } from "../../stores/useAiStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { AiProviderModal } from "./AiProviderModal";

export function AiSettingsTab() {
  const { t } = useTranslation();
  const { providers, loadProviders, deleteProvider, setActiveProvider } = useAiStore(
    useShallow((s) => ({
      providers: s.providers,
      loadProviders: s.loadProviders,
      deleteProvider: s.deleteProvider,
      setActiveProvider: s.setActiveProvider,
    }))
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProviderSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleOpenAdd = () => {
    setEditingProvider(null);
    setActionError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (p: AiProviderSummary) => {
    setEditingProvider(p);
    setActionError(null);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    setActionError(null);
    useConfirmStore.getState().confirm({
      title: t("ai.settings.deleteTitle"),
      message: t("ai.settings.deleteMessage", { name }),
      confirmLabel: t("common.delete"),
      isDanger: true,
      onConfirm: async () => {
        try {
          await deleteProvider(id);
        } catch (e) {
          setActionError(t("ai.settings.deleteFailed", { error: e instanceof Error ? e.message : String(e) }));
        }
      },
    });
  };

  const handleSetActive = async (id: string) => {
    setActionError(null);
    try {
      await setActiveProvider(id);
    } catch (e) {
      setActionError(t("ai.settings.activateFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2.5 text-xs text-[var(--danger)]">
          {actionError}
        </div>
      )}
      {/* Overview Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-container-low)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("ai.settings.overviewTitle")}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xl leading-relaxed">
                {t("ai.settings.overviewDesc")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)] text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t("ai.settings.addProvider")}
          </button>
        </div>

        {/* Feature Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--border)]/60 text-xs">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Shield className="w-4 h-4 text-[var(--success)] shrink-0" />
            <span>{t("ai.settings.badgeVault")}</span>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Cpu className="w-4 h-4 text-[var(--secondary)] shrink-0" />
            <span>{t("ai.settings.badgeOllama")}</span>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Server className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <span>{t("ai.settings.badgeInline", { shortcut: AI_COPILOT_SHORTCUT_LABEL })}</span>
          </div>
        </div>
      </div>

      {/* Configured Providers List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("ai.settings.configuredProviders", { total: providers.length })}
          </h4>
        </div>

        {providers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center bg-[var(--surface-container-lowest)]/40">
            <Sparkles className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium text-[var(--text-secondary)]">{t("ai.settings.emptyTitle")}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 mb-4 max-w-sm mx-auto">
              {t("ai.settings.emptyDesc")}
            </p>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)] text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("ai.settings.configureFirst")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                  p.is_active
                    ? "border-[var(--primary)]/50 bg-[var(--primary)]/5 shadow-xs"
                    : "border-[var(--border)] bg-[var(--surface-container-low)] hover:border-[var(--border)]/80"
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className={`p-2 rounded-xl mt-0.5 shrink-0 ${
                      p.is_active
                        ? "bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/30"
                        : "bg-[var(--surface-container-high)] text-[var(--text-muted)]"
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {p.name}
                      </span>
                      {p.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30">
                          {t("ai.settings.activeBadge")}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--surface-container-high)] text-[var(--text-muted)] capitalize">
                        {p.provider_type === "openai_compatible" ? t("ai.settings.openaiCompatible") : p.provider_type}
                      </span>
                      {p.has_api_key && (
                        <span className="text-[10px] text-[var(--success)] flex items-center gap-0.5">
                          <KeyRound className="w-3 h-3" /> {t("ai.settings.keyStored")}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-1.5 font-mono truncate">
                      <span>{t("ai.settings.model")} <strong className="text-[var(--text-secondary)]">{p.model_name}</strong></span>
                      <span>•</span>
                      <span className="truncate">{p.base_url}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!p.is_active && (
                    <button
                      type="button"
                      onClick={() => void handleSetActive(p.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                    >
                      {t("ai.settings.setActive")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(p)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
                    title={t("ai.settings.editProvider")}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors cursor-pointer"
                    title={t("ai.settings.deleteProvider")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AiProviderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingProvider}
      />
    </div>
  );
}
