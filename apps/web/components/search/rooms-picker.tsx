'use client';

import {
  MAX_ADULTS_PER_ROOM,
  MAX_CHILDREN_PER_ROOM,
  MAX_CHILD_AGE,
  MAX_HOTEL_ROOMS,
  type HotelRoomDraft,
} from '@suskii/shared';
import {
  Button,
  FieldButton,
  FieldLabel,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@suskii/ui-web';
import { BedDouble, Plus } from 'lucide-react';
import { useId } from 'react';

import { Stepper } from './stepper';
import { useSearchT } from './use-search-t';

export interface RoomsPickerProps {
  id: string;
  value: HotelRoomDraft[];
  onChange: (rooms: HotelRoomDraft[]) => void;
  error?: string | undefined;
}

/** Rooms (1-8), each with adults and children; every child needs an age (hotel pricing rule). */
export function RoomsPicker({ id, value, onChange, error }: RoomsPickerProps) {
  const { t } = useSearchT();
  const labelId = useId();
  const guests = value.reduce((sum, room) => sum + room.adults + room.childAges.length, 0);
  const summary = `${t('search.hotels.roomsCount', { count: value.length })}, ${t('search.hotels.guestsCount', { count: guests })}`;
  const setRoom = (index: number, room: HotelRoomDraft) =>
    onChange(value.map((current, position) => (position === index ? room : current)));
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel id={labelId}>{t('search.hotels.rooms')}</FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <FieldButton
            id={id}
            labelId={labelId}
            value={summary}
            icon={<BedDouble className="size-5" />}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={error ? 'border-danger' : undefined}
          />
        </PopoverTrigger>
        <PopoverContent
          aria-label={t('search.hotels.rooms')}
          className="flex max-h-menu flex-col gap-4 overflow-y-auto"
        >
          {value.map((room, index) => (
            <fieldset key={index} className="flex flex-col gap-3 border-b border-border pb-4">
              <legend className="font-heading text-body font-bold text-heading">
                {t('search.hotels.room', { number: index + 1 })}
              </legend>
              <Stepper
                label={t('search.hotels.adults')}
                value={room.adults}
                min={1}
                max={MAX_ADULTS_PER_ROOM}
                onChange={(adults) => setRoom(index, { ...room, adults })}
                incrementLabel={`${t('search.travellers.addAdult')} (${t('search.hotels.room', { number: index + 1 })})`}
                decrementLabel={`${t('search.travellers.removeAdult')} (${t('search.hotels.room', { number: index + 1 })})`}
              />
              <Stepper
                label={t('search.hotels.children')}
                value={room.childAges.length}
                min={0}
                max={MAX_CHILDREN_PER_ROOM}
                onChange={(count) =>
                  setRoom(index, {
                    ...room,
                    childAges:
                      count > room.childAges.length
                        ? [...room.childAges, 8]
                        : room.childAges.slice(0, count),
                  })
                }
                incrementLabel={`${t('search.travellers.addChild')} (${t('search.hotels.room', { number: index + 1 })})`}
                decrementLabel={`${t('search.travellers.removeChild')} (${t('search.hotels.room', { number: index + 1 })})`}
              />
              {room.childAges.map((age, child) => (
                <label
                  key={child}
                  className="flex items-center justify-between gap-4 font-body text-body-sm text-foreground"
                >
                  {t('search.hotels.childAge', { number: child + 1 })}
                  <select
                    value={age}
                    onChange={(event) =>
                      setRoom(index, {
                        ...room,
                        childAges: room.childAges.map((current, position) =>
                          position === child ? Number(event.target.value) : current,
                        ),
                      })
                    }
                    className="h-12 rounded-md border border-border-strong bg-surface px-3 font-body text-body-sm focus-visible:focus-ring"
                  >
                    {Array.from({ length: MAX_CHILD_AGE + 1 }, (_, years) => (
                      <option key={years} value={years}>
                        {years === 0
                          ? t('search.hotels.childAgeUnder1')
                          : t('search.hotels.childAgeOption', { count: years })}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {value.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start px-3"
                  onClick={() => onChange(value.filter((_, position) => position !== index))}
                >
                  {t('search.hotels.removeRoom', { number: index + 1 })}
                </Button>
              ) : null}
            </fieldset>
          ))}
          <div className="flex items-center justify-between gap-2">
            {value.length < MAX_HOTEL_ROOMS ? (
              <Button
                type="button"
                variant="ghost"
                className="px-3"
                onClick={() => onChange([...value, { adults: 2, childAges: [] }])}
              >
                <Plus aria-hidden="true" className="size-5" />
                {t('search.hotels.addRoom')}
              </Button>
            ) : (
              <span />
            )}
            <PopoverClose asChild>
              <Button type="button">{t('search.travellers.done')}</Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="font-body text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
