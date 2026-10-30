import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadCloud,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Archive,
  Lock,
  ShieldAlert,
  Eye,
  EyeOff,
  X,
  Info,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api, ImportSummary } from "../../lib/api";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

// ─── helpers ───────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── sub-components ────────────────────────────────────────────────────────

function PassphraseInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Passphrase..."}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────

export function BackupRestoreSection() {
  const { t } = useTranslation();
  // ── export state ──
  const [exporting, setExporting] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPath, setExportPath] = useState<string | null>(null);

  // ── import state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImportJson, setPendingImportJson] = useState<string | null>(null);
  const [isEncryptedBackup, setIsEncryptedBackup] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState("");

  // ── shared feedback ──
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // ── export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    setError(null);
    setExportPath(null);

    try {
      const isEncrypted = exportPassphrase.trim().length > 0;
      const ext = isEncrypted ? "enc.json" : "json";
      const defaultName = `termimus-backup-${today()}.${ext}`;

      // Native OS save-file dialog
      const selected = await save({
        title: "Save Termimus Backup",
        defaultPath: defaultName,
        filters: isEncrypted
          ? [{ name: "Encrypted Backup", extensions: ["enc.json", "json"] }]
          : [{ name: "Backup JSON", extensions: ["json"] }],
      });

      if (!selected) {
        // User cancelled the dialog — not an error
        return;
      }

      const json = await api.exportBackup(
        exportPassphrase.trim() || undefined
      );

      await api.writeLocalFile(selected, json);
      setExportPath(selected);
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  // ── import — step 1: pick file ──────────────────────────────────────────

  async function handlePickFile() {
    setError(null);
    setImportSummary(null);
    setImportPassphrase("");

    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Select Termimus Backup File",
        filters: [{ name: "Backup JSON", extensions: ["json", "enc.json"] }],
      });

      if (!selected || typeof selected !== "string") return;

      const text = await api.readLocalFile(selected);

      // Detect whether it's an encrypted envelope
      try {
        const probe = JSON.parse(text);
        setIsEncryptedBackup(probe?.encrypted === true);
      } catch {
        setIsEncryptedBackup(false);
      }

      setPendingImportJson(text);
    } catch (e) {
      setError(`Failed to read backup file: ${String(e)}`);
    }
  }

  // fallback: HTML <input type="file"> for environments where dialog isn't available
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setImportSummary(null);
    setImportPassphrase("");

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        const probe = JSON.parse(text);
        setIsEncryptedBackup(probe?.encrypted === true);
      } catch {
        setIsEncryptedBackup(false);
      }
      setPendingImportJson(text);
    };
    reader.onerror = () => setError("Failed to read the selected file");
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── import — step 2: confirm & execute ───────────────────────────────────

  async function handleConfirmImport(replaceAll: boolean) {
    if (!pendingImportJson) return;

    setImporting(true);
    setError(null);
    try {
      const summary = await api.importBackup(
        pendingImportJson,
        replaceAll,
        importPassphrase.trim() || undefined
      );
      useWorkspaceStore.getState().refresh();
      setImportSummary(summary);
      setPendingImportJson(null);
      setImportPassphrase("");
    } catch (e) {
      setError(`Import failed: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-4 mb-5">
        <Archive size={18} className="text-[var(--secondary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t("settings.backup.title")}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("settings.backup.subtitle")}
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto shrink-0 hover:opacity-70">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Export success banner */}
      {exportPath && (
        <div className="mb-4 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-3 py-2.5 text-xs text-[var(--success)]">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <CheckCircle2 size={14} />
            {t("settings.backup.backupSaved")}
          </div>
          <p className="font-mono text-[11px] text-[var(--text-secondary)] break-all">
            {exportPath}
          </p>
          <button
            onClick={() => setExportPath(null)}
            className="mt-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
          >
            {t("settings.backup.dismiss")}
          </button>
        </div>
      )}

      {/* Import success banner */}
      {importSummary && (
        <div className="mb-4 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-3 py-2.5 text-xs text-[var(--success)] space-y-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={14} />
            {t("settings.backup.backupRestored")}
          </div>
          <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
            <span>Hosts: {importSummary.hosts}</span>
            <span>Folders: {importSummary.folders}</span>
            <span>Credentials: {importSummary.credentials}</span>
            <span>Snippets: {importSummary.snippets}</span>
            <span>Workspaces: {importSummary.workspace_presets ?? 0}</span>
            <span>Tunnels: {importSummary.port_forwards}</span>
            <span>Known Hosts: {importSummary.known_hosts}</span>
          </div>

          {/* TOFU / MITM conflict warning */}
          {importSummary.known_hosts_conflicts > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-2 text-[11px] text-[var(--warning)]">
              <ShieldAlert size={13} className="shrink-0 mt-0.5" />
              <span>
                <strong>{importSummary.known_hosts_conflicts}</strong> trusted server key
                {importSummary.known_hosts_conflicts === 1 ? " was" : "s were"} skipped — the backup had
                a different fingerprint for {importSummary.known_hosts_conflicts === 1 ? "a host" : "hosts"} you
                already trust. Your existing fingerprints are kept to protect against MITM attacks.
                Manually reset any host key in the Known Hosts table above if you intentionally replaced that server.
              </span>
            </div>
          )}

          {/* Vault master password restored */}
          {importSummary.vault_meta_restored && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-2 text-[11px] text-[var(--warning)]">
              <Lock size={13} className="shrink-0 mt-0.5" />
              <span>
                Vault master password was restored from the backup. You have been logged out —
                please unlock the vault with the backup's master password.
              </span>
            </div>
          )}

          {/* Safety snapshot location */}
          {importSummary.safety_snapshot_path && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>
                Pre-restore snapshot saved to:{" "}
                <span className="font-mono break-all text-[var(--text-primary)]">
                  {importSummary.safety_snapshot_path}
                </span>
              </span>
            </div>
          )}

          <button
            onClick={() => setImportSummary(null)}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
          >
            {t("settings.backup.dismiss")}
          </button>
        </div>
      )}

      {/* Export & Import panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Export */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <DownloadCloud size={16} className="text-[var(--primary)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t("settings.backup.exportCardTitle")}
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("settings.backup.exportCardDesc")}
          </p>

          <PassphraseInput
            label={t("settings.backup.encryptEntireBackupLabel")}
            value={exportPassphrase}
            onChange={setExportPassphrase}
            placeholder={t("settings.backup.standardBackupPlaceholder")}
          />

          {exportPassphrase.trim() && (
            <p className="text-[11px] text-[var(--primary)] flex items-center gap-1">
              <Lock size={11} />
              {t("settings.backup.fullBackupEncryptionActive")}
            </p>
          )}

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {exporting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <DownloadCloud size={13} />
            )}
            <span>{exporting ? t("settings.backup.savingBackup") : t("settings.backup.saveBackupBtn")}</span>
          </button>
        </div>

        {/* Import */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <UploadCloud size={16} className="text-[var(--secondary)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t("settings.backup.restoreCardTitle")}
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("settings.backup.restoreCardDesc")}
          </p>

          {/* Hidden fallback file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <button
            onClick={handlePickFile}
            disabled={importing}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <UploadCloud size={13} />
            <span>{t("settings.backup.chooseBackupFileBtn")}</span>
          </button>
        </div>
      </div>

      {/* ── Confirm Import Modal ─────────────────────────────────────────────── */}
      {pendingImportJson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-[var(--warning)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("settings.backup.restoreModalTitle")}
              </h3>
              <button
                onClick={() => { setPendingImportJson(null); setImportPassphrase(""); }}
                disabled={importing}
                className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Encrypted backup: ask for passphrase */}
            {isEncryptedBackup && (
              <div className="rounded-md border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-3 py-2.5 space-y-2">
                <p className="text-xs text-[var(--primary)] flex items-center gap-1.5 font-semibold">
                  <Lock size={13} />
                  {t("settings.backup.encryptedNotice")}
                </p>
                <PassphraseInput
                  label={t("settings.backup.backupPassphraseLabel")}
                  value={importPassphrase}
                  onChange={setImportPassphrase}
                  placeholder={t("settings.backup.backupPassphrasePlaceholder")}
                />
              </div>
            )}

            <p className="text-xs text-[var(--text-secondary)]">
              {t("settings.backup.howToApply")}
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleConfirmImport(false)}
                disabled={importing || (isEncryptedBackup && !importPassphrase.trim())}
                className="w-full text-left rounded-lg border border-[var(--border)] bg-[var(--surface-container)] p-3 hover:border-[var(--primary)]/50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {t("settings.backup.mergeTitle")} <span className="ml-1 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] text-[var(--primary)]">{t("settings.backup.recommendedBadge")}</span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {t("settings.backup.mergeDesc")}
                </div>
              </button>

              <button
                onClick={() => handleConfirmImport(true)}
                disabled={importing || (isEncryptedBackup && !importPassphrase.trim())}
                className="w-full text-left rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3 hover:border-[var(--danger)]/60 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--danger)]">
                  {t("settings.backup.replaceAllTitle")}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {t("settings.backup.replaceAllDesc")}
                </div>
              </button>
            </div>

            {importing && (
              <div className="flex items-center justify-center gap-2 text-xs text-[var(--primary)]">
                <Loader2 size={14} className="animate-spin" />
                Restoring backup...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
