import { color } from '@suskii/design-tokens';
import {
  MAX_ADULTS_PER_ROOM,
  MAX_CHILD_AGE,
  MAX_CHILDREN_PER_ROOM,
  MAX_HOTEL_ROOMS,
  type HotelRoomDraft,
} from '@suskii/shared';
import { Button, FieldButton, Sheet, iconSize } from '@suskii/ui-native';
import { BedDouble, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  decrementLabel,
  incrementLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const button = (enabled: boolean, next: number, accessibilityLabel: string, plus: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => onChange(next)}
      className="size-12 items-center justify-center rounded-pill border border-border-strong"
    >
      {plus ? (
        <Plus color={enabled ? color.primary : color.muted} size={iconSize.sm} />
      ) : (
        <Minus color={enabled ? color.primary : color.muted} size={iconSize.sm} />
      )}
    </Pressable>
  );
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-body text-body text-foreground">{label}</Text>
      <View className="flex-row items-center gap-3">
        {button(value > min, value - 1, decrementLabel, false)}
        <Text
          accessibilityLiveRegion="polite"
          className="w-6 text-center font-body-bold text-body text-foreground"
        >
          {value}
        </Text>
        {button(value < max, value + 1, incrementLabel, true)}
      </View>
    </View>
  );
}

/** Rooms with adults and children's ages (ages decide hotel prices and bed rules). */
export function RoomsPicker({
  rooms,
  onChange,
}: {
  rooms: HotelRoomDraft[];
  onChange: (rooms: HotelRoomDraft[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const guests = rooms.reduce((sum, room) => sum + room.adults + room.childAges.length, 0);
  const setRoom = (index: number, patch: Partial<HotelRoomDraft>) =>
    onChange(rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)));

  return (
    <View>
      <FieldButton
        label={t('search.hotels.rooms')}
        value={`${t('search.hotels.roomsCount', { count: rooms.length })}, ${t('search.hotels.guestsCount', { count: guests })}`}
        icon={<BedDouble color={color.muted} size={iconSize.md} />}
        onPress={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('search.hotels.rooms')}
        closeLabel={t('common.close')}
        snapPoints={['85%']}
        footer={
          <Button fullWidth onPress={() => setOpen(false)}>
            {t('common.done')}
          </Button>
        }
      >
        {rooms.map((room, index) => (
          <View key={index} className="gap-3 border-b border-border py-3">
            <View className="flex-row items-center justify-between">
              <Text accessibilityRole="header" className="font-heading text-body text-heading">
                {t('search.hotels.room', { number: index + 1 })}
              </Text>
              {rooms.length > 1 ? (
                <Button
                  variant="ghost"
                  onPress={() => onChange(rooms.filter((_, i) => i !== index))}
                >
                  {t('search.hotels.removeRoom', { number: index + 1 })}
                </Button>
              ) : null}
            </View>
            <Stepper
              label={t('search.hotels.adults')}
              value={room.adults}
              min={1}
              max={MAX_ADULTS_PER_ROOM}
              onChange={(adults) => setRoom(index, { adults })}
              decrementLabel={t('search.travellers.removeAdult')}
              incrementLabel={t('search.travellers.addAdult')}
            />
            <Stepper
              label={t('search.hotels.children')}
              value={room.childAges.length}
              min={0}
              max={MAX_CHILDREN_PER_ROOM}
              onChange={(count) =>
                setRoom(index, {
                  childAges:
                    count > room.childAges.length
                      ? [...room.childAges, 8]
                      : room.childAges.slice(0, count),
                })
              }
              decrementLabel={t('search.travellers.removeChild')}
              incrementLabel={t('search.travellers.addChild')}
            />
            {room.childAges.map((age, child) => (
              <View key={child} className="gap-2">
                <Text className="font-body-medium text-body-sm text-foreground">
                  {t('search.hotels.childAge', { number: child + 1 })}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {Array.from({ length: MAX_CHILD_AGE + 1 }, (_, value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: value === age }}
                        accessibilityLabel={
                          value === 0
                            ? t('search.hotels.childAgeUnder1')
                            : t('search.hotels.childAgeOption', { count: value })
                        }
                        onPress={() =>
                          setRoom(index, {
                            childAges: room.childAges.map((current, i) =>
                              i === child ? value : current,
                            ),
                          })
                        }
                        className={
                          value === age
                            ? 'min-h-12 min-w-12 items-center justify-center rounded-pill bg-primary px-3'
                            : 'min-h-12 min-w-12 items-center justify-center rounded-pill border border-border-strong px-3'
                        }
                      >
                        <Text
                          className={
                            value === age
                              ? 'font-body-bold text-body-sm text-on-primary'
                              : 'font-body text-body-sm text-foreground'
                          }
                        >
                          {value === 0 ? '<1' : value}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ))}
          </View>
        ))}
        {rooms.length < MAX_HOTEL_ROOMS ? (
          <Button
            variant="ghost"
            onPress={() => onChange([...rooms, { adults: 1, childAges: [] }])}
          >
            {t('search.hotels.addRoom')}
          </Button>
        ) : null}
      </Sheet>
    </View>
  );
}
