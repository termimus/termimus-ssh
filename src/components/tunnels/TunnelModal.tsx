import { useState, useEffect } from "react";
import { X, ArrowLeftRight, Globe, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useHostStore } from "../../stores/useHostStore";
import { PortForwardInput } from "../../lib/api";
import { CustomSelect } from "../ui/CustomSelect";

export function TunnelModal() {
  const { t } = useTranslation();
  const { isModalOpen, editingRule, closeModal, saveRule } = useTunnelStore();
  const { hosts } = useHostStore();

  const [label, setLabel] = useState("");
  const [hostId, setHostId] = useState("");
  const [forwardType, setForwardType] = useState<"local" | "dynamic">("local");
  const [localAddress, setLocalAddress] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState(8080);
  const [remoteAddress, setRemoteAddress] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState(80);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingRule) {
      setLabel(editingRule.label);
      setHostId(editingRule.host_id);
      const isDynamic = editingRule.forward_type === "dynamic";
      setForwardType(isDynamic ? "dynamic" : "local");
      setLocalAddress(editingRule.local_address);
      setLocalPort(editingRule.local_port);
      setRemoteAddress(editingRule.remote_address || "127.0.0.1");
      setRemotePort(editingRule.remote_port || 80);
    } else {
      setLabel("");
      setHostId(hosts.length > 0 ? hosts[0].id : "");
      setForwardType("local");
      setLocalAddress("127.0.0.1");
      setLocalPort(8080);
      setRemoteAddress("127.0.0.1");
      setRemotePort(80);
    }
    setError(null);
  }, [editingRule, isModalOpen, hosts]);

  if (!isModalOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!label.trim()) {
      setError(t("tunnels.modal.labelRequired"));
      return;
    }
    if (!hostId) {
      setError(t("tunnels.modal.hostRequired"));
      return;
    }

    const input: PortForwardInput = {
      host_id: hostId,
      label: label.trim(),
      forward_type: forwardType,
      local_address: localAddress.trim() || "127.0.0.1",
      local_port: Number(localPort),
      remote_address: forwardType === "dynamic" ? "dynamic" : remoteAddress.trim() || "127.0.0.1",
      remote_port: forwardType === "dynamic" ? 0 : Number(remotePort),
    };

    setSubmitting(true);
    try {
      await saveRule(input, editingRule?.id);
      closeModal();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-low)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-[var(--primary)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {editingRule ? t("tunnels.modal.titleEdit") : t("tunnels.modal.titleNew")}
            </h2>
          </div>
          <button
            onClick={closeModal}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="mb-1.5 block font-medium text-[var(--text-muted)]">
              {t("tunnels.modal.forwardTypeField")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setForwardType("local");
                  if (localPort === 1080) setLocalPort(8080);
                }}
                className={`flex flex-col text-left rounded-xl border p-2.5 transition-colors cursor-pointer ${
                  forwardType === "local"
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--text-primary)]"
                    : "border-[var(--border)] bg-[var(--surface-container)]/40 text-[var(--text-muted)] hover:border-[var(--border)]/80"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-[var(--text-primary)]">
                  <Network size={13} className="text-[var(--primary)] shrink-0" />
                  <span>{t("tunnels.modal.typeLocalLabel")}</span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] mt-1 line-clamp-2">
                  {t("tunnels.modal.typeLocalDesc")}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setForwardType("dynamic");
                  if (localPort === 8080) setLocalPort(1080);
                }}
                className={`flex flex-col text-left rounded-xl border p-2.5 transition-colors cursor-pointer ${
                  forwardType === "dynamic"
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--text-primary)]"
                    : "border-[var(--border)] bg-[var(--surface-container)]/40 text-[var(--text-muted)] hover:border-[var(--border)]/80"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-[var(--text-primary)]">
                  <Globe size={13} className="text-[var(--primary)] shrink-0" />
                  <span>{t("tunnels.modal.typeDynamicLabel")}</span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] mt-1 line-clamp-2">
                  {t("tunnels.modal.typeDynamicDesc")}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-[var(--text-muted)]">
              {t("tunnels.modal.labelField")}
            </label>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("tunnels.modal.labelPlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-[var(--text-muted)]">
              {t("tunnels.modal.hostField")}
            </label>
            <CustomSelect
              value={hostId}
              onChange={setHostId}
              placeholder={t("tunnels.modal.selectHostPlaceholder")}
              searchable
              options={[
                { value: "", label: t("tunnels.modal.selectHostPlaceholder") },
                ...hosts.map((h) => ({
                  value: h.id,
                  label: h.label,
                  description: `(${h.username}@${h.address}:${h.port})`,
                })),
              ]}
            />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-3">
            <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {t("tunnels.modal.localEndpointTitle")}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                  {t("tunnels.modal.bindIpField")}
                </label>
                <input
                  type="text"
                  value={localAddress}
                  onChange={(e) => setLocalAddress(e.target.value)}
                  placeholder="127.0.0.1"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                  {t("tunnels.modal.localPortField")}
                </label>
                <input
                  type="number"
                  required
                  value={localPort}
                  onChange={(e) => setLocalPort(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {forwardType === "local" ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-3">
              <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {t("tunnels.modal.destinationEndpointTitle")}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                    {t("tunnels.modal.destinationHostField")}
                  </label>
                  <input
                    type="text"
                    required
                    value={remoteAddress}
                    onChange={(e) => setRemoteAddress(e.target.value)}
                    placeholder="127.0.0.1 or db.internal"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                    {t("tunnels.modal.destinationPortField")}
                  </label>
                  <input
                    type="number"
                    required
                    value={remotePort}
                    onChange={(e) => setRemotePort(Number(e.target.value))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none transition-colors"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--primary)]">
                <Globe size={14} className="shrink-0" />
                <span>{t("tunnels.modal.dynamicInfoTitle")}</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {t("tunnels.modal.dynamicInfoDesc", {
                  address: localAddress.trim() || "127.0.0.1",
                  port: localPort || 1080,
                })}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-high)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {submitting ? t("tunnels.modal.saving") : editingRule ? t("tunnels.modal.updateButton") : t("tunnels.modal.saveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
