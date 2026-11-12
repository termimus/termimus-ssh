import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
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
  Server,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useKeychainStore } from "../../stores/useKeychainStore";
import { useHostStore } from "../../stores/useHostStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { KeychainItem } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { KeyModal } from "./KeyModal";
import { IdentityModal } from "./IdentityModal";

type Toast = { kind: "success" | "error"; message: string };

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer";

export function KeychainView() {
  const { t } = useTranslation();
  const {
    items,
    isLoading,
    loadError,
    refresh,
    searchQuery,
    setSearchQuery,
    openCreateKeyModal,
    openEditKeyModal,
    openCreateIdentityModal,
    openEditIdentityModal,
    deleteItem,
  } = useKeychainStore(
    useShallow((s) => ({
      items: s.items,
      isLoading: s.isLoading,
      loadError: s.error,
      refresh: s.refresh,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      openCreateKeyModal: s.openCreateKeyModal,
      openEditKeyModal: s.openEditKeyModal,
      openCreateIdentityModal: s.openCreateIdentityModal,
      openEditIdentityModal: s.openEditIdentityModal,
      deleteItem: s.deleteItem,
    }))
  );
  const hosts = useHostStore((s) => s.hosts);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "item" | "background";
    item?: KeychainItem;
  } | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), next.kind === "error" ? 4000 : 1800);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Host labels per credential, so cards and the delete confirm can show
  // which servers would lose their auth if the credential is removed.
  const hostsByCredential = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const host of hosts) {
      if (!host.credential_id) continue;
      const list = map.get(host.credential_id);
      if (list) list.push(host.label);
      else map.set(host.credential_id, [host.label]);
    }
    return map;
  }, [hosts]);

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

  const handleCopy = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await copyText(text);
        showToast({ kind: "success", message: successMessage });
      } catch (err) {
        showToast({ kind: "error", message: t("keychain.copyFailed", { error: String(err) }) });
      }
    },
    [showToast, t]
  );

  const handleCopyPublicKey = useCallback(
    (item: KeychainItem) => {
      if (item.public_key) handleCopy(item.public_key, t("keychain.copiedPublicKey"));
    },
    [handleCopy, t]
  );

  const handleCopyUsername = useCallback(
    (item: KeychainItem) => {
      if (item.username) handleCopy(item.username, t("keychain.copiedUsername"));
    },
    [handleCopy, t]
  );

  const handleDelete = useCallback(
    (item: KeychainItem) => {
      const usedBy = hostsByCredential.get(item.id) ?? [];
      const message =
        usedBy.length > 0
          ? t("keychain.deleteConfirm.messageInUse", {
              name: item.name,
              count: usedBy.length,
              hosts: usedBy.length > 3 ? `${usedBy.slice(0, 3).join(", ")}, …` : usedBy.join(", "),
            })
          : t("keychain.deleteConfirm.message", { name: item.name });

      useConfirmStore.getState().confirm({
        title: item.kind === "password" ? t("keychain.deleteConfirm.titleIdentity") : t("keychain.deleteConfirm.titleKey"),
        message,
        confirmLabel: t("keychain.deleteConfirm.confirmLabel"),
        isDanger: true,
        onConfirm: async () => {
          try {
            await deleteItem(item.id);
          } catch (err) {
            showToast({
              kind: "error",
              message: t("keychain.deleteFailed", { name: item.name, error: String(err) }),
            });
          }
        },
      });
    },
    [deleteItem, hostsByCredential, showToast, t]
  );

  const isSearchEmpty = query !== "" && keys.length === 0 && identities.length === 0;

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-4 text-[var(--text-primary)] select-none"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <KeyRound size={18} className="text-[var(--accent)]" />
            {t("keychain.title")}
            {items.length > 0 && (
              <span className="rounded-md bg-[var(--surface-container)] px-1.5 py-0.5 text-[10px] font-mono font-normal text-[var(--text-muted)]">
                {items.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {t("keychain.subtitle")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={openCreateIdentityModal}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <UserCheck size={14} /> {t("keychain.newIdentity")}
          </button>
          <button
            onClick={openCreateKeyModal}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)] cursor-pointer"
          >
            <Plus size={14} /> {t("keychain.newKey")}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("keychain.searchPlaceholder")}
          aria-label={t("keychain.searchPlaceholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {loadError && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">{t("keychain.loadError", { error: loadError })}</span>
            <button
              onClick={() => refresh()}
              className="shrink-0 rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 font-medium hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {isLoading && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-16 text-xs text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("keychain.loading")}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--primary)] shadow-sm">
              <KeyRound size={26} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("keychain.emptyTitle")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("keychain.emptyDesc")}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={openCreateKeyModal}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] shadow-md hover:bg-[var(--primary-hover)] transition-colors cursor-pointer"
              >
                <Plus size={14} />
                {t("keychain.addFirstKey")}
              </button>
              <button
                onClick={openCreateIdentityModal}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <UserCheck size={14} />
                {t("keychain.addIdentity")}
              </button>
            </div>
          </div>
        ) : isSearchEmpty ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <Search size={26} className="mb-3 text-[var(--text-muted)] opacity-60" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("keychain.emptySearchTitle", { query: searchQuery.trim() })}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("keychain.emptySearchDesc")}
            </p>
          </div>
        ) : (
          <>
            {keys.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {t("keychain.keysSection")} ({keys.length})
                </h2>
                {/* auto-fill: wide windows get more columns instead of stretching each card */}
                <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]">
                  {keys.map((item) => (
                    <KeyCard
                      key={item.id}
                      item={item}
                      usedBy={hostsByCredential.get(item.id)}
                      onCopy={handleCopyPublicKey}
                      onEdit={openEditKeyModal}
                      onDelete={handleDelete}
                      onContextMenu={handleItemContextMenu}
                    />
                  ))}
                </div>
              </section>
            )}

            {identities.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {t("keychain.identitiesSection")} ({identities.length})
                </h2>
                <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]">
                  {identities.map((item) => (
                    <IdentityCard
                      key={item.id}
                      item={item}
                      usedBy={hostsByCredential.get(item.id)}
                      onCopy={handleCopyUsername}
                      onEdit={openEditIdentityModal}
                      onDelete={handleDelete}
                      onContextMenu={handleItemContextMenu}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-high)]/95 p-1 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-75"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "item" && contextMenu.item ? (
            (() => {
              const item = contextMenu.item;
              const close = () => setContextMenu(null);
              return (
                <>
                  {item.public_key && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleCopy(item.public_key, t("keychain.copiedPublicKey"));
                        close();
                      }}
                      className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black`}
                    >
                      <Copy size={13} />
                      <span>{t("keychain.copyPublicKey")}</span>
                    </button>
                  )}

                  {item.fingerprint && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleCopy(item.fingerprint, t("keychain.copiedFingerprint"));
                        close();
                      }}
                      className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                    >
                      <Copy size={13} />
                      <span>{t("keychain.copyFingerprint")}</span>
                    </button>
                  )}

                  {item.username && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        handleCopy(item.username!, t("keychain.copiedUsername"));
                        close();
                      }}
                      className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                    >
                      <Copy size={13} />
                      <span>{t("keychain.copyUsername")}</span>
                    </button>
                  )}

                  {(item.public_key || item.fingerprint || item.username) && (
                    <div className="my-1 h-[1px] bg-[var(--border)]" />
                  )}

                  <button
                    role="menuitem"
                    onClick={() => {
                      if (item.kind === "password") openEditIdentityModal(item);
                      else openEditKeyModal(item);
                      close();
                    }}
                    className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                  >
                    <Pencil size={13} />
                    <span>{t("keychain.editCredential")}</span>
                  </button>

                  <div className="my-1 h-[1px] bg-[var(--border)]" />

                  <button
                    role="menuitem"
                    onClick={() => {
                      handleDelete(item);
                      close();
                    }}
                    className={`${MENU_ITEM} hover:bg-[var(--danger)] hover:text-white`}
                  >
                    <Trash2 size={13} />
                    <span>{t("keychain.deleteCredential")}</span>
                  </button>
                </>
              );
            })()
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  openCreateKeyModal();
                  setContextMenu(null);
                }}
                className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black`}
              >
                <Key size={13} />
                <span>{t("keychain.newSshKey")}</span>
              </button>

              <button
                role="menuitem"
                onClick={() => {
                  openCreateIdentityModal();
                  setContextMenu(null);
                }}
                className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
              >
                <UserCheck size={13} />
                <span>{t("keychain.newPasswordIdentity")}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          className={`fixed top-11 right-3.5 z-50 flex max-w-sm items-center gap-2 rounded-lg border bg-[var(--surface-high)]/95 px-3 py-1.5 text-xs font-medium shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none ${
            toast.kind === "error"
              ? "border-[var(--danger)]/40 text-[var(--danger)]"
              : "border-[var(--primary)]/40 font-mono text-[var(--primary)]"
          }`}
        >
          {toast.kind === "error" ? (
            <AlertTriangle size={13} className="shrink-0" />
          ) : (
            <Check size={13} className="shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Modals */}
      <KeyModal />
      <IdentityModal />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED CARD PIECES
// ══════════════════════════════════════════════════════════════════════════════

const ICON_BUTTON =
  "flex items-center justify-center rounded-md bg-[var(--surface-high)] p-1.5 text-[var(--text-muted)] transition-colors cursor-pointer";

function UsageLine({ usedBy }: { usedBy?: string[] }) {
  const { t } = useTranslation();
  const count = usedBy?.length ?? 0;
  return (
    <p
      className={`flex items-center gap-1 text-[11px] ${
        count > 0 ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]/70"
      }`}
      title={count > 0 ? usedBy!.join(", ") : undefined}
    >
      <Server size={11} className="shrink-0" />
      <span className="truncate">
        {count > 0 ? t("keychain.usedByHosts", { count }) : t("keychain.notUsed")}
      </span>
    </p>
  );
}

function CardActions({
  item,
  onEdit,
  onDelete,
}: {
  item: KeychainItem;
  onEdit: (item: KeychainItem) => void;
  onDelete: (item: KeychainItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <button
        onClick={() => onEdit(item)}
        title={t("common.edit")}
        aria-label={`${t("common.edit")} ${item.name}`}
        className={`${ICON_BUTTON} hover:bg-[var(--surface-highest)] hover:text-[var(--text-primary)]`}
      >
        <Pencil size={12} />
      </button>
      <button
        onClick={() => onDelete(item)}
        title={t("common.delete")}
        aria-label={`${t("common.delete")} ${item.name}`}
        className={`${ICON_BUTTON} hover:bg-[var(--danger)]/20 hover:text-[var(--danger)]`}
      >
        <Trash2 size={12} />
      </button>
    </>
  );
}

const CARD_CLASS =
  "group relative flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-container)] p-3.5 transition-colors hover:border-[var(--primary)]/40 shadow-xs";

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED KEY CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface KeyCardProps {
  item: KeychainItem;
  usedBy?: string[];
  onCopy: (item: KeychainItem) => void;
  onEdit: (item: KeychainItem) => void;
  onDelete: (item: KeychainItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: KeychainItem) => void;
}

const KeyCard = memo(function KeyCard({
  item,
  usedBy,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: KeyCardProps) {
  const { t } = useTranslation();
  return (
    <div onContextMenu={(e) => onContextMenu?.(e, item)} className={CARD_CLASS}>
      <div className="flex flex-1 items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]/15 text-[var(--secondary)]">
          <Key size={16} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-[var(--text-primary)]" title={item.name}>
              {item.name}
            </p>
            <span className="shrink-0 rounded bg-[var(--surface-high)] px-1.5 py-0.5 text-[9px] font-mono uppercase text-[var(--text-secondary)] border border-[var(--border)]">
              {item.key_type || "?"}
            </span>
            {item.kind === "public_key" && (
              <span className="shrink-0 rounded bg-[var(--surface-high)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--secondary)] border border-[var(--secondary)]/30">
                {t("keychain.pubBadge")}
              </span>
            )}
          </div>
          {item.fingerprint && (
            <p
              className="truncate font-mono text-[10px] text-[var(--text-muted)]"
              title={item.fingerprint}
            >
              {item.fingerprint}
            </p>
          )}
          {item.username && (
            <p className="truncate text-[11px] text-[var(--text-muted)]">
              {item.username}
            </p>
          )}
          <UsageLine usedBy={usedBy} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          onClick={() => onCopy(item)}
          disabled={!item.public_key}
          title={t("keychain.copyPublicKey")}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--surface-high)] py-1.5 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-highest)] disabled:opacity-40 cursor-pointer"
        >
          <Copy size={11} /> {t("keychain.copyKey")}
        </button>
        <CardActions item={item} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED IDENTITY CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface IdentityCardProps {
  item: KeychainItem;
  usedBy?: string[];
  onCopy: (item: KeychainItem) => void;
  onEdit: (item: KeychainItem) => void;
  onDelete: (item: KeychainItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: KeychainItem) => void;
}

const IdentityCard = memo(function IdentityCard({
  item,
  usedBy,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: IdentityCardProps) {
  const { t } = useTranslation();
  return (
    <div onContextMenu={(e) => onContextMenu?.(e, item)} className={CARD_CLASS}>
      <div className="flex flex-1 items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tertiary)]/15 text-[var(--tertiary)]">
          <UserCheck size={16} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]" title={item.name}>
            {item.name}
          </p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">
            {t("keychain.authPasswordLabel")}
            {item.username && ` · ${item.username}`}
          </p>
          <UsageLine usedBy={usedBy} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          onClick={() => onCopy(item)}
          disabled={!item.username}
          title={t("keychain.copyUsername")}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--surface-high)] py-1.5 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-highest)] disabled:opacity-40 cursor-pointer"
        >
          <Copy size={11} /> {t("keychain.copyUsername")}
        </button>
        <CardActions item={item} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
});
