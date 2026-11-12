import { useState, useEffect } from "react";
import {
  X,
  ArrowLeftRight,
  ArrowLeft,
  Globe,
  Laptop,
  Server,
  BrickWallFire,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useTunnelStore } from "../../stores/useTunnelStore";
import { useHostStore } from "../../stores/useHostStore";
import { PortForwardInput } from "../../lib/api";
import { CustomSelect } from "../ui/CustomSelect";

type ForwardType = "local" | "remote" | "dynamic";

const FORWARD_TYPES: { type: ForwardType; flag: string }[] = [
  { type: "local", flag: "-L" },
  { type: "remote", flag: "-R" },
  { type: "dynamic", flag: "-D" },
];

/** Sensible starting endpoints for a freshly created rule of each type. */
const TYPE_DEFAULTS: Record<
  ForwardType,
  { localAddress: string; localPort: number; remoteAddress: string; remotePort: number }
> = {
  local: { localAddress: "127.0.0.1", localPort: 8080, remoteAddress: "127.0.0.1", remotePort: 80 },
  remote: { localAddress: "127.0.0.1", localPort: 3000, remoteAddress: "127.0.0.1", remotePort: 8080 },
  dynamic: { localAddress: "127.0.0.1", localPort: 1080, remoteAddress: "127.0.0.1", remotePort: 80 },
};

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:border-[var(--primary)] focus:outline-none transition-colors";

