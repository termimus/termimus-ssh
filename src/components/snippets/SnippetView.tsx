import { useEffect, useMemo, useState, useCallback, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  Plus,
  Play,
  Pencil,
  Trash2,
  Search,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  XCircle,
  Tag,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSnippetStore } from "../../stores/useSnippetStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useConfirmStore } from "../../stores/useConfirmStore";
import { Snippet } from "../../lib/api";
import { copyText } from "../../lib/clipboard";

type Toast = { kind: "success" | "error"; message: string };
type RunFeedback = { id: string; ok: boolean };

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer";

const isSecretSnippet = (snippet: Snippet) =>
  snippet.tags.some((tag) => tag.toLowerCase() === "secret");

export function SnippetView() {
  const { t } = useTranslation();
  const {
    snippets,
    isLoading,
    error,
    refresh,
    deleteSnippet,
    openCreateModal,
    openEditModal,
  } = useSnippetStore(
    useShallow((s) => ({
      snippets: s.snippets,
      isLoading: s.isLoading,
      error: s.error,
      refresh: s.refresh,
      deleteSnippet: s.deleteSnippet,
      openCreateModal: s.openCreateModal,
      openEditModal: s.openEditModal,
    }))
  );
  const { tabs, activeTabId, sendTextToActiveSession } = useSessionStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      sendTextToActiveSession: s.sendTextToActiveSession,
    }))
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "snippet" | "background";
    snippet?: Snippet;
  } | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), next.kind === "error" ? 4000 : 1800);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (runTimer.current) clearTimeout(runTimer.current);
  }, []);

  const handleSnippetContextMenu = useCallback((e: React.MouseEvent, snippet: Snippet) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 250);
    setContextMenu({ x, y, type: "snippet", snippet });
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

  useEffect(() => {
    // Only refresh if snippets empty; otherwise preloaded on unlock
    if (snippets.length === 0) {
      refresh();
    }
  }, [snippets.length, refresh]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const hasActiveTerminal = Boolean(activeTab?.connected);

  // Unique tags with usage counts (the "secret" system tag is shown as a badge instead).
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of snippets) {
      for (const tag of s.tags) {
        if (tag.toLowerCase() === "secret") continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) =>
      a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" })
    );
  }, [snippets]);

  // Drop the filter if its tag no longer exists (snippet edited/deleted).
  useEffect(() => {
    if (selectedTag && !allTags.some((t) => t.tag === selectedTag)) setSelectedTag(null);
  }, [allTags, selectedTag]);

  const query = searchQuery.trim().toLowerCase();
  const filteredSnippets = useMemo(() => {
    const byTag = selectedTag ? snippets.filter((s) => s.tags.includes(selectedTag)) : snippets;
    if (!query) return byTag;
    return byTag.filter(
      (s) =>
        s.title.toLowerCase().includes(query) ||
        // Secret commands are masked on the card, so don't let search reveal them.
        (!isSecretSnippet(s) && s.command.toLowerCase().includes(query)) ||
        s.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [snippets, query, selectedTag]);

  const handleRun = useCallback(
    async (snippetId: string, command: string) => {
      const ok = await sendTextToActiveSession(command);
      setRunFeedback({ id: snippetId, ok });
      if (runTimer.current) clearTimeout(runTimer.current);
      runTimer.current = setTimeout(
        () => setRunFeedback((prev) => (prev?.id === snippetId ? null : prev)),
        2000
      );
    },
    [sendTextToActiveSession]
  );

  const handleCopy = useCallback(
    async (command: string): Promise<boolean> => {
      try {
        await copyText(command);
        showToast({ kind: "success", message: t("snippets.copied") });
        return true;
      } catch (err) {
        showToast({ kind: "error", message: t("snippets.copyFailed", { error: String(err) }) });
        return false;
      }
    },
    [showToast, t]
  );

  const handleDelete = useCallback(
    (snippet: Snippet) => {
      useConfirmStore.getState().confirm({
        title: t("snippets.deleteConfirm.title"),
        message: t("snippets.deleteConfirm.message", { title: `"${snippet.title}"` }),
        confirmLabel: t("snippets.deleteConfirm.confirmLabel"),
        isDanger: true,
        onConfirm: async () => {
          try {
            await deleteSnippet(snippet.id);
          } catch (err) {
            showToast({
              kind: "error",
              message: t("snippets.deleteFailed", { title: snippet.title, error: String(err) }),
            });
          }
        },
      });
    },
    [deleteSnippet, showToast, t]
  );

  return (
    <div
      onContextMenu={handleBackgroundContextMenu}
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--canvas)] p-4 text-[var(--text-primary)] select-none"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Terminal size={18} className="text-[var(--accent)]" />
            {t("snippets.title")}
            {snippets.length > 0 && (
              <span className="rounded-md bg-[var(--surface-container)] px-1.5 py-0.5 text-[10px] font-mono font-normal text-[var(--text-muted)]">
                {snippets.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {hasActiveTerminal
              ? t("snippets.runTarget", { target: activeTab?.hostLabel })
              : t("snippets.subtitle")}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)] cursor-pointer"
        >
          <Plus size={14} /> {t("snippets.newSnippet")}
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("snippets.searchPlaceholder")}
          aria-label={t("snippets.searchPlaceholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedTag(null)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
              selectedTag === null
                ? "border-[var(--primary)] bg-[var(--primary)] text-black"
                : "border-[var(--border)] bg-[var(--surface-container)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t("snippets.sidebar.allTags")}
            <span className="ml-1 font-mono opacity-70">{snippets.length}</span>
          </button>
          {allTags.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setSelectedTag((prev) => (prev === tag ? null : tag))}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-mono transition-colors cursor-pointer ${
                selectedTag === tag
                  ? "border-[var(--primary)] bg-[var(--primary)] text-black"
                  : "border-[var(--border)] bg-[var(--surface-container)] text-[var(--text-muted)] hover:border-[var(--primary)]/40 hover:text-[var(--text-primary)]"
              }`}
            >
              <Tag size={10} />
              <span>{tag}</span>
              <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">{t("snippets.loadError", { error })}</span>
            <button
              onClick={() => refresh()}
              className="shrink-0 rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 font-medium hover:bg-[var(--danger)]/15 cursor-pointer"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {!hasActiveTerminal && snippets.length > 0 && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3.5 py-2.5 text-xs text-[var(--warning)]">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{t("snippets.sidebar.noActiveSessionDesc")}</span>
          </div>
        )}

        {isLoading && snippets.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-16 text-xs text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("snippets.sidebar.loadingLibrary")}</span>
          </div>
        ) : snippets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-container)] text-[var(--primary)] shadow-sm">
              <Terminal size={26} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("snippets.sidebar.noSnippetsTitle")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("snippets.sidebar.noSnippetsDesc")}
            </p>
            <button
              onClick={openCreateModal}
              className="mt-6 flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] shadow-md hover:bg-[var(--primary-hover)] transition-colors cursor-pointer"
            >
              <Plus size={14} />
              {t("snippets.sidebar.addFirstSnippet")}
            </button>
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <Search size={26} className="mb-3 text-[var(--text-muted)] opacity-60" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t("snippets.emptySearchTitle", { query: searchQuery.trim() })}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
              {t("snippets.emptySearchDesc")}
            </p>
          </div>
        ) : (
          // auto-fill: wide windows get more columns instead of stretching each card
          <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]">
            {filteredSnippets.map((snippet) => (
              <SnippetCard
                key={snippet.id}
                snippet={snippet}
                hasActiveTerminal={hasActiveTerminal}
                runResult={runFeedback?.id === snippet.id ? runFeedback.ok : undefined}
                onRun={handleRun}
                onCopy={handleCopy}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onContextMenu={handleSnippetContextMenu}
              />
            ))}
          </div>
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
          {contextMenu.type === "snippet" && contextMenu.snippet ? (
            (() => {
              const snippet = contextMenu.snippet;
              const close = () => setContextMenu(null);
              return (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      handleRun(snippet.id, snippet.command);
                      close();
                    }}
                    disabled={!hasActiveTerminal}
                    className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black disabled:opacity-40 disabled:pointer-events-none`}
                  >
                    <Play size={13} />
                    <span>{t("snippets.sidebar.runInTerminal")}</span>
                  </button>

                  <div className="my-1 h-[1px] bg-[var(--border)]" />

                  <button
                    role="menuitem"
                    onClick={() => {
                      handleCopy(snippet.command);
                      close();
                    }}
                    className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                  >
                    <Copy size={13} />
                    <span>{t("snippets.copy")}</span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      openEditModal(snippet);
                      close();
                    }}
                    className={`${MENU_ITEM} hover:bg-[var(--surface-container)]`}
                  >
                    <Pencil size={13} />
                    <span>{t("snippets.modal.titleEdit")}</span>
                  </button>

                  <div className="my-1 h-[1px] bg-[var(--border)]" />

                  <button
                    role="menuitem"
                    onClick={() => {
                      handleDelete(snippet);
                      close();
                    }}
                    className={`${MENU_ITEM} hover:bg-[var(--danger)] hover:text-white`}
                  >
                    <Trash2 size={13} />
                    <span>{t("common.delete")}</span>
                  </button>
                </>
              );
            })()
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                openCreateModal();
                setContextMenu(null);
              }}
              className={`${MENU_ITEM} hover:bg-[var(--primary)] hover:text-black`}
            >
              <Plus size={13} />
              <span>{t("snippets.newSnippet")}</span>
            </button>
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
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMOIZED SNIPPET CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

