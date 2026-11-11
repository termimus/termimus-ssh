import { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Server,
} from "lucide-react";
import { AiProviderSummary, AiProviderInput } from "../../lib/api";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAiStore } from "../../stores/useAiStore";
import { useVaultStore } from "../../stores/useVaultStore";

interface AiProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: AiProviderSummary | null;
}

interface ProviderPreset {
  id: string;
  name: string;
  type: "openai_compatible" | "anthropic" | "ollama";
  baseUrl: string;
  defaultModel: string;
  keyHelp: string;
}

const PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek (V3 / R1)",
    type: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    keyHelp: "Get your key from platform.deepseek.com",
  },
  {
    id: "openai",
    name: "OpenAI (GPT-4o)",
    type: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyHelp: "Get your key from platform.openai.com",
  },
  {
    id: "ollama",
    name: "Ollama (100% Local)",
    type: "ollama",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:7b",
    keyHelp: "Offline, no API key required for local Ollama",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-20241022",
    keyHelp: "Get your key from console.anthropic.com",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-Compatible)",
    type: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyHelp: "Works with Groq, OpenRouter, Together, vLLM, etc.",
  },
];

export function AiProviderModal({ isOpen, onClose, initialData }: AiProviderModalProps) {
  const { t } = useTranslation();
  const { saveProvider, testProvider, fetchOllamaModels } = useAiStore(
    useShallow((s) => ({
      saveProvider: s.saveProvider,
      testProvider: s.testProvider,
      fetchOllamaModels: s.fetchOllamaModels,
    }))
  );
  const isUnlocked = useVaultStore((s) => s.isUnlocked);

  const [selectedPreset, setSelectedPreset] = useState<string>("deepseek");
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState<"openai_compatible" | "anthropic" | "ollama">("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [modelName, setModelName] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [showKey, setShowKey] = useState(false);

  // Testing & Scanning state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isScanningOllama, setIsScanningOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setProviderType(initialData.provider_type);
      setBaseUrl(initialData.base_url);
      setModelName(initialData.model_name);
      setIsActive(initialData.is_active);
      setApiKey(""); // Keep empty to preserve existing
      setSelectedPreset("custom");
    } else {
      // Default to DeepSeek preset
      const p = PRESETS[0];
      setSelectedPreset(p.id);
      setName("DeepSeek");
      setProviderType(p.type);
      setBaseUrl(p.baseUrl);
      setModelName(p.defaultModel);
      setApiKey("");
      setIsActive(true);
    }
    setTestResult(null);
    setSaveError(null);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const p = PRESETS.find((item) => item.id === presetId);
    if (!p) return;
    setName(p.name);
    setProviderType(p.type);
    setBaseUrl(p.baseUrl);
    setModelName(p.defaultModel);
    setTestResult(null);
    setOllamaModels([]);
  };

  const handleScanOllama = async () => {
    setIsScanningOllama(true);
    setTestResult(null);
    try {
      const models = await fetchOllamaModels(baseUrl);
      setOllamaModels(models);
      if (models.length > 0 && !models.includes(modelName)) {
        setModelName(models[0]);
      }
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        msg: t("ai.provider.ollamaConnectFailed", { error: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setIsScanningOllama(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    const tempInput: AiProviderInput = {
      name,
      provider_type: providerType,
      base_url: baseUrl,
      model_name: modelName,
      api_key: apiKey.trim() ? apiKey.trim() : null,
      is_active: isActive,
    };

    try {
      const res = await testProvider(initialData?.id, tempInput);
      setTestResult({ ok: true, msg: res });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    if (!name.trim()) {
      setSaveError(t("ai.provider.nameRequired"));
      return;
    }
    if (!baseUrl.trim()) {
      setSaveError(t("ai.provider.baseUrlRequired"));
      return;
    }
    if (!modelName.trim()) {
      setSaveError(t("ai.provider.modelRequired"));
      return;
    }

    if (apiKey.trim() && !isUnlocked) {
      setSaveError(t("ai.provider.vaultLocked"));
      return;
    }

    setIsSaving(true);
    try {
      const input: AiProviderInput = {
        name: name.trim(),
        provider_type: providerType,
        base_url: baseUrl.trim(),
        model_name: modelName.trim(),
        api_key: apiKey.trim() ? apiKey.trim() : null,
        is_active: isActive,
      };

      await saveProvider(input, initialData?.id);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-container-high)]/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                {initialData ? t("ai.provider.editTitle") : t("ai.provider.addTitle")}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {t("ai.provider.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-highest)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Preset Selector */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t("ai.provider.servicePreset")}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESETS.map((p) => {
                const active = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetChange(p.id)}
                    className={`px-3 py-2 text-xs font-medium rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] shadow-xs"
                        : "border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-secondary)] hover:bg-[var(--surface-container-high)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)] capitalize truncate">
                      {p.type === "openai_compatible" ? t("ai.provider.openaiApi") : p.type}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {t("ai.provider.displayName")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ai.provider.displayNamePlaceholder")}
              className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              required
            />
          </div>

          {/* Base URL */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                {t("ai.provider.baseUrl")}
              </label>
              {providerType === "ollama" && (
                <button
                  type="button"
                  onClick={handleScanOllama}
                  disabled={isScanningOllama}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--primary)] hover:text-[var(--primary-hover)] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanningOllama ? "animate-spin" : ""}`} />
                  {isScanningOllama ? t("ai.provider.scanning") : t("ai.provider.scanModels")}
                </button>
              )}
            </div>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] font-mono placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              required
            />
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {t("ai.provider.modelId")}
            </label>
            {ollamaModels.length > 0 ? (
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] font-mono focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all cursor-pointer"
              >
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={t("ai.provider.modelPlaceholder")}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] font-mono placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                required
              />
            )}
          </div>

          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                {t("ai.provider.apiKey")}
              </label>
              {initialData?.has_api_key && (
                <span className="text-[11px] text-[var(--success)] flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> {t("ai.provider.keySaved")}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  initialData?.has_api_key
                    ? t("ai.provider.keyKeepPlaceholder")
                    : providerType === "ollama"
                    ? t("ai.provider.keyOptionalOllama")
                    : "sk-..."
                }
                className="w-full px-3 py-2 pr-10 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-[var(--text-primary)] font-mono placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              {providerType === "ollama"
                ? t("ai.provider.keyHintOllama")
                : t("ai.provider.keyHintVault")}
            </p>
          </div>

          {/* Active Provider Toggle */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-[var(--text-primary)] font-medium">
              {t("ai.provider.setActive")}
            </span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)] text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer"
            />
          </div>

          {/* Test Status feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                testResult.ok
                  ? "bg-[var(--success)]/10 border-[var(--success)]/20 text-[var(--success)]"
                  : "bg-[var(--danger)]/10 border-[var(--danger)]/20 text-[var(--danger)]"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[var(--success)]" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--danger)]" />
              )}
              <div className="break-words">{testResult.msg}</div>
            </div>
          )}

          {/* Save Error */}
          {saveError && (
            <div className="p-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--danger)]" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting || !baseUrl.trim() || !modelName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-low)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("ai.provider.testing")}
                </>
              ) : (
                <>
                  <Server className="w-3.5 h-3.5" />
                  {t("ai.provider.testConnection")}
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-container-high)] transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--on-primary)] text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {t("ai.provider.save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
