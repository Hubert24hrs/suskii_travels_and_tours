import {
  TRAVELLER_TYPES,
  canDecrement,
  canIncrement,
  stepTravellers,
  type TravellerCounts,
  type TravellerType,
} from '@suskii/shared';
import { color } from '@suskii/design-tokens';
import { Minus, Plus, Users } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';
import { iconSize } from '../lib/icon';

import { Button } from './button';
import { FieldButton } from './field-button';
import { Sheet } from './sheet';

export interface PassengerPickerLabels {
  types: Record<TravellerType, { title: string; description: string }>;
  increment: Record<TravellerType, string>;
  decrement: Record<TravellerType, string>;
  done: string;
  close: string;
}

export interface PassengerPickerProps {
  label: string;
  summary: string;
  value: TravellerCounts;
  onChange: (value: TravellerCounts) => void;
  labels: PassengerPickerLabels;
  className?: string;
}

function StepButton({
  label,
  enabled,
  onPress,
  children,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      className={cn(
        'size-12 items-center justify-center rounded-pill border',
        enabled ? 'border-border-strong active:bg-primary-subtle' : 'border-border',
      )}
    >
      {children}
    </Pressable>
  );
}

/** Adults / children / infants steppers in a bottom sheet, enforcing the shared traveller rules. */
export function PassengerPicker({
  label,
  summary,
  value,
  onChange,
  labels,
  className,
}: PassengerPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <View className={className}>
      <FieldButton
        label={label}
        value={summary}
        icon={<Users color={color.muted} size={iconSize.md} />}
        onPress={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        closeLabel={labels.close}
        footer={
          <Button fullWidth onPress={() => setOpen(false)}>
            {labels.done}
          </Button>
        }
      >
        {TRAVELLER_TYPES.map((type) => {
          const canAdd = canIncrement(value, type);
          const canRemove = canDecrement(value, type);
          return (
            <View
              key={type}
              className="flex-row items-center justify-between gap-4 border-b border-border py-3"
            >
              <View className="flex-1">
                <Text className="font-body-bold text-body text-foreground">
                  {labels.types[type].title}
                </Text>
                <Text className="font-body text-body-sm text-muted">
                  {labels.types[type].description}
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <StepButton
                  label={labels.decrement[type]}
                  enabled={canRemove}
                  onPress={() => onChange(stepTravellers(value, type, -1))}
                >
                  <Minus color={canRemove ? color.primary : color.muted} size={iconSize.md} />
                </StepButton>
                <Text
                  accessibilityLabel={`${labels.types[type].title}: ${value[type]}`}
                  accessibilityLiveRegion="polite"
                  className="w-6 text-center font-body-bold text-body text-foreground"
                >
                  {value[type]}
                </Text>
                <StepButton
                  label={labels.increment[type]}
                  enabled={canAdd}
                  onPress={() => onChange(stepTravellers(value, type, 1))}
                >
                  <Plus color={canAdd ? color.primary : color.muted} size={iconSize.md} />
                </StepButton>
              </View>
            </View>
          );
        })}
      </Sheet>
    </View>
  );
}
