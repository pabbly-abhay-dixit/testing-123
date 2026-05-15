import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from './Tooltip';

// Multi-select dropdown ported verbatim from ptm-app's SearchableSelect.
// Supports include / exclude tabs, search, color dots, keyboard nav, and an
// optional portal-positioned dropdown. The Dashboard uses this for the
// Folders / Status / Created By filters so the visual + interaction language
// matches Pabbly PM exactly.
const MultiSearchableSelect = ({
  value,
  onChange,
  options = [],
  placeholder = 'All',
  searchPlaceholder = 'Search...',
  label,
  // Tooltip text shown next to the label (small i icon). Use to explain
  // what the filter does — required by the design system on admin pages.
  labelTooltip,
  renderOption,
  getOptionLabel = (opt) => opt.label,
  // Display-only label for the trigger chip; defaults to getOptionLabel.
  // Useful when search needs to match multiple fields (e.g. "name email"),
  // but the chip should only show one (e.g. just the name).
  getOptionDisplayLabel,
  // Extra hover text on the trigger chip (e.g. show full email when only the
  // name is in the chip). Falls back to getOptionLabel.
  getOptionChipTitle,
  getOptionValue = (opt) => opt.value,
  multi = false,
  disableExclude = false,
  dropdownAlign = 'left',
  dropUp = false,
  usePortal = false,
  dropdownTabs,
  footer,
  renderOptionAccessory,
  // Single-select only. When true, suppresses the placeholder/reset row
  // that normally renders at the top of the dropdown list. Use this when
  // the caller already supplies a sensible default option (e.g. "Home"
  // for a folder picker) and a redundant "Select a folder" reset entry
  // would just confuse the user.
  hidePlaceholderRow = false,
}) => {
  const displayLabelFn = getOptionDisplayLabel || getOptionLabel
  const chipTitleFn = getOptionChipTitle || getOptionLabel
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(dropdownTabs?.[0]?.key || '');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [mode, setMode] = useState('include');
  const [autoAlignRight, setAutoAlignRight] = useState(false);
  const [dropdownOffset, setDropdownOffset] = useState(null);
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const triggerBtnRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const dropdownRef = useRef(null);
  const portalDropdownRef = useRef(null);

  const filteredOptions = useMemo(() =>
    options.filter((opt) => {
      if (opt._separator) return false;
      const matchesSearch = getOptionLabel(opt).toLowerCase().includes(search.toLowerCase());
      if (dropdownTabs && opt._tab) return matchesSearch && opt._tab === activeTab;
      return matchesSearch;
    }),
    [options, search, getOptionLabel, dropdownTabs, activeTab]
  );

  const selectedOption = useMemo(() => {
    if (multi) return null;
    return options.find((opt) => getOptionValue(opt) === value);
  }, [multi, options, value, getOptionValue]);

  const includeSet = useMemo(() => {
    if (!multi || !value) return new Set();
    return new Set(value.include || []);
  }, [multi, value]);

  const excludeSet = useMemo(() => {
    if (!multi || !value) return new Set();
    return new Set(value.exclude || []);
  }, [multi, value]);

  // Tab-scoped option list. The Include tab shows currently-included rows
  // pinned to the top + every unselected row below (excluded rows are
  // hidden — they belong to the Exclude tab). The Exclude tab does the
  // mirror. Hiding the OPPOSITE bucket prevents the "mixing" UX where a
  // user on the Include tab sees red-highlighted excluded rows they
  // can't act on without flipping tabs first. When Exclude isn't
  // available (`disableExclude`), every selected row pins to the top
  // since there's no separate bucket to filter against.
  const sortedOptions = useMemo(() => {
    if (!multi) return filteredOptions;
    const selected = [];
    const unselected = [];
    for (const opt of filteredOptions) {
      const v = getOptionValue(opt);
      const inc = includeSet.has(v);
      const exc = excludeSet.has(v);
      if (!disableExclude) {
        // Hide the opposite bucket so each tab only surfaces rows it can
        // sensibly act on.
        if (mode === 'include' && exc) continue;
        if (mode === 'exclude' && inc) continue;
      }
      if (inc || exc) selected.push(opt);
      else unselected.push(opt);
    }
    return [...selected, ...unselected];
  }, [multi, filteredOptions, includeSet, excludeSet, getOptionValue, mode, disableExclude]);

  const displayValue = useMemo(() => {
    if (!multi) {
      return selectedOption ? displayLabelFn(selectedOption) : placeholder;
    }
    const inc = value?.include?.length || 0;
    const exc = value?.exclude?.length || 0;
    if (inc === 0 && exc === 0) return placeholder;
    if (inc === 1 && exc === 0) {
      const opt = options.find(o => getOptionValue(o) === value.include[0]);
      return opt ? displayLabelFn(opt) : placeholder;
    }
    const parts = [];
    if (inc > 0) parts.push(`${inc} included`);
    if (exc > 0) parts.push(`${exc} excluded`);
    return parts.join(', ');
  }, [multi, value, selectedOption, options, displayLabelFn, getOptionValue, placeholder]);

  // Native title for the chip — surfaces extra context (e.g. full email)
  // when the visible chip only shows a short display label.
  const chipTitle = useMemo(() => {
    if (!multi) return selectedOption ? chipTitleFn(selectedOption) : '';
    const inc = value?.include?.length || 0;
    const exc = value?.exclude?.length || 0;
    if (inc === 1 && exc === 0) {
      const opt = options.find(o => getOptionValue(o) === value.include[0]);
      return opt ? chipTitleFn(opt) : '';
    }
    return '';
  }, [multi, value, selectedOption, options, chipTitleFn, getOptionValue]);

  const hasValue = multi
    ? (value?.include?.length > 0 || value?.exclude?.length > 0)
    : !!value;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (usePortal && portalDropdownRef.current && portalDropdownRef.current.contains(e.target)) return;
        setIsOpen(false);
        setSearch('');
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    return () => document.removeEventListener('pointerdown', handleClickOutside, true);
  }, [isOpen, usePortal]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && !usePortal && dropdownRef.current && containerRef.current) {
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      if (dropdownRect.right > viewportWidth - 8) {
        const rightAlignedLeft = containerRect.right - dropdownRect.width;
        if (rightAlignedLeft < 8) {
          const offsetLeft = 8 - containerRect.left;
          setAutoAlignRight(false);
          setDropdownOffset(offsetLeft);
        } else {
          setAutoAlignRight(true);
          setDropdownOffset(null);
        }
      } else if (dropdownRect.left < 8) {
        const offsetLeft = 8 - containerRect.left;
        setAutoAlignRight(false);
        setDropdownOffset(offsetLeft);
      } else {
        setAutoAlignRight(false);
        setDropdownOffset(null);
      }
    } else if (!usePortal) {
      setAutoAlignRight(false);
      setDropdownOffset(null);
    }
  }, [isOpen, usePortal]);

  useLayoutEffect(() => {
    if (!isOpen || !usePortal || !triggerBtnRef.current) return;
    const rect = triggerBtnRef.current.getBoundingClientRect();
    const dropdownHeight = 280;
    const dropdownWidth = 256;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + dropdownHeight > window.innerHeight - 8) top = rect.top - dropdownHeight - 4;
    if (left + dropdownWidth > window.innerWidth - 8) left = window.innerWidth - dropdownWidth - 8;
    setPortalPos({ top, left, width: Math.max(rect.width, dropdownWidth) });
  }, [isOpen, usePortal]);

  useEffect(() => {
    if (!isOpen || !usePortal) return;
    const handleScroll = (e) => {
      if (portalDropdownRef.current?.contains(e.target)) return;
      if (triggerBtnRef.current) {
        const rect = triggerBtnRef.current.getBoundingClientRect();
        const dropdownHeight = 280;
        const dropdownWidth = 256;
        let top = rect.bottom + 4;
        let left = rect.left;
        if (top + dropdownHeight > window.innerHeight - 8) top = rect.top - dropdownHeight - 4;
        if (left + dropdownWidth > window.innerWidth - 8) left = window.innerWidth - dropdownWidth - 8;
        setPortalPos({ top, left, width: Math.max(rect.width, dropdownWidth) });
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen, usePortal]);

  useEffect(() => {
    setHighlightedIndex(sortedOptions.length === 1 ? 0 : -1);
  }, [search, sortedOptions.length]);

  // Only auto-scroll the list into view when the highlight moved via
  // KEYBOARD (Arrow keys). Mouse hover still updates the highlight bg
  // but must NOT trigger scrollIntoView — otherwise just hovering rows
  // makes the list creep up/down on its own.
  const keyboardNavRef = useRef(false);
  useEffect(() => {
    if (!keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-option-item]');
      if (items[highlightedIndex]) items[highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const handleSelect = useCallback((optionValue) => {
    if (!multi) {
      onChange(optionValue);
      setIsOpen(false);
      setSearch('');
      setHighlightedIndex(-1);
      return;
    }
    const current = value || { include: [], exclude: [] };
    const include = [...(current.include || [])];
    const exclude = [...(current.exclude || [])];
    if (mode === 'include') {
      if (include.includes(optionValue)) {
        onChange({ include: include.filter(v => v !== optionValue), exclude });
      } else {
        onChange({ include: [...include, optionValue], exclude: exclude.filter(v => v !== optionValue) });
      }
    } else {
      if (exclude.includes(optionValue)) {
        onChange({ include, exclude: exclude.filter(v => v !== optionValue) });
      } else {
        onChange({ include: include.filter(v => v !== optionValue), exclude: [...exclude, optionValue] });
      }
    }
  }, [multi, value, mode, onChange]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    onChange(multi ? { include: [], exclude: [] } : '');
    setIsOpen(false);
    setSearch('');
  }, [multi, onChange]);

  // Bulk-toggle every currently-VISIBLE option into the active mode bucket
  // (Include / Exclude). The user reaches for this when they want to act on a
  // search-narrowed set in one click — e.g. type "pabbly" → switch to Exclude
  // → "Select all matching" to drop every internal address from the table.
  // Sourced from `sortedOptions` (search + tab-scoped) so the count + the
  // bulk action match exactly what the user sees in the dropdown — no
  // "ghost" excluded rows being added when the user is on the Include tab.
  const visibleValues = useMemo(
    () => sortedOptions.map((opt) => getOptionValue(opt)),
    [sortedOptions, getOptionValue]
  );
  // True when every visible row is already in the active mode bucket — flips
  // the button label to a deselect action so a second click is the inverse
  // of the first.
  const allVisibleInMode = useMemo(() => {
    if (!multi || visibleValues.length === 0) return false;
    const bucket = mode === 'include' ? includeSet : excludeSet;
    return visibleValues.every((v) => bucket.has(v));
  }, [multi, visibleValues, mode, includeSet, excludeSet]);

  const handleSelectAllVisible = useCallback(() => {
    if (!multi || visibleValues.length === 0) return;
    const current = value || { include: [], exclude: [] };
    const include = new Set(current.include || []);
    const exclude = new Set(current.exclude || []);
    if (allVisibleInMode) {
      // Deselect: pull every visible row out of the active bucket. Leaves
      // unrelated selections (rows not currently visible) untouched.
      const target = mode === 'include' ? include : exclude;
      visibleValues.forEach((v) => target.delete(v));
    } else {
      // Select: push every visible row into the active bucket and remove
      // any conflicting entry from the OTHER bucket so include/exclude
      // can never both hold the same value.
      const target = mode === 'include' ? include : exclude;
      const opposite = mode === 'include' ? exclude : include;
      visibleValues.forEach((v) => {
        target.add(v);
        opposite.delete(v);
      });
    }
    onChange({ include: Array.from(include), exclude: Array.from(exclude) });
  }, [multi, visibleValues, allVisibleInMode, mode, value, onChange]);

  const handleKeyDown = useCallback((e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        keyboardNavRef.current = true;
        setHighlightedIndex((prev) => prev < sortedOptions.length - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        keyboardNavRef.current = true;
        setHighlightedIndex((prev) => prev > 0 ? prev - 1 : sortedOptions.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && sortedOptions[highlightedIndex]) {
          handleSelect(getOptionValue(sortedOptions[highlightedIndex]));
        } else if (sortedOptions.length === 1) {
          handleSelect(getOptionValue(sortedOptions[0]));
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearch('');
        setHighlightedIndex(-1);
        break;
      case 'Tab':
        if (highlightedIndex >= 0 && sortedOptions[highlightedIndex]) {
          handleSelect(getOptionValue(sortedOptions[highlightedIndex]));
        } else {
          setIsOpen(false);
          setSearch('');
          setHighlightedIndex(-1);
        }
        break;
      default:
        break;
    }
  }, [isOpen, sortedOptions, highlightedIndex, handleSelect, getOptionValue]);

  const getOptionState = useCallback((optionValue) => {
    if (includeSet.has(optionValue)) return 'included';
    if (excludeSet.has(optionValue)) return 'excluded';
    return 'none';
  }, [includeSet, excludeSet]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        labelTooltip ? (
          <Tooltip content={labelTooltip}>
            <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1 cursor-help">
              {label}
            </label>
          </Tooltip>
        ) : (
          <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">
            {label}
          </label>
        )
      )}

      <button
        ref={triggerBtnRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        title={chipTitle || undefined}
        className="w-full text-sm leading-5 border rounded-xl px-3 py-1.5 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 transition-colors bg-white dark:bg-neutral-900 text-left text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-600 hover:border-neutral-300 dark:hover:border-neutral-500"
      >
        <span className="flex items-center gap-1">
          <span className={`flex-1 truncate ${!hasValue ? 'text-neutral-400 dark:text-neutral-500' : ''}`}>
            {displayValue}
          </span>
          {hasValue ? (
            <span
              onClick={handleClear}
              className="flex-shrink-0 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          ) : (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 pointer-events-none transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </span>
      </button>

      {isOpen && (() => {
        const dropdownContent = (
          <div ref={usePortal ? portalDropdownRef : dropdownRef} className={`${usePortal ? 'fixed' : 'absolute'} z-[9999] w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 pt-1 pb-0 overflow-hidden ${!usePortal && dropUp ? 'bottom-full mb-1' : !usePortal ? 'mt-1' : ''} ${!usePortal && (autoAlignRight || dropdownAlign === 'right') ? 'right-0' : ''}`} style={usePortal ? { top: portalPos.top, left: portalPos.left, minWidth: portalPos.width } : dropdownOffset != null ? { left: dropdownOffset, right: 'auto' } : undefined}>
            {multi && !disableExclude && (
              <div className="px-2 pb-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => setMode('include')}
                  className={`flex-1 text-xs font-medium py-1 px-2 rounded transition-colors ${
                    mode === 'include'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400'
                  }`}
                >Include</button>
                <button
                  type="button"
                  onClick={() => setMode('exclude')}
                  className={`flex-1 text-xs font-medium py-1 px-2 rounded transition-colors ${
                    mode === 'exclude'
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                      : 'bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400'
                  }`}
                >Exclude</button>
              </div>
            )}

            {dropdownTabs && (
              <div className="flex gap-1 px-2 pb-1.5">
                {dropdownTabs.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setActiveTab(tab.key); setSearch(''); }}
                    className={`flex-1 text-xs font-medium py-1 px-2 rounded transition-colors ${
                      activeTab === tab.key
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-700'
                    }`}
                  >{tab.label}</button>
                ))}
              </div>
            )}

            <div className="px-2 pb-1">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-600 rounded-xl placeholder-gray-400 dark:placeholder-neutral-500 text-gray-900 dark:text-neutral-100 focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-neutral-700 my-1"></div>

            {/* Bulk select/deselect every visible row into the active bucket
                (Include / Exclude). Surfaces ONLY when the search box has a
                query — the action is "select/exclude every row matching the
                current search". Without a search it would be redundant with
                the default no-filter state (which already shows every row).
                Hidden in single-select mode and when the list is empty. */}
            {multi && visibleValues.length > 0 && search.trim().length > 0 && (
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-between gap-2 ${
                  mode === 'include'
                    ? 'text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                    : 'text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'
                }`}
              >
                <span>
                  {allVisibleInMode ? 'Deselect' : 'Select'} all
                  {search ? ' matching' : ''}
                  {' '}
                  <span className="text-gray-400 dark:text-neutral-500">({visibleValues.length})</span>
                </span>
              </button>
            )}

            {/* Placeholder/reset row — kept ONLY for single-select. In
                multi-select mode it's redundant: no filter already means
                "show everything", and the X icon on the trigger button
                clears any active selection. Removing it removes the
                "All X vs Select all" confusion (both ended up showing the
                same data to the user). */}
            {!multi && !hidePlaceholderRow && (
              <>
                <button
                  type="button"
                  onClick={() => handleSelect('')}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    !hasValue
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700'
                  }`}
                >{placeholder}</button>

                <div className="border-t border-gray-100 dark:border-neutral-700 my-1"></div>
              </>
            )}

            {(() => {
              // Render option rows. Pinned-top rows render OUTSIDE the
              // scrollable middle so they stay visible when the user
              // scrolls a long folder list. Pinned-bottom rows do the
              // same below the scroll area. The middle is height-capped
              // (~5 rows) so the dropdown never grows beyond a sensible
              // size even with hundreds of folders.
              const renderRow = (opt, index) => {
                const optValue = getOptionValue(opt);
                const optState = multi ? getOptionState(optValue) : null;
                const isSelected = multi ? optState !== 'none' : value === optValue;
                const accessory = renderOptionAccessory ? renderOptionAccessory(opt) : null;
                const dividerBefore = opt._dividerBefore;
                return (
                  <div key={optValue} className={`relative ${dividerBefore ? 'mt-1 pt-1 border-t border-gray-100 dark:border-neutral-700' : ''}`}>
                    <button
                      type="button"
                      data-option-item
                      onClick={() => handleSelect(optValue)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full text-left px-3 ${accessory ? 'pr-9' : ''} py-1.5 text-xs transition-colors ${
                        highlightedIndex === index
                          ? 'bg-gray-100 dark:bg-neutral-600'
                          : optState === 'included'
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : optState === 'excluded'
                          ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          : isSelected && !multi
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {multi && (
                          <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                            optState === 'included'
                              ? 'bg-blue-500 border-blue-500'
                              : optState === 'excluded'
                              ? 'bg-red-500 border-red-500'
                              : 'border-gray-300 dark:border-neutral-500'
                          }`}>
                            {optState === 'included' && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {optState === 'excluded' && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M18 12H6" />
                              </svg>
                            )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          {renderOption ? renderOption(opt) : <span className="truncate block">{getOptionLabel(opt)}</span>}
                        </div>
                      </div>
                    </button>
                    {accessory && (
                      <div
                        className="absolute right-1.5 top-1/2 -translate-y-1/2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {accessory}
                      </div>
                    )}
                  </div>
                );
              };

              const pinTop = sortedOptions.filter(o => o._pinTop);
              const pinBottom = sortedOptions.filter(o => o._pinBottom);
              const middle = sortedOptions.filter(o => !o._pinTop && !o._pinBottom);
              const indexOf = (opt) => sortedOptions.indexOf(opt);

              if (sortedOptions.length === 0) {
                return <div className="px-3 py-2 text-sm text-gray-500 dark:text-neutral-400 text-center">No results found</div>;
              }

              return (
                <>
                  {pinTop.length > 0 && (
                    <div>{pinTop.map(o => renderRow(o, indexOf(o)))}</div>
                  )}
                  {middle.length > 0 && (
                    // ~5 rows × ~28px each = ~140px max before scroll kicks in.
                    <div ref={listRef} className="max-h-[140px] overflow-y-auto">
                      {middle.map(o => renderRow(o, indexOf(o)))}
                    </div>
                  )}
                  {pinBottom.length > 0 && (
                    <div>{pinBottom.map(o => renderRow(o, indexOf(o)))}</div>
                  )}
                </>
              );
            })()}

            {footer && (
              <>
                <div className="border-t border-gray-100 dark:border-neutral-700 my-1"></div>
                <div className="px-2 py-1">
                  {/* Footer can be a render function — receives a
                      `close` callback so a footer button (e.g. "Manage
                      Folders") can dismiss the parent dropdown when
                      it opens its own UI. */}
                  {typeof footer === 'function'
                    ? footer({ close: () => { setIsOpen(false); setSearch(''); setHighlightedIndex(-1) } })
                    : footer}
                </div>
              </>
            )}
          </div>
        );
        return usePortal ? createPortal(dropdownContent, document.body) : dropdownContent;
      })()}
    </div>
  );
};

export default MultiSearchableSelect;
