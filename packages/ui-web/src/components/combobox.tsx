'use client';

import { useCombobox } from 'downshift';
import type { ReactNode } from 'react';

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
 * Autocomplete following the WAI-ARIA 1.2 combobox pattern (downshift): arrow keys move through
 * options, Enter selects, Escape closes. Loading and empty states go to a live region, never into
 * the listbox (a listbox may only contain options).
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
  const {
    isOpen,
    highlightedIndex,
    inputValue,
    getLabelProps,
    getInputProps,
    getMenuProps,
    getItemProps,
  } = useCombobox<T>({
    items: [...items],
    itemToString,
    itemToKey: (item) => (item === null ? null : itemToKey(item)),
    selectedItem,
    onSelectedItemChange: ({ selectedItem: next }) => onSelectedItemChange(next ?? null),
    onInputValueChange: ({ inputValue: next }) => onInputValueChange(next),
    ...(id === undefined ? {} : { id }),
  });

  const errorId = error ? `${id ?? 'combobox'}-error` : undefined;
  const showList = isOpen && items.length > 0;
  const status =
    isOpen &&
    inputValue.length > 0 &&
    (loading ? loadingLabel : items.length === 0 ? emptyLabel : '');

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        {...getLabelProps()}
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
          {...getInputProps({
            placeholder,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': errorId,
          })}
          className={cn(inputClasses, icon ? 'pl-12' : undefined)}
        />
        <ul
          {...getMenuProps()}
          className={cn(
            'absolute inset-x-0 top-full z-40 mt-1 max-h-menu overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card-hover',
            !showList && 'hidden',
          )}
        >
          {showList
            ? items.map((item, index) => (
                <li
                  key={itemToKey(item)}
                  {...getItemProps({ item, index })}
                  className={cn(
                    'cursor-pointer px-4 py-3 font-body text-body text-foreground',
                    highlightedIndex === index && 'bg-primary-subtle',
                  )}
                >
                  {renderItem ? renderItem(item) : itemToString(item)}
                </li>
              ))
            : null}
        </ul>
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
