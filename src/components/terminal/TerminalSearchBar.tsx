import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchAddon } from "@xterm/addon-search";

interface TerminalSearchBarProps {
  searchAddon: SearchAddon | null;
  onClose: () => void;
}

export function TerminalSearchBar({ searchAddon, onClose }: TerminalSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);

  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input and select any existing text on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  // Listen to search results changes from xterm search addon
  useEffect(() => {
    if (!searchAddon) return;

    const disposable = searchAddon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex);
      setResultCount(e.resultCount);
    });

    return () => {
      try {
        disposable.dispose();
      } catch {}
    };
  }, [searchAddon]);

  // Execute search forwards or backwards
  const executeSearch = useCallback(
    (direction: "next" | "prev", text: string = query) => {
      if (!searchAddon || !text) {
        searchAddon?.clearDecorations();
        setResultIndex(-1);
        setResultCount(0);
        return;
      }

      const options = {
        regex,
        wholeWord,
        caseSensitive,
        incremental: direction === "next",
        decorations: {
          matchBackground: "#e3b34140",
          matchBorder: "#e3b34180",
          matchOverviewRuler: "#e3b341",
          activeMatchBackground: "#00d2b4",
          activeMatchBorder: "#00d2b4",
          activeMatchColorOverviewRuler: "#00d2b4",
        },
      };

      if (direction === "next") {
        searchAddon.findNext(text, options);
      } else {
        searchAddon.findPrevious(text, options);
      }
    },
    [searchAddon, query, regex, wholeWord, caseSensitive]
  );

  // Trigger search on query or option change
  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (!val) {
      searchAddon?.clearDecorations();
      setResultIndex(-1);
      setResultCount(0);
    } else {
      executeSearch("next", val);
    }
  };

  const handleNext = () => executeSearch("next");
  const handlePrev = () => executeSearch("prev");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="absolute top-3 right-4 z-40 flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-low)]/95 px-2.5 py-1.5 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 select-none"
    >
      {/* Search Input Box */}
      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-container)] px-2 py-1 focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)]/30 transition-colors">
        <Search size={13} className="text-[var(--text-muted)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t("terminal.search.findPlaceholder")}
          className="w-36 sm:w-48 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
        />

        {/* Match Count Indicator */}
        {query && (
          <span
            className={`shrink-0 font-mono text-[10px] pl-1 ${
              resultCount === 0
                ? "text-rose-400 font-medium"
                : "text-[var(--text-muted)]"
            }`}
          >
            {resultCount === 0
              ? t("terminal.search.zeroMatches")
              : t("terminal.search.matchesCount", {
                  current: resultIndex >= 0 ? resultIndex + 1 : 0,
                  total: resultCount,
                })}
          </span>
        )}
      </div>

      {/* Navigation Buttons: Previous & Next */}
      <button
        type="button"
        onClick={handlePrev}
        disabled={!query || resultCount === 0}
        title={t("terminal.search.prevMatch")}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
      >
        <ChevronUp size={14} />
      </button>

      <button
        type="button"
        onClick={handleNext}
        disabled={!query || resultCount === 0}
        title={t("terminal.search.nextMatch")}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
      >
        <ChevronDown size={14} />
      </button>

      {/* Option Toggles */}
      <div className="flex items-center gap-0.5 border-l border-[var(--border)] pl-1.5 ml-0.5">
        {/* Match Case */}
        <button
          type="button"
          onClick={() => {
            const next = !caseSensitive;
            setCaseSensitive(next);
            if (query) executeSearch("next", query);
          }}
          title={t("terminal.search.matchCase")}
          className={`flex h-6 px-1.5 items-center justify-center rounded text-[11px] font-mono transition cursor-pointer ${
            caseSensitive
              ? "bg-[var(--primary)]/20 text-[var(--primary)] font-bold border border-[var(--primary)]/40"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white"
          }`}
        >
          Aa
        </button>

        {/* Whole Word */}
        <button
          type="button"
          onClick={() => {
            const next = !wholeWord;
            setWholeWord(next);
            if (query) executeSearch("next", query);
          }}
          title={t("terminal.search.wholeWord")}
          className={`flex h-6 px-1.5 items-center justify-center rounded text-[11px] font-mono transition cursor-pointer ${
            wholeWord
              ? "bg-[var(--primary)]/20 text-[var(--primary)] font-bold border border-[var(--primary)]/40"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white"
          }`}
        >
          \b
        </button>

        {/* Regular Expression */}
        <button
          type="button"
          onClick={() => {
            const next = !regex;
            setRegex(next);
            if (query) executeSearch("next", query);
          }}
          title={t("terminal.search.regex")}
          className={`flex h-6 px-1.5 items-center justify-center rounded text-[11px] font-mono transition cursor-pointer ${
            regex
              ? "bg-[var(--primary)]/20 text-[var(--primary)] font-bold border border-[var(--primary)]/40"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white"
          }`}
        >
          .*
        </button>
      </div>

      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        title={t("terminal.search.closeSearch")}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-high)] hover:text-white transition cursor-pointer ml-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}
