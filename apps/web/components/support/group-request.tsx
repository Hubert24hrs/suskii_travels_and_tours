'use client';

import { createFormatters } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';
import {
  CABIN_CLASSES,
  GROUP_MAX_TRAVELLERS,
  GROUP_MIN_TRAVELLERS,
  GROUP_NOTES_MAX,
  GROUP_ORGANISATION_MAX,
  type CabinClass,
  type GroupTripType,
} from '@suskii/shared/lite';
import { Button, Card, DateRangePicker, Input, SegmentedControl } from '@suskii/ui-web';
import { PlaneLanding, PlaneTakeoff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { browserApi, problemSlug } from '../../lib/browser-api';
import { loadShared, prefetchShared } from '../../lib/load-shared';
import { hasSession } from '../../lib/session';
import { saveSupportToken } from '../../lib/support-token';
import { useHydrated } from '../../lib/use-hydrated';
import { useTurnstile } from '../account/use-turnstile';
import { dateToIso, isoToDate, localToday, weekStartsOn } from '../search/dates';
import { focusFirstError, toFieldErrors, type FieldErrors } from '../search/issues';
import { NativeSelect } from '../search/native-select';
import { PlaceField } from '../search/place-field';
import type { PlaceOption } from '../search/places';

import type { GroupRequestMessages } from './group-request-messages';
import { SUPPORT_TEXTAREA } from './support-start';

interface State {
  tripType: GroupTripType;
  origin: PlaceOption | null;
  destination: PlaceOption | null;
  departureDate: string;
  returnDate: string;
  travellers: string;
  cabinClass: CabinClass;
  organisation: string;
  notes: string;
  email: string;
}

const EMPTY: State = {
  tripType: 'round_trip',
  origin: null,
  destination: null,
  departureDate: '',
  returnDate: '',
  travellers: '',
  cabinClass: 'economy',
  organisation: '',
  notes: '',
  email: '',
};

const NO_RECENT: readonly PlaceOption[] = [];

/**
 * A flight for ten travellers or more (ADR-093). Airlines price groups through their group
 * desks, so this is a request the team answers, not a search: it starts a support conversation
 * and opens it. Visitors without a session give an email and pass Turnstile, as on the support
 * page.
 */
export function GroupRequest({
  apiBaseUrl,
  locale,
  turnstileSiteKey,
}: {
  apiBaseUrl: string;
  locale: string;
  turnstileSiteKey: string;
}) {
  const { t } = useTranslator<GroupRequestMessages>();
  const router = useRouter();
  const signedIn = useHydrated() && hasSession();
  const notesId = useId();
  const format = useMemo(() => createFormatters(locale), [locale]);
  const today = useMemo(() => localToday(), []);
  const [state, setState] = useState<State>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    containerRef: turnstileRef,
    ensure: ensureHuman,
    reset: resetTurnstile,
    currentToken,
  } = useTurnstile(turnstileSiteKey, 'support', () => setFormError(t('support.errors.generic')));

  const update = (patch: Partial<State>) => setState((current) => ({ ...current, ...patch }));
  // First touch: the schemas start loading, and visitors without a session get the bot check.
  const prepare = () => {
    prefetchShared();
    if (!signedIn) ensureHuman();
  };

  const formatRange = ({ from, to }: { from?: Date | undefined; to?: Date | undefined }) => {
    if (!from) return undefined;
    const start = format.date(dateToIso(from), 'weekday');
    return to ? `${start} - ${format.date(dateToIso(to), 'weekday')}` : start;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const shared = await loadShared();
      const roundTrip = state.tripType === 'round_trip';
      const input = {
        tripType: state.tripType,
        origin: state.origin?.code ?? '',
        destination: state.destination?.code ?? '',
        departureDate: state.departureDate,
        returnDate: roundTrip && state.returnDate !== '' ? state.returnDate : null,
        // The schema takes a whole number; anything else is reported on the field.
        travellers: /^\d+$/.test(state.travellers.trim()) ? Number(state.travellers) : null,
        cabinClass: state.cabinClass,
        organisation: state.organisation,
        notes: state.notes,
        email: signedIn || state.email.trim() === '' ? null : state.email.trim(),
      };
      const result = shared.groupRequestSchema.safeParse(input);
      const found = result.success ? {} : toFieldErrors(result.error.issues, input, t);
      if (found.travellers)
        found.travellers = t('groups.errors.travellers', {
          min: GROUP_MIN_TRAVELLERS,
          max: GROUP_MAX_TRAVELLERS,
        });
      if (!signedIn && input.email === null) found.email = t('search.issues.required');
      // Return-date problems are shown on the shared date-range field.
      if (found.returnDate && !found.departureDate) found.departureDate = found.returnDate;
      setErrors(found);
      if (!result.success || Object.keys(found).length > 0) {
        focusFirstError(found, 'group');
        return;
      }
      const turnstileToken = signedIn ? null : currentToken();
      if (!signedIn && !turnstileToken) {
        ensureHuman();
        setFormError(t('support.errors.generic'));
        return;
      }
      const { data, error: problem } = await browserApi().POST('/v1/flights/group-requests', {
        body: { ...result.data, turnstileToken },
      });
      if (data) {
        if (data.accessToken) saveSupportToken(data.conversation.id, data.accessToken);
        router.push(`/support/${data.conversation.id}`);
        return;
      }
      resetTurnstile();
      setFormError(
        problemSlug(problem) === 'support-limit'
          ? t('support.errors.limit')
          : t('support.errors.generic'),
      );
    } catch {
      setFormError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const roundTrip = state.tripType === 'round_trip';
  return (
    <Card className="flex flex-col gap-4 p-6" data-testid="group-request">
      <form
        method="post"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
        onFocusCapture={prepare}
        onPointerDownCapture={prepare}
      >
        <SegmentedControl<GroupTripType>
          label={t('groups.tripType')}
          value={state.tripType}
          onValueChange={(tripType) => update({ tripType })}
          options={[
            { value: 'round_trip', label: t('groups.roundTrip') },
            { value: 'one_way', label: t('groups.oneWay') },
          ]}
          className="self-start"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <PlaceField
            id="group-origin"
            label={t('groups.from')}
            value={state.origin}
            onChange={(origin) => update({ origin })}
            recent={NO_RECENT}
            apiBaseUrl={apiBaseUrl}
            locale={locale}
            icon={<PlaneTakeoff className="size-5" />}
            error={errors.origin}
          />
          <PlaceField
            id="group-destination"
            label={t('groups.to')}
            value={state.destination}
            onChange={(destination) => update({ destination })}
            recent={NO_RECENT}
            apiBaseUrl={apiBaseUrl}
            locale={locale}
            icon={<PlaneLanding className="size-5" />}
            error={errors.destination}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DateRangePicker
            id="group-departureDate"
            mode={roundTrip ? 'range' : 'single'}
            label={roundTrip ? t('search.flights.dates') : t('groups.departure')}
            placeholder={
              roundTrip ? t('search.flights.datesPlaceholder') : t('search.flights.datePlaceholder')
            }
            value={{ from: isoToDate(state.departureDate), to: isoToDate(state.returnDate) }}
            onChange={({ from, to }) =>
              update({ departureDate: dateToIso(from), returnDate: dateToIso(to) })
            }
            formatValue={formatRange}
            minDate={today}
            weekStartsOn={weekStartsOn(locale)}
            labels={{
              done: t('search.datePicker.done'),
              close: t('search.datePicker.close'),
              previousMonth: t('search.datePicker.previousMonth'),
              nextMonth: t('search.datePicker.nextMonth'),
              today: t('search.datePicker.today'),
              selected: t('search.datePicker.selected'),
            }}
            error={errors.departureDate}
          />
          <Input
            id="group-travellers"
            label={t('groups.travellers')}
            hint={t('groups.travellersHint', {
              min: GROUP_MIN_TRAVELLERS,
              max: GROUP_MAX_TRAVELLERS,
            })}
            inputMode="numeric"
            autoComplete="off"
            value={state.travellers}
            onChange={(event) => update({ travellers: event.target.value })}
            error={errors.travellers}
            data-testid="group-travellers"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <NativeSelect
            id="group-cabinClass"
            label={t('groups.cabin')}
            value={state.cabinClass}
            onChange={(event) => update({ cabinClass: event.target.value as CabinClass })}
            options={CABIN_CLASSES.map((cabin) => ({ value: cabin, label: t(`cabins.${cabin}`) }))}
          />
          <Input
            id="group-organisation"
            label={t('groups.organisation')}
            autoComplete="organization"
            maxLength={GROUP_ORGANISATION_MAX}
            value={state.organisation}
            onChange={(event) => update({ organisation: event.target.value })}
            error={errors.organisation}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={notesId} className="font-body text-body-sm font-medium text-foreground">
            {t('groups.notes')}
          </label>
          <textarea
            id={notesId}
            name="notes"
            value={state.notes}
            maxLength={GROUP_NOTES_MAX}
            aria-describedby={`${notesId}-hint`}
            onChange={(event) => update({ notes: event.target.value })}
            className={SUPPORT_TEXTAREA}
            data-testid="group-notes"
          />
          <p id={`${notesId}-hint`} className="font-body text-body-sm text-muted">
            {t('groups.notesHint')}
          </p>
        </div>
        {signedIn ? null : (
          <Input
            id="group-email"
            label={t('groups.email')}
            hint={t('groups.emailHint')}
            type="email"
            autoComplete="email"
            value={state.email}
            onChange={(event) => update({ email: event.target.value })}
            error={errors.email}
            data-testid="group-email"
          />
        )}
        <div ref={turnstileRef} />
        <p role="alert" className="font-body text-body-sm text-danger empty:hidden">
          {formError ?? (Object.keys(errors).length > 0 ? t('search.issues.summary') : '')}
        </p>
        <Button type="submit" loading={busy} className="self-start" data-testid="group-submit">
          {t('groups.submit')}
        </Button>
      </form>
    </Card>
  );
}