export function TunnelModal() {
  const { t } = useTranslation();
  const { isModalOpen, editingRule, closeModal, saveRule } = useTunnelStore(
    useShallow((s) => ({
      isModalOpen: s.isModalOpen,
      editingRule: s.editingRule,
      closeModal: s.closeModal,
      saveRule: s.saveRule,
    }))
  );
  const hosts = useHostStore((s) => s.hosts);

  const [step, setStep] = useState<"type" | "form">("type");
  const [label, setLabel] = useState("");
  const [hostId, setHostId] = useState("");
  const [forwardType, setForwardType] = useState<ForwardType>("local");
  // For -L/-D, local_* is the listener on this machine and remote_* the target.
  // For -R, remote_* is the listener on the SSH server and local_* the target
  // dialed from this machine.
  const [localAddress, setLocalAddress] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState(8080);
  const [remoteAddress, setRemoteAddress] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState(80);
  // Which type the endpoint fields were last seeded for. Defaults are only
  // re-applied when the type actually changes, so Back → Continue keeps
  // whatever the user already typed.
  const [seededFor, setSeededFor] = useState<ForwardType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset only when the modal opens or switches rule — not when the host
  // list refreshes (e.g. live sync), which would wipe a half-filled form.
  useEffect(() => {
    if (!isModalOpen) return;
    if (editingRule) {
      setLabel(editingRule.label);
      setHostId(editingRule.host_id);
      setForwardType(editingRule.forward_type);
      setLocalAddress(editingRule.local_address);
      setLocalPort(editingRule.local_port);
      setRemoteAddress(
        editingRule.forward_type === "dynamic" ? "127.0.0.1" : editingRule.remote_address || "127.0.0.1"
      );
      setRemotePort(editingRule.remote_port || 80);
      setSeededFor(editingRule.forward_type);
      setStep("form");
    } else {
      setLabel("");
      setHostId(useHostStore.getState().hosts[0]?.id ?? "");
      setForwardType("local");
      applyDefaults("local");
      setStep("type");
    }
    setError(null);
  }, [editingRule, isModalOpen]);

  // Hosts may finish loading after the modal opened: pick the first one if
  // nothing is selected yet, without touching anything else.
  useEffect(() => {
    if (isModalOpen && !hostId && hosts.length > 0) setHostId(hosts[0].id);
  }, [isModalOpen, hostId, hosts]);

  if (!isModalOpen) return null;

  function applyDefaults(type: ForwardType) {
    const d = TYPE_DEFAULTS[type];
    setLocalAddress(d.localAddress);
    setLocalPort(d.localPort);
    setRemoteAddress(d.remoteAddress);
    setRemotePort(d.remotePort);
    setSeededFor(type);
  }

  function handleContinue() {
    // The endpoint fields mean different things per type (for -R, remote_*
    // is the server-side listener), so reseed them when the type changed.
    // Unchanged type → keep what the user typed or what was saved.
    if (seededFor !== forwardType) applyDefaults(forwardType);
    setStep("form");
  }

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

    const isDynamic = forwardType === "dynamic";
    const input: PortForwardInput = {
      host_id: hostId,
      label: label.trim(),
      forward_type: forwardType,
      local_address: localAddress.trim() || "127.0.0.1",
      local_port: Number(localPort),
      remote_address: isDynamic ? "dynamic" : remoteAddress.trim() || "127.0.0.1",
      remote_port: isDynamic ? 0 : Number(remotePort),
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

  const typeLabel = (type: ForwardType) =>
    t(
      type === "local"
        ? "tunnels.modal.typeLocalLabel"
        : type === "remote"
          ? "tunnels.modal.typeRemoteLabel"
          : "tunnels.modal.typeDynamicLabel"
    );
  const typeDesc = (type: ForwardType) =>
    t(
      type === "local"
        ? "tunnels.modal.typeLocalDesc"
        : type === "remote"
          ? "tunnels.modal.typeRemoteDesc"
          : "tunnels.modal.typeDynamicDesc"
    );
  const activeFlag = FORWARD_TYPES.find((f) => f.type === forwardType)!.flag;

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

        {step === "type" ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t("tunnels.modal.selectTypeTitle")}
            </p>

            {/* Segmented control */}
            <div
              role="radiogroup"
              aria-label={t("tunnels.modal.forwardTypeField")}
              className="relative grid grid-cols-3 rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-1"
            >
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-[var(--primary)] shadow-sm transition-transform duration-200 ease-out"
                style={{
                  transform: `translateX(${FORWARD_TYPES.findIndex((f) => f.type === forwardType) * 100}%)`,
                }}
              />
              {FORWARD_TYPES.map(({ type }) => {
                const selected = forwardType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setForwardType(type)}
                    className={`relative z-10 rounded-lg py-1.5 text-[13px] font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 ${
                      selected
                        ? "text-[var(--on-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {typeLabel(type)}
                  </button>
                );
              })}
            </div>

            <ForwardDiagram type={forwardType} />

            <p className="min-h-[3.75rem] text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {typeDesc(forwardType)}
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={handleContinue}
                className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors shadow-sm cursor-pointer"
              >
                {t("tunnels.modal.continueButton")}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-high)] py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Chosen type summary — click to go back and change it */}
            <button
              type="button"
              onClick={() => setStep("type")}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 px-3 py-2 text-left hover:border-[var(--primary)]/50 transition-colors cursor-pointer"
            >
              <ArrowLeft
                size={14}
                className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--primary)] transition-colors"
              />
              <span className="text-[11px] text-[var(--text-muted)]">{t("tunnels.modal.forwardTypeField")}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[var(--text-primary)]">{typeLabel(forwardType)}</span>
                <span className="rounded bg-[var(--primary)]/15 px-1 py-px font-mono text-[10px] font-medium text-[var(--primary)]">
                  {activeFlag}
                </span>
              </span>
            </button>

            <div>
              <label className="mb-1.5 block font-medium text-[var(--text-muted)]">
                {t("tunnels.modal.labelField")}
              </label>
              <input
                type="text"
                required
                autoFocus={!editingRule}
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

            {forwardType === "remote" ? (
              <>
                <EndpointFields
                  title={t("tunnels.modal.remoteListenerTitle")}
                  hostLabel={t("tunnels.modal.bindAddressField")}
                  portLabel={t("tunnels.modal.localPortField")}
                  address={remoteAddress}
                  port={remotePort}
                  onAddress={setRemoteAddress}
                  onPort={setRemotePort}
                  placeholder="127.0.0.1"
                />
                <EndpointFields
                  title={t("tunnels.modal.remoteDestinationTitle")}
                  hostLabel={t("tunnels.modal.destinationHostField")}
                  portLabel={t("tunnels.modal.destinationPortField")}
                  address={localAddress}
                  port={localPort}
                  onAddress={setLocalAddress}
                  onPort={setLocalPort}
                  placeholder="127.0.0.1 or nas.lan"
                  required
                />
                <p className="rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {t("tunnels.modal.remoteInfo", {
                    bind: `${remoteAddress.trim() || "127.0.0.1"}:${remotePort}`,
                    target: `${localAddress.trim() || "127.0.0.1"}:${localPort}`,
                  })}
                </p>
              </>
            ) : (
              <>
                <EndpointFields
                  title={t("tunnels.modal.localEndpointTitle")}
                  hostLabel={t("tunnels.modal.bindIpField")}
                  portLabel={t("tunnels.modal.localPortField")}
                  address={localAddress}
                  port={localPort}
                  onAddress={setLocalAddress}
                  onPort={setLocalPort}
                  placeholder="127.0.0.1"
                />
                {forwardType === "local" ? (
                  <EndpointFields
                    title={t("tunnels.modal.destinationEndpointTitle")}
                    hostLabel={t("tunnels.modal.destinationHostField")}
                    portLabel={t("tunnels.modal.destinationPortField")}
                    address={remoteAddress}
                    port={remotePort}
                    onAddress={setRemoteAddress}
                    onPort={setRemotePort}
                    placeholder="127.0.0.1 or db.internal"
                    required
                  />
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
              </>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={editingRule ? closeModal : () => setStep("type")}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-high)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-highest)] transition-colors cursor-pointer"
              >
                {editingRule ? t("common.cancel") : t("tunnels.modal.backButton")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? t("tunnels.modal.saving")
                  : editingRule
                    ? t("tunnels.modal.updateButton")
                    : t("tunnels.modal.saveButton")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function EndpointFields({
  title,
  hostLabel,
  portLabel,
  address,
  port,
  onAddress,
  onPort,
  placeholder,
  required,
}: {
  title: string;
  hostLabel: string;
  portLabel: string;
  address: string;
  port: number;
  onAddress: (v: string) => void;
  onPort: (v: number) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-container)]/40 p-3.5 space-y-3">
      <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-[var(--text-muted)]">{hostLabel}</label>
          <input
            type="text"
            required={required}
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--text-muted)]">{portLabel}</label>
          <input
            type="number"
            required
            min={1}
            max={65535}
            value={port}
            onChange={(e) => onPort(Number(e.target.value))}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Small illustration of where the tunnel runs for each forwarding type:
 * this computer → (through the firewall) → SSH server [→ internet].
 * The animated dashes show which way new connections travel.
 */
function ForwardDiagram({ type }: { type: ForwardType }) {
  const { t } = useTranslation();
  const reverse = type === "remote";

  return (
    <div className="flex items-start rounded-xl border border-[var(--border)] bg-[var(--canvas)]/60 px-4 py-5">
      <DiagramNode Icon={Laptop} label={t("tunnels.modal.diagramThisComputer")} />
      <Connector reverse={reverse} />
      <DiagramNode Icon={BrickWallFire} label={t("tunnels.modal.diagramFirewall")} danger />
      <Connector reverse={reverse} />
      <DiagramNode Icon={Server} label={t("tunnels.modal.diagramServer")} />
      {type === "dynamic" && (
        <>
          <Connector />
          <DiagramNode Icon={Globe} label={t("tunnels.modal.diagramInternet")} />
        </>
      )}
    </div>
  );
}

function DiagramNode({ Icon, label, danger }: { Icon: LucideIcon; label: string; danger?: boolean }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1.5">
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
          danger
            ? "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]"
            : "border-[var(--border)] bg-[var(--surface-high)] text-[var(--text-primary)]"
        }`}
      >
        <Icon size={20} />
      </div>
      <span className="text-center text-[10px] leading-tight text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

function Connector({ reverse }: { reverse?: boolean }) {
  const Arrow = reverse ? ChevronLeft : ChevronRight;
  return (
    <div className={`mt-[21px] flex min-w-4 flex-1 items-center ${reverse ? "flex-row-reverse" : ""}`}>
      <div className={`tunnel-flow h-[2px] flex-1 rounded-full ${reverse ? "tunnel-flow-reverse" : ""}`} />
      <Arrow size={12} strokeWidth={3} className="-mx-1 shrink-0 text-[var(--primary)]" />
    </div>
  );
}