interface SnippetCardProps {
  snippet: Snippet;
  hasActiveTerminal: boolean;
  /** true = sent, false = send failed, undefined = idle */
  runResult?: boolean;
  onRun: (id: string, command: string) => void;
  onCopy: (command: string) => Promise<boolean>;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
  onContextMenu?: (e: React.MouseEvent, snippet: Snippet) => void;
}

const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors cursor-pointer";

const SnippetCard = memo(function SnippetCard({
  snippet,
  hasActiveTerminal,
  runResult,
  onRun,
  onCopy,
  onEdit,
  onDelete,
  onContextMenu,
}: SnippetCardProps) {
  const { t } = useTranslation();
  const isSecret = isSecretSnippet(snippet);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayTags = snippet.tags.filter((tag) => tag.toLowerCase() !== "secret");
  const lineCount = snippet.command.split("\n").length;
  const isMasked = isSecret && !isRevealed;

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const handleCopy = async () => {
    if (!(await onCopy(snippet.command))) return;
    setIsCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setIsCopied(false), 1800);
  };

  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, snippet)}
      className="group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition-colors hover:border-[var(--primary)]/40"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3
              className="truncate text-sm font-semibold text-[var(--text-primary)]"
              title={snippet.title}
            >
              {snippet.title}
            </h3>
            {isSecret && (
              <span
                title={t("snippets.sidebar.secretBadgeTooltip")}
                className="flex shrink-0 items-center gap-1 rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--warning)]"
              >
                <Lock size={10} />
                {t("snippets.sidebar.secretBadge")}
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
            {t("snippets.lineCount", { count: lineCount })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={handleCopy}
            title={isCopied ? t("snippets.copied") : t("snippets.sidebar.copyCommandTooltip")}
            className={`${ICON_BUTTON} hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]`}
          >
            {isCopied ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
          </button>
          <button
            onClick={() => onEdit(snippet)}
            title={t("snippets.sidebar.editSnippetTooltip")}
            className={`${ICON_BUTTON} hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]`}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(snippet)}
            title={t("snippets.sidebar.deleteSnippetTooltip")}
            className={`${ICON_BUTTON} hover:bg-[var(--danger)]/15 hover:text-[var(--danger)]`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Command preview — sized to content (max 4 lines) */}
      <div className="relative mt-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--canvas)] py-1.5 pl-2.5 pr-8">
        {isMasked ? (
          <div className="font-mono text-[11px] leading-4 tracking-widest text-[var(--text-muted)] select-none">
            ••••••••••••••••
          </div>
        ) : (
          <pre
            title={snippet.command}
            className="line-clamp-4 whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-[var(--text-secondary)] select-text"
          >
            {snippet.command}
          </pre>
        )}
        {isSecret && (
          <button
            onClick={() => setIsRevealed((prev) => !prev)}
            title={isRevealed ? t("snippets.sidebar.hideSecretTooltip") : t("snippets.sidebar.revealSecretTooltip")}
            className={`absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 ${ICON_BUTTON} ${
              isRevealed
                ? "bg-[var(--warning)]/15 text-[var(--warning)]"
                : "bg-[var(--surface-container)] hover:bg-[var(--surface-high)] hover:text-[var(--text-primary)]"
            }`}
          >
            {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>

      {/* Footer: tags + run — mt-auto keeps it aligned across a row */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <div
          className="flex min-w-0 items-center gap-1 overflow-hidden"
          title={displayTags.map((tag) => `#${tag}`).join(" ") || undefined}
        >
          {displayTags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="max-w-[96px] shrink-0 truncate rounded-full border border-[var(--border)] bg-[var(--surface-container)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]"
            >
              #{tag}
            </span>
          ))}
          {displayTags.length > 3 && (
            <span className="shrink-0 text-[10px] font-mono text-[var(--text-muted)]">
              +{displayTags.length - 3}
            </span>
          )}
        </div>

        {/* Outline by default so a grid of cards isn't a wall of bright buttons;
            fills in when the card is hovered (only while a terminal is connected). */}
        <button
          onClick={() => onRun(snippet.id, snippet.command)}
          disabled={!hasActiveTerminal}
          title={hasActiveTerminal ? undefined : t("snippets.sidebar.connectSessionPrompt")}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
            runResult === true
              ? "border-[var(--success)]/40 bg-[var(--success)]/15 text-[var(--success)]"
              : runResult === false
                ? "border-[var(--danger)]/40 bg-[var(--danger)]/15 text-[var(--danger)]"
                : "border-[var(--primary)]/40 text-[var(--primary)] enabled:group-hover:border-[var(--primary)] enabled:group-hover:bg-[var(--primary)] enabled:group-hover:text-black enabled:hover:bg-[var(--primary)]/90"
          }`}
        >
          {runResult === true ? (
            <>
              <CheckCircle2 size={12} />
              {t("snippets.sent")}
            </>
          ) : runResult === false ? (
            <>
              <XCircle size={12} />
              {t("snippets.failed")}
            </>
          ) : (
            <>
              <Play size={12} className="fill-current" />
              {t("snippets.run")}
            </>
          )}
        </button>
      </div>
    </div>
  );
});
