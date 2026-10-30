import { Globe, Cpu, Shield, Layers, Server, ArrowUpCircle, CheckCircle2, RotateCw, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdateStore } from "../../stores/useUpdateStore";
import { SupportedLanguage, SUPPORTED_LANGUAGES } from "../../i18n";
import { CustomSelect } from "../ui/CustomSelect";
import { openExternalUrl } from "../../lib/openUrl";
import kofiIcon from "../../assets/kofi.png";

export function GeneralTab() {
  const { t } = useTranslation();
  const { language, setLanguage } = useSettingsStore();
  const { currentVersion, latestVersion, hasUpdate, releaseUrl, isChecking, checkForUpdates } =
    useUpdateStore();

  return (
    <div className="space-y-5">
      {/* ── Section 1: Language ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]">
              <Globe size={22} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("settings.general.languageTitle")}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                {t("settings.general.languageDesc")}
              </p>
            </div>
          </div>

          <div className="w-56 shrink-0">
            <CustomSelect
              value={language}
              onChange={(val) => setLanguage(val as SupportedLanguage)}
              options={SUPPORTED_LANGUAGES.map((lang) => ({
                value: lang.code,
                label: lang.nativeName,
                description: lang.label !== lang.nativeName ? `(${lang.label})` : undefined,
              }))}
            />
          </div>
        </div>
      </div>

      {/* ── Section 2: Software Updates ────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${
                hasUpdate
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30"
                  : "bg-[var(--surface-container)] text-[var(--text-muted)]"
              }`}
            >
              {hasUpdate ? (
                <ArrowUpCircle size={22} className="animate-bounce" />
              ) : (
                <CheckCircle2 size={22} className="text-[var(--success)]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  {hasUpdate
                    ? t("settings.general.updateAvailable", { version: latestVersion })
                    : t("settings.general.upToDate")}
                </h4>
                {hasUpdate && (
                  <span className="rounded bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--primary)] border border-[var(--primary)]/30 animate-pulse">
                    NEW
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {hasUpdate
                  ? `Version v${latestVersion} is available. You are currently on v${currentVersion}.`
                  : `You are currently running the latest release (v${currentVersion}).`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasUpdate && releaseUrl && (
              <button
                onClick={() => openExternalUrl(releaseUrl)}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary)]/90 transition-colors cursor-pointer"
              >
                <ArrowUpCircle size={13} />
                Download Update
              </button>
            )}
            <button
              onClick={() => checkForUpdates(true)}
              disabled={isChecking}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RotateCw size={13} className={isChecking ? "animate-spin text-[var(--primary)]" : ""} />
              {isChecking ? t("settings.general.checkingUpdates") : t("settings.general.checkForUpdates")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Section 3: App Banner & Architecture ───────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)] shrink-0">
            <Cpu size={26} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Termimus</h3>
              <span className="rounded bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--primary)] border border-[var(--primary)]/30">
                v{currentVersion}
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {t("settings.general.appInfoDesc")}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Shield size={14} className="text-[var(--primary)]" />
              <span>{t("settings.general.zeroKnowledgeTitle")}</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.general.zeroKnowledgeDesc")}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Layers size={14} className="text-[var(--secondary)]" />
              <span>{t("settings.general.localFirstTitle")}</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.general.localFirstDesc")}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Server size={14} className="text-[var(--tertiary)]" />
              <span>{t("settings.general.syncTitle")}</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.general.syncDesc")}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
          <button
            onClick={() => openExternalUrl("https://github.com/friczky/termimus")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors cursor-pointer"
          >
            <ExternalLink size={12} />
            {t("settings.general.viewOnGithub")}
          </button>
          <button
            onClick={() => openExternalUrl("https://ko-fi.com/friczky")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors cursor-pointer"
          >
            <img src={kofiIcon} alt="Ko-fi" className="h-3.5 w-3.5 object-contain" />
            {t("settings.general.supportKofi")}
          </button>
        </div>
      </div>
    </div>
  );
}
