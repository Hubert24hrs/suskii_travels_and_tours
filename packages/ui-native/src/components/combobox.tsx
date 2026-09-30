import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { cn } from '../lib/cn';

import { Input } from './input';

export interface ComboboxProps<T> {
  label: string;
  items: readonly T[];
  itemToString: (item: T | null) => string;
  itemToKey: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedItem: T | null;
  onSelectedItemChange: (item: T | null) => void;
  onInputValueChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  loading?: boolean;
  loadingLabel: string;
  emptyLabel: string;
  error?: string | undefined;
  className?: string;
  /** Test id of the text field; each suggestion gets `{testID}-option-{key}`. */
  testID?: string;
}

/** Text field with a suggestion list (airports, cities). Filtering is the caller's job. */
export function Combobox<T>({
  label,
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
  className,
  testID,
}: ComboboxProps<T>) {
  const [text, setText] = useState(() => itemToString(selectedItem));
  const [open, setOpen] = useState(false);
  const status =
    open && text.length > 0 ? (loading ? loadingLabel : items.length === 0 ? emptyLabel : '') : '';

  return (
    <View className={cn('gap-1', className)}>
      <Input
        testID={testID}
        label={label}
        value={text}
        placeholder={placeholder}
        icon={icon}
        error={error}
        autoCorrect={false}
        onChangeText={(next) => {
          setText(next);
          setOpen(true);
          onInputValueChange(next);
          if (selectedItem !== null) onSelectedItemChange(null);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && items.length > 0 ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          className="max-h-menu rounded-md border border-border bg-surface"
        >
          {items.map((item) => (
            <Pressable
              key={itemToKey(item)}
              testID={testID ? `${testID}-option-${itemToKey(item)}` : undefined}
              accessibilityRole="button"
              accessibilityLabel={itemToString(item)}
              onPress={() => {
                setText(itemToString(item));
                setOpen(false);
                onSelectedItemChange(item);
              }}
              className="px-4 py-3 active:bg-primary-subtle"
            >
              {renderItem ? (
                renderItem(item)
              ) : (
                <Text className="font-body text-body text-foreground">{itemToString(item)}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        className={cn('font-body text-body-sm text-muted', status ? 'px-4 py-3' : 'hidden')}
      >
        {status}
      </Text>
    </View>
  );
}
