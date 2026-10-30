import { useState, useMemo, useCallback, useEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyRound,
  Plus,
  Search,
  Key,
  UserCheck,
  Copy,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { KeychainItem } from "../../lib/api";
import { KeyModal } from "./KeyModal";
import { IdentityModal } from "./IdentityModal";

export function KeychainView() {
  const { t } = useTranslation();
  const {
    items,
    isLoading,
    searchQuery,
    setSearchQuery,
    openCreateKeyModal,
    openEditKeyModal,
    openCreateIdentityModal,
    openEditIdentityModal,
    deleteItem,
  } = useKeychainStore();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "item" | "background";
    item?: KeychainItem;
  } | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  }, []);

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: KeychainItem) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 250);
    setContextMenu({ x, y, type: "item", item });
  }, []);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 150);
    setContextMenu({ x, y, type: "background" });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const query = searchQuery.trim().toLowerCase();

  const { keys, identities } = useMemo(() => {
    const filtered = items.filter((item) => {
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        item.key_type.toLowerCase().includes(query) ||
        (item.username ?? "").toLowerCase().includes(query)
      );
    });

    return {
      keys: filtered.filter((i) => i.kind === "private_key" || i.kind === "public_key"),
      identities: filtered.filter((i) => i.kind === "password"),
    };
  }, [items, query]);

  const handleCopyPublicKey = useCallback(async (item: KeychainItem) => {
    if (!item.public_key) return;
    try {
      await navigator.clipboard.writeText(item.public_key);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 2000);
    } catch (err) {
      console.error("Failed to copy public key:", err);
    }
  }, []);

  const handleDelete = useCallback(
    (item: KeychainItem) => {
      useConfirmStore.getState().confirm({
        title: item.kind === "password" ? t("keychain.deleteConfirm.titleIdentity") : t("keychain.deleteConfirm.titleKey"),
        message: t("keychain.deleteConfirm.message", { name: item.name }),
        confirmLabel: t("keychain.deleteConfirm.confirmLabel"),
        isDanger: true,
        onConfirm: async () => {
          await deleteItem(item.id);
        },
      });
    },
    [deleteItem, t]
  );

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-y-auto bg-[var(--canvas)] p-5 select-none"
    >
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <KeyRound size={20} className="text-[var(--primary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("keychain.title")}
          </h1>
          <span className="rounded-md bg-[var(--surface-container)] px-2 py-0.5 text-xs font-mono text-[var(--text-muted)]">
            {items.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("keychain.searchPlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <button
            onClick={openCreateKeyModal}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] cursor-pointer"
          >
            <Plus size={14} strokeWidth={2.5} /> {t("keychain.newKey")}
          </button>
          <button
            onClick={openCreateIdentityModal}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-highest)] cursor-pointer"
          >
            <Plus size={14} strokeWidth={2.5} /> {t("keychain.newIdentity")}
          </button>
        </div>
      </div>

      {isLoading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
          {t("keychain.loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-[var(--text-muted)] py-16">
          <KeyRound size={40} className="mb-2 opacity-30" />
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {t("keychain.emptyTitle")}
          </p>
          <p className="text-xs mt-1 max-w-sm">
            {t("keychain.emptyDesc")}
          </p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={openCreateKeyModal}
              className="rounded-lg bg-[var(--primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] cursor-pointer"
            >
              {t("keychain.addFirstKey")}
            </button>
            <button
              onClick={openCreateIdentityModal}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-high)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--surface-highest)] cursor-pointer"
            >
              {t("keychain.addIdentity")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Keys Section */}
          <div className="mb-6">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {t("keychain.keysSection")} {keys.length > 0 && `(${keys.length})`}
            </h2>
            {keys.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                {t("keychain.noKeysMatchFilter")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {keys.map((item) => (
                  <KeyCard
                    key={item.id}
                    item={item}
                    isCopied={copiedId === item.id}
                    onCopy={handleCopyPublicKey}
                    onEdit={openEditKeyModal}
                    onDelete={handleDelete}
                    onContextMenu={handleItemContextMenu}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Identities Section */}
          <div>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {t("keychain.identitiesSection")} {identities.length > 0 && `(${identities.length})`}
            </h2>
            {identities.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                {t("keychain.noIdentitiesMatchFilter")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {identities.map((item) => (
                  <IdentityCard
                    key={item.id}
                    item={item}
                    onEdit={openEditIdentityModal}
                    onDelete={handleDelete}
                    onContextMenu={handleItemContextMenu}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "item" && contextMenu.item ? (
            <>
              {contextMenu.item.public_key && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(contextMenu.item!.public_key);
                    showCopyToast(t("keychain.copiedPublicKey"));
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
                >
                  <Copy size={13} />
                  <span>{t("keychain.copyPublicKey")}</span>
                </button>
              )}

              {contextMenu.item.fingerprint && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(contextMenu.item!.fingerprint);
                    showCopyToast(t("keychain.copiedFingerprint"));
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
                >
                  <Copy size={13} />
                  <span>{t("keychain.copyFingerprint")}</span>
                </button>
              )}

              {contextMenu.item.username && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(contextMenu.item!.username!);
                    showCopyToast(t("keychain.copiedUsername"));
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
                >
                  <Copy size={13} />
                  <span>{t("keychain.copyUsername")}</span>
                </button>
              )}

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Edit */}
              <button
                onClick={() => {
                  if (contextMenu.item!.kind === "password") {
                    openEditIdentityModal(contextMenu.item!);
                  } else {
                    openEditKeyModal(contextMenu.item!);
                  }
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <Pencil size={13} />
                <span>{t("keychain.editCredential")}</span>
              </button>

              <div className="my-1 h-[1px] bg-[var(--border)]" />

              {/* Delete */}
              <button
                onClick={() => {
                  handleDelete(contextMenu.item!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--danger)] hover:text-white transition-colors group cursor-pointer"
              >
                <Trash2 size={13} />
                <span>{t("keychain.deleteCredential")}</span>
              </button>
            </>
          ) : (
            <>
              {/* New SSH Key */}
              <button
                onClick={() => {
                  openCreateKeyModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--primary)] hover:text-black transition-colors group cursor-pointer"
              >
                <Key size={13} />
                <span>{t("keychain.newSshKey")}</span>
              </button>

              {/* New Identity */}
              <button
                onClick={() => {
                  openCreateIdentityModal();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-container)] hover:text-[var(--text-primary)] transition-colors group cursor-pointer"
              >
                <UserCheck size={13} />
                <span>{t("keychain.newPasswordIdentity")}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Copy Toast Notification */}
      {copyToast && (
        <div className="fixed top-11 right-3.5 z-50 flex items-center gap-2 rounded-lg border border-[var(--primary)]/40 bg-[var(--surface-high)]/95 px-3 py-1.5 text-xs font-mono font-medium text-[var(--primary)] shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none">
          <Check size={13} className="text-[var(--primary)] shrink-0" />
          <span>{copyToast}</span>
        </div>
      )}

      {/* Modals */}
      <KeyModal />
      <IdentityModal />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED KEY CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface KeyCardProps {
  item: KeychainItem;
  isCopied: boolean;
  onCopy: (item: KeychainItem) => void;
  onEdit: (item: KeychainItem) => void;
  onDelete: (item: KeychainItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: KeychainItem) => void;
}

const KeyCard = memo(function KeyCard({
  item,
  isCopied,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: KeyCardProps) {
  const { t } = useTranslation();
  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, item)}
      className="group relative rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-3.5 transition-colors hover:border-[var(--primary)]/40 shadow-xs"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]/15 text-[var(--secondary)]">
          <Key size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-[var(--text-primary)]">
              {item.name}
            </p>
            {item.kind === "public_key" && (
              <span className="rounded bg-[var(--surface-high)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--secondary)] border border-[var(--secondary)]/30">
                {t("keychain.pubBadge")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("keychain.typeLabel", { type: item.key_type || "Unknown" })}
            {item.username && ` · ${item.username}`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          onClick={() => onCopy(item)}
          disabled={!item.public_key}
          title={t("keychain.copyPublicKey")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 cursor-pointer ${
            isCopied
              ? "bg-[var(--success)] text-black font-semibold"
              : "bg-[var(--surface-high)] text-[var(--text-primary)] hover:bg-[var(--surface-highest)]"
          }`}
        >
          {isCopied ? (
            <>
              <Check size={11} /> {t("keychain.copied")}
            </>
          ) : (
            <>
              <Copy size={11} /> {t("keychain.copyKey")}
            </>
          )}
        </button>
        <button
          onClick={() => onEdit(item)}
          title={t("common.edit")}
          className="flex items-center justify-center rounded-md bg-[var(--surface-high)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-highest)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={() => onDelete(item)}
          title={t("common.delete")}
          className="flex items-center justify-center rounded-md bg-[var(--surface-high)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED IDENTITY CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface IdentityCardProps {
  item: KeychainItem;
  onEdit: (item: KeychainItem) => void;
  onDelete: (item: KeychainItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: KeychainItem) => void;
}

const IdentityCard = memo(function IdentityCard({
  item,
  onEdit,
  onDelete,
  onContextMenu,
}: IdentityCardProps) {
  const { t } = useTranslation();
  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, item)}
      className="group relative rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-3.5 transition-colors hover:border-[var(--primary)]/40 shadow-xs"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tertiary)]/15 text-[var(--tertiary)]">
          <UserCheck size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">
            {item.name}
          </p>
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("keychain.authPasswordLabel")}
            {item.username && ` · ${item.username}`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          onClick={() => onEdit(item)}
          title={t("common.edit")}
          className="flex items-center justify-center rounded-md bg-[var(--surface-high)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-highest)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={() => onDelete(item)}
          title={t("common.delete")}
          className="flex items-center justify-center rounded-md bg-[var(--surface-high)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});
