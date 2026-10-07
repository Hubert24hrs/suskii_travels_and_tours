'use client';

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn';

import { inputClasses } from './input';

export interface ComboboxProps<T> {
  /** Visible label (required for accessibility). */
  label: string;
  hideLabel?: boolean;
  /** Current suggestions. Filtering (local or API) is the caller's job. */
  items: readonly T[];
  itemToString: (item: T | null) => string;
  itemToKey: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedItem: T | null;
  onSelectedItemChange: (item: T | null) => void;
  /** Called on every keystroke; use it to fetch or filter suggestions. */
  onInputValueChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  loading?: boolean;
  /** Announced while suggestions load, e.g. "Searching airports". */
  loadingLabel: string;
  /** Announced when a search returns nothing, e.g. "No airports found". */
  emptyLabel: string;
  error?: string | undefined;
  id?: string;
  className?: string;
}

/**
 * Autocomplete following the WAI-ARIA 1.2 combobox pattern (list autocomplete, no automatic
 * selection): typing or a click opens the listbox, arrow keys move through options, Enter selects,
 * Escape closes. Loading and empty states go to a live region, never into the listbox (a listbox
 * may only contain options). Written without a library to keep the homepage small (ADR-013); ids
 * follow `{id}-input`, `{id}-menu` and `{id}-item-{index}`.
 */
export function Combobox<T>({
  label,
  hideLabel = false,
  items,
  itemToString,
  itemToKey,
  renderItem,
  selectedItem,
  onSelectedItemChange,
  onInputValueChange,
  placeholder,
  icon,
  loading = false,
  loadingLabel,
  emptyLabel,
  error,
  id,
  className,
}: ComboboxProps<T>) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const inputId = `${baseId}-input`;
  const menuId = `${baseId}-menu`;
  const itemId = (index: number) => `${baseId}-item-${index}`;

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [inputValue, setInputValue] = useState(() => itemToString(selectedItem));
  // A selection made by the caller (or a reset) replaces the text, as a controlled input would.
  const selectedKey = selectedItem === null ? null : itemToKey(selectedItem);
  const [shownKey, setShownKey] = useState(selectedKey);
  if (selectedKey !== shownKey) {
    setShownKey(selectedKey);
    setInputValue(itemToString(selectedItem));
  }

  const showList = isOpen && items.length > 0;
  const active = showList && highlightedIndex >= 0 && highlightedIndex < items.length;

  useEffect(() => {
    if (active)
      document.getElementById(itemId(highlightedIndex))?.scrollIntoView({ block: 'nearest' });
  });

  const select = (item: T) => {
    setInputValue(itemToString(item));
    setShownKey(itemToKey(item));
    setIsOpen(false);
    setHighlightedIndex(-1);
    onSelectedItemChange(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((current) =>
        current < 0 && step < 0 ? count - 1 : (current + step + count) % count,
      );
    } else if (event.key === 'Enter') {
      const item = active ? items[highlightedIndex] : undefined;
      if (item !== undefined) {
        event.preventDefault();
        select(item);
      }
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const errorId = error ? `${baseId}-error` : undefined;
  const status =
    isOpen &&
    inputValue.length > 0 &&
    (loading ? loadingLabel : items.length === 0 ? emptyLabel : '');

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        id={`${baseId}-label`}
        htmlFor={inputId}
        className={cn('font-body text-body-sm font-medium text-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted"
          >
            {icon}
          </span>
        ) : null}
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={menuId}
          aria-activedescendant={active ? itemId(highlightedIndex) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          autoComplete="off"
          placeholder={placeholder}
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
            onInputValueChange(event.target.value);
          }}
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setIsOpen(false);
            setHighlightedIndex(-1);
          }}
          className={cn(inputClasses, icon ? 'pl-12' : undefined)}
        />
        <div
          id={menuId}
          role="listbox"
          aria-labelledby={`${baseId}-label`}
          className={cn(
            'absolute inset-x-0 top-full z-40 mt-1 max-h-menu overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card-hover',
            !showList && 'hidden',
          )}
        >
          {showList
            ? items.map((item, index) => (
                // Options never take focus: the input handles the keyboard (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                <div
                  key={itemToKey(item)}
                  id={itemId(index)}
                  role="option"
                  aria-selected={highlightedIndex === index}
                  // Keep focus in the input while the pointer picks an option.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setHighlightedIndex(index)}
                  onClick={() => select(item)}
                  className={cn(
                    'cursor-pointer px-4 py-3 font-body text-body text-foreground',
                    highlightedIndex === index && 'bg-primary-subtle',
                  )}
                >
                  {renderItem ? renderItem(item) : itemToString(item)}
                </div>
              ))
            : null}
        </div>
        <div
          role="status"
          className={cn(
            status
              ? 'absolute inset-x-0 top-full z-40 mt-1 rounded-md border border-border bg-surface px-4 py-3 font-body text-body-sm text-muted shadow-card-hover'
              : 'sr-only',
          )}
        >
          {status}
        </div>
      </div>
      {error ? (
        <p id={errorId} className="font-body text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
