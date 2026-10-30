import { useState, useEffect, useRef } from "react";
import { X, Save, FileCode, Check, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, FileEntry } from "../../lib/api";

interface FileEditorModalProps {
  file: FileEntry | null;
  isRemote: boolean;
  sessionId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditorModal({
  file,
  isRemote,
  sessionId,
  onClose,
  onSaved,
}: FileEditorModalProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== originalContent;

  useEffect(() => {
    if (!file) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setSaveSuccess(false);

    const loadContent = async () => {
      try {
        let text = "";
        if (isRemote) {
          if (!sessionId) throw new Error("No active SFTP session");
          text = await api.readSftpFile(sessionId, file.path);
        } else {
          text = await api.readLocalFile(file.path);
        }
        if (isMounted) {
          setContent(text);
          setOriginalContent(text);
          setLoading(false);
        }
      } catch (e) {
        if (isMounted) {
          setError(String(e));
          setLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      isMounted = false;
    };
  }, [file, isRemote, sessionId]);

  async function handleSave() {
    if (!file || saving) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      if (isRemote) {
        if (!sessionId) throw new Error("No active SFTP session");
        await api.writeSftpFile(sessionId, file.path, content);
      } else {
        await api.writeLocalFile(file.path, content);
      }
      setOriginalContent(content);
      setSaveSuccess(true);
      onSaved?.();
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Handle Tab key in textarea to insert 2 spaces
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  }

  function handleClose() {
    if (isDirty) {
      if (!confirm(t("sftp.editor.confirmUnsavedClose"))) {
        return;
      }
    }
    onClose();
  }

  if (!file) return null;

  const lineCount = content.split("\n").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="flex h-[90vh] w-[95vw] max-w-5xl flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-low)] px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileCode size={18} className="text-[var(--primary)] shrink-0" />
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {file.name}
              </span>
              <span className="hidden sm:inline font-mono text-[11px] text-[var(--text-muted)] truncate max-w-md">
                {file.path}
              </span>
              {isRemote ? (
                <span className="rounded bg-[var(--primary)]/15 px-1.5 py-0.5 font-mono text-[9px] text-[var(--primary)] shrink-0">
                  {t("sftp.editor.remoteBadge")}
                </span>
              ) : (
                <span className="rounded bg-[var(--surface-high)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-muted)] shrink-0">
                  {t("sftp.editor.localBadge")}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Status indicator */}
            {isDirty && !saving && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--warning)]">
                <span className="h-2 w-2 rounded-full bg-[var(--warning)] animate-pulse" />
                {t("sftp.editor.unsavedChanges")}
              </span>
            )}
            {saveSuccess && (
              <span className="flex items-center gap-1 font-mono text-[11px] text-[var(--success)]">
                <Check size={13} />
                {t("sftp.editor.saved")}
              </span>
            )}

            <button
              onClick={handleSave}
              disabled={saving || loading || !isDirty}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-40 cursor-pointer"
            >
              {saving ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              <span>{t("sftp.editor.save")}</span>
              <kbd className="hidden sm:inline font-mono text-[10px] bg-black/20 px-1 py-0.5 rounded opacity-75">
                Ctrl+S
              </kbd>
            </button>

            <button
              onClick={handleClose}
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Error bar if read/write failed */}
        {error && (
          <div className="flex items-center gap-2 border-b border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2 text-xs text-[var(--danger)] shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Editor Main Body */}
        <div className="relative flex-1 overflow-hidden bg-[var(--canvas)] flex">
          {loading ? (
            <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin mr-2 text-[var(--primary)]" />
              {t("sftp.editor.loadingContent")}
            </div>
          ) : (
            <>
              {/* Line numbers gutter */}
              <div className="hidden sm:flex flex-col py-3 px-2 select-none border-r border-[var(--border)] bg-[var(--surface-low)] text-right font-mono text-xs text-[var(--text-muted)] w-12 overflow-hidden shrink-0">
                {Array.from({ length: Math.min(lineCount, 1000) }, (_, i) => (
                  <div key={i} className="leading-[21px] text-[11px] opacity-60">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Textarea Code Editor */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoFocus
                className="flex-1 resize-none bg-transparent p-3 font-mono text-xs text-[var(--text-primary)] leading-[21px] focus:outline-none overflow-y-auto whitespace-pre tab-size-2"
                style={{ tabSize: 2 }}
              />
            </>
          )}
        </div>

        {/* Footer info bar */}
        <div className="flex h-7 items-center justify-between border-t border-[var(--border)] bg-[var(--surface-low)] px-4 font-mono text-[10px] text-[var(--text-muted)] shrink-0">
          <div>
            {t("sftp.editor.linesCount", { count: lineCount })} | {t("sftp.editor.charsCount", { count: content.length })}
          </div>
          <div>UTF-8 Plain Text</div>
        </div>
      </div>
    </div>
  );
}
