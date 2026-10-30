import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  Server,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Radio,
  Laptop,
} from "lucide-react";
import { useSyncStore, ConnectedDevice } from "../../stores/useSyncStore";
import { ImportSummary } from "../../lib/api";

export function SyncSection() {
  const { t } = useTranslation();
  const {
    serverUrl,
    authToken,
    syncPassword,
    deviceName,
    deviceId,
    autoSync,
    lastSyncAt,
    latestServerVersion,
    syncStatus,
    lastError,
    setServerUrl,
    setAuthToken,
    setSyncPassword,
    setDeviceName,
    setAutoSync,
    testConnection,
    push,
    pull,
    getDevices,
  } = useSyncStore();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; version?: string; revision?: number; error?: string } | null>(null);

  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState<number | null>(null);

  const [pulling, setPulling] = useState(false);
  const [pullSummary, setPullSummary] = useState<ImportSummary | null>(null);

  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const [showToken, setShowToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedDocker, setCopiedDocker] = useState(false);

  const loadDevices = useCallback(async () => {
    if (!serverUrl) {
      setDevices([]);
      return;
    }
    setLoadingDevices(true);
    try {
      const list = await getDevices();
      setDevices(list);
    } finally {
      setLoadingDevices(false);
    }
  }, [serverUrl, getDevices]);

  useEffect(() => {
    if (serverUrl) {
      loadDevices();
      // Silently test connection in background to update status banner to CONNECTED
      testConnection().catch(() => {});
    }
  }, [serverUrl, loadDevices, testConnection]);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection();
      setTestResult(res);
      if (res.ok) {
        loadDevices();
      }
    } finally {
      setTesting(false);
    }
  }

  async function handlePush() {
    if (!syncPassword.trim()) {
      useSyncStore.setState({
        lastError: "Sync Passphrase is required to ensure zero-knowledge E2EE encryption before uploading to relay.",
      });
      return;
    }
    setPushing(true);
    setPushSuccess(null);
    try {
      const version = await push();
      setPushSuccess(version);
      loadDevices();
      setTimeout(() => setPushSuccess(null), 4000);
    } catch {
      // error is tracked in store
    } finally {
      setPushing(false);
    }
  }

  async function handlePull() {
    if (!syncPassword.trim()) {
      useSyncStore.setState({
        lastError: "Sync Passphrase is required to decrypt the sync bundle from server.",
      });
      return;
    }
    setPulling(true);
    setPullSummary(null);
    try {
      const summary = await pull();
      setPullSummary(summary);
      loadDevices();
      setTimeout(() => setPullSummary(null), 5000);
    } catch {
      // error is tracked in store
    } finally {
      setPulling(false);
    }
  }

  const dockerCommand = `docker run -d \\
  --name termimus-sync \\
  -p 8080:8080 \\
  -v termimus_data:/data \\
  -e TERMIMUS_AUTH_TOKEN="your-secret-token" \\
  --restart unless-stopped \\
  ghcr.io/termimus/termimus-sync:latest`;

  return (
    <div className="space-y-5">
      {/* ── Status Banner ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${
                syncStatus === "connected"
                  ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                  : syncStatus === "error"
                  ? "bg-[var(--danger)]/15 text-[var(--danger)]"
                  : "bg-[var(--surface-container)] text-[var(--text-muted)]"
              }`}
            >
              <Cloud size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("settings.sync.title")}
                </h3>
                <span
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium ${
                    syncStatus === "connected"
                      ? "bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/20"
                      : syncStatus === "syncing"
                      ? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20"
                      : syncStatus === "error"
                      ? "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/20"
                      : !serverUrl || !syncPassword.trim()
                      ? "bg-[var(--surface-high)] text-[var(--text-muted)] border border-[var(--border)]"
                      : "bg-[var(--surface-container)] text-[var(--text-secondary)] border border-[var(--border)]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      syncStatus === "connected"
                        ? "bg-[var(--success)] animate-pulse"
                        : syncStatus === "syncing"
                        ? "bg-[var(--primary)] animate-pulse"
                        : syncStatus === "error"
                        ? "bg-[var(--danger)]"
                        : !serverUrl || !syncPassword.trim()
                        ? "bg-[var(--text-muted)]"
                        : "bg-[var(--primary)]"
                    }`}
                  />
                  {syncStatus === "connected"
                    ? t("settings.sync.statusConnected")
                    : syncStatus === "syncing"
                    ? t("settings.sync.statusSyncing")
                    : syncStatus === "error"
                    ? t("settings.sync.statusError")
                    : !serverUrl || !syncPassword.trim()
                    ? t("settings.sync.statusNotConfigured")
                    : t("settings.sync.statusReady")}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t("settings.sync.bannerDesc")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {latestServerVersion !== null && latestServerVersion > 0 && (
              <span className="rounded bg-[var(--surface-container)] px-2 py-1 text-[11px] font-mono text-[var(--text-secondary)] border border-[var(--border)]">
                {t("settings.sync.serverRev", { rev: latestServerVersion })}
              </span>
            )}
            {lastSyncAt && (
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {t("settings.sync.lastSyncTime", { time: new Date(lastSyncAt).toLocaleTimeString() })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Error or Success Feedbacks ────────────────────────────────────── */}
      {lastError && (
        <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-xs text-[var(--danger)] flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{lastError}</span>
        </div>
      )}

      {pushSuccess !== null && (
        <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/10 px-4 py-3 text-xs text-[var(--success)] flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{t("settings.sync.uploadSuccess", { rev: pushSuccess })}</span>
        </div>
      )}

      {pullSummary && (
        <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/10 px-4 py-3 text-xs text-[var(--success)] space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{t("settings.sync.syncedSuccess")}</span>
          </div>
          <div className="text-[11px] font-mono text-[var(--text-secondary)]">
            {t("settings.sync.updatedSummary", {
              hosts: pullSummary.hosts,
              folders: pullSummary.folders,
              credentials: pullSummary.credentials,
              snippets: pullSummary.snippets,
            })}
          </div>
        </div>
      )}

      {/* ── Server Connection Configuration Card ─────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden shadow-sm">
        <div className="border-b border-[var(--border)] px-5 py-3.5 bg-[var(--surface-container)]/30">
          <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Server size={15} className="text-[var(--primary)]" />
            {t("settings.sync.serverDetailsTitle")}
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {t("settings.sync.serverDetailsDesc")}
          </p>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Server URL */}
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.sync.serverUrlField")}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  onBlur={() => setServerUrl(serverUrl.trim().replace(/\/+$/, ""))}
                  placeholder={t("settings.sync.serverUrlPlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
              </div>
            </div>

            {/* Auth Token */}
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.sync.authTokenField")}
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={t("settings.sync.authTokenPlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t("settings.sync.authTokenDesc")}
              </p>
            </div>

            {/* Sync Passphrase */}
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)] flex items-center justify-between">
                <span>{t("settings.sync.passphraseField")}</span>
                <span className="text-[10px] text-[var(--primary)] font-mono">{t("settings.sync.e2eeEnforced")}</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={syncPassword}
                  onChange={(e) => setSyncPassword(e.target.value)}
                  placeholder={t("settings.sync.passphrasePlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t("settings.sync.passphraseDesc")}
              </p>
            </div>

            {/* Device Name */}
            <div>
              <label className="mb-1 block font-medium text-[var(--text-muted)]">
                {t("settings.sync.deviceNameField")}
              </label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t("settings.sync.deviceNamePlaceholder")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center justify-between">
                <span>{t("settings.sync.deviceNameDesc")}</span>
                <span className="font-mono text-[9px] opacity-60">ID: {deviceId ? deviceId.slice(0, 8) : "..."}</span>
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)]">
            <button
              onClick={handleTest}
              disabled={testing || !serverUrl}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} className="text-[var(--primary)]" />}
              <span>{testing ? t("settings.sync.testing") : t("settings.sync.testConnectionBtn")}</span>
            </button>

            {testResult && (
              <div
                className={`text-[11px] font-mono flex items-center gap-1.5 ${
                  testResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"
                }`}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 size={13} />
                    <span>{t("settings.sync.serverReachable", { version: testResult.version, revision: testResult.revision ?? 0 })}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={13} />
                    <span>{testResult.error}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sync Actions Card ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <RotateCw size={15} className="text-[var(--secondary)]" />
              {t("settings.sync.syncActionsTitle")}
            </h4>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.sync.syncActionsDesc")}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handlePush}
              disabled={pushing || !serverUrl}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {pushing ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
              <span>{pushing ? t("settings.sync.pushing") : t("settings.sync.pushBtn")}</span>
            </button>

            <button
              onClick={handlePull}
              disabled={pulling || !serverUrl}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {pulling ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
              <span>{pulling ? t("settings.sync.pulling") : t("settings.sync.pullBtn")}</span>
            </button>
          </div>
        </div>

        {/* Auto Sync Toggle */}
        <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {t("settings.sync.websocketTitle")}
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("settings.sync.websocketDesc")}
            </p>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-5.5 bg-[var(--surface-container)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-[var(--primary)]"></div>
          </label>
        </div>
      </div>

      {/* ── Connected Devices Card ────────────────────────────────────────── */}
      {serverUrl && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] overflow-hidden shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5 bg-[var(--surface-container)]/30">
            <div className="space-y-0.5">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Laptop size={15} className="text-[var(--primary)]" />
                <span>{t("settings.sync.devicesTitle")}</span>
                {devices.length > 0 && (
                  <span className="rounded bg-[var(--surface-container)] px-1.5 py-0.2 text-[10px] font-mono text-[var(--text-muted)]">
                    {devices.length}
                  </span>
                )}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t("settings.sync.devicesDesc")}
              </p>
            </div>
            <button
              onClick={loadDevices}
              disabled={loadingDevices}
              title={t("settings.sync.refreshDevices")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-highest)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCw size={12} className={loadingDevices ? "animate-spin" : ""} />
              <span>{t("settings.sync.refreshDevices")}</span>
            </button>
          </div>

          <div className="p-5">
            {devices.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">
                {loadingDevices ? t("settings.sync.loadingDevices") : t("settings.sync.noDevices")}
              </p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {devices.map((dev) => {
                  const isThisDevice = dev.id === deviceId;
                  return (
                    <div
                      key={dev.id}
                      className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-8 w-8 rounded-lg items-center justify-center shrink-0 ${
                            isThisDevice
                              ? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20"
                              : "bg-[var(--surface-container)] text-[var(--text-muted)]"
                          }`}
                        >
                          <Laptop size={15} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[var(--text-primary)] truncate">
                              {dev.name}
                            </span>
                            {isThisDevice && (
                              <span className="rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-mono font-medium text-[var(--primary)] border border-[var(--primary)]/20">
                                {t("settings.sync.thisDeviceBadge")}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-[var(--text-muted)] block truncate mt-0.5">
                            ID: {dev.id}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-[var(--text-muted)] block uppercase font-mono">
                          Last active
                        </span>
                        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                          {new Date(dev.last_sync_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(dev.last_sync_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Docker Self-Hosting Guide Box ──────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--tertiary)]" />
            <h4 className="text-xs font-semibold text-[var(--text-primary)]">
              {t("settings.sync.dockerDeployTitle")}
            </h4>
          </div>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(dockerCommand);
              setCopiedDocker(true);
              setTimeout(() => setCopiedDocker(false), 2000);
            }}
            className="flex items-center gap-1 text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
          >
            {copiedDocker ? <Check size={12} /> : <Copy size={12} />}
            <span>{copiedDocker ? t("settings.sync.copiedDockerCmd") : t("settings.sync.copyDockerCmd")}</span>
          </button>
        </div>

        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          The sync server is written in Go and packaged as a single lightweight Docker container (&lt; 20MB RAM, SQLite backend). Run this command on your VPS, Raspberry Pi, or local server:
        </p>

        <pre className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto select-all">
          {dockerCommand}
        </pre>
      </div>
    </div>
  );
}
