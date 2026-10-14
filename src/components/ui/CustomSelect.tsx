import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Shows a search box that filters options by label/description as you type */
  searchable?: boolean;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  disabled = false,
  className = "",
  searchable = false,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const handleClose = useCallback(() => setIsOpen(false), []);

  // With a query typed, the empty-value entry is the inert "Select a host..."
  // placeholder rather than a real choice, so it drops out of the results.
  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.value !== "" &&
        (opt.label.toLowerCase().includes(q) ||
          (opt.description ?? "").toLowerCase().includes(q))
    );
  }, [searchable, options, query]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredOptions.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlightIdx(
          (i) => (i + delta + filteredOptions.length) % filteredOptions.length
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = filteredOptions[highlightIdx];
        if (opt) {
          onChange(opt.value);
          setIsOpen(false);
        }
      } else if (e.key === "Escape" && query) {
        // First Escape clears the query; the window-level handler closes the dropdown
        e.stopPropagation();
        setQuery("");
      }
    },
    [filteredOptions, highlightIdx, onChange, query]
  );

  // Keep the keyboard-highlighted option visible while arrowing through a long list
  useEffect(() => {
    if (!isOpen) return;
    popoverRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, isOpen, query]);

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownEstimatedHeight = 240;

    // Prefer opening downwards unless space below is tight and there is more room above
    const openUpwards = spaceBelow < dropdownEstimatedHeight && spaceAbove > spaceBelow;
    const maxHeight = openUpwards
      ? Math.min(240, Math.max(120, spaceAbove - 16))
      : Math.min(240, Math.max(120, spaceBelow - 16));

    const popoverWidth = Math.max(rect.width, 200);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - popoverWidth - 8));

    if (openUpwards) {
      setCoords({
        bottom: viewportHeight - rect.top + 4,
        left,
        width: popoverWidth,
        maxHeight,
      });
    } else {
      setCoords({
        top: rect.bottom + 4,
        left,
        width: popoverWidth,
        maxHeight,
      });
    }
  }, []);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      updatePosition();
      setQuery("");
      setHighlightIdx(0);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  // Re-position when scrolling or resizing (capture phase to catch scrolling inside any modal/div)
  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }

    updatePosition();

    function handleScrollOrResize() {
      updatePosition();
    }

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen, updatePosition]);

  // Close on click outside & Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        handleClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Stop immediate propagation so that parent modal's Escape handler
        // does not also fire and close the entire modal when dismissing this dropdown.
        e.stopImmediatePropagation();
        handleClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        title={
          selectedOption
            ? `${selectedOption.label}${selectedOption.description ? ` ${selectedOption.description}` : ""}`
            : placeholder
        }
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-container)] px-3 py-2 text-left text-xs transition-colors cursor-pointer focus:border-[var(--primary)] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed hover:border-[var(--border)]/80 ${
          isOpen ? "border-[var(--primary)] ring-1 ring-[var(--primary)]/30" : ""
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption?.icon && (
            <span className="shrink-0">{selectedOption.icon}</span>
          )}
          <span
            className={`truncate font-medium shrink-0 max-w-[65%] ${
              selectedOption ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.description && (
            <span className="truncate text-[11px] font-mono text-[var(--text-muted)] flex-1">
              {selectedOption.description}
            </span>
          )}
        </div>

        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${
            isOpen ? "rotate-180 text-[var(--primary)]" : ""
          }`}
        />
      </button>

      {/* Popover Menu rendered via Portal to prevent container clipping / overflow issues */}
      {isOpen &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 9999,
            }}
            className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-low)]/98 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-75 text-xs select-none"
          >
            {searchable && (
              <div className="relative shrink-0 pb-1.5">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlightIdx(0);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search..."
                  aria-label="Search options"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-container)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none"
                />
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {options.length === 0 ? (
                <div className="px-3 py-2 text-center text-xs text-[var(--text-muted)]">
                  No options available
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-3 py-2 text-center text-xs text-[var(--text-muted)]">
                  No matches for &quot;{query.trim()}&quot;
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === highlightIdx && searchable;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-highlighted={isHighlighted || undefined}
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => {
                        if (searchable) setHighlightIdx(idx);
                      }}
                      title={`${opt.label}${opt.description ? ` ${opt.description}` : ""}`}
                      className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[var(--primary)]/15 text-[var(--primary)] font-semibold"
                          : isHighlighted
                            ? "bg-[var(--surface-high)] text-[var(--text-primary)]"
                            : "text-[var(--text-primary)] hover:bg-[var(--surface-high)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <span className="truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="truncate text-[10px] font-mono text-[var(--text-muted)]">
                            {opt.description}
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <Check size={13} className="shrink-0 text-[var(--primary)]" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
