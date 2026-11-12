'use client';

import { useFormatters } from '@suskii/i18n/react';
import {
  APPROVAL_MODES,
  APPROVAL_REJECT_REASONS,
  CABIN_CLASSES,
  canApprove,
  canManageCompany as canManage,
  COMPANY_ROLES,
  seesCompanyWallet,
  SUPPORTED_CURRENCIES,
  type ApprovalRejectReason,
  type CompanyRole,
} from '@suskii/shared/lite';
import { Badge, Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine, useAccountUser } from './account-shell';
import { CompanyWallet } from './company-wallet';
import { decimalToMinor, minorToDecimal } from './decimal-money';

type Company = Schemas['Company'];
type Members = Schemas['CompanyMembers'];
type Trip = Schemas['CompanyBooking'];
interface Country {
  code: string;
  name: string;
}
interface CompanyInput {
  name: string;
  countryCode: string;
  registrationNumber: string;
  taxId: string;
  billingEmail: string;
}

/**
 * The account's company (ADR-078): create one, or manage it by role. Admins edit the details,
 * the travel policy and the members; admins and approvers decide on waiting trips and see the
 * company wallet and the spend; everyone sees the company trips they may see.
 */
export function CompanySection({ countries }: { countries: readonly Country[] }) {
  const [company, setCompany] = useState<Company | null | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company')
      .then(({ data }) => {
        if (!cancelled && data) setCompany(data.company);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (company === undefined) return null;
  if (company === null) {
    return <CreateCompany countries={countries} onCreated={setCompany} />;
  }
  const reload = () => setVersion((value) => value + 1);
  return (
    <>
      <CompanyDetails company={company} countries={countries} onSaved={setCompany} />
      <PolicyCard company={company} onSaved={setCompany} />
      {canApprove(company.myRole) ? <ApprovalsCard onDecided={reload} key={version} /> : null}
      {seesCompanyWallet(company.myRole) ? <CompanyWallet /> : null}
      <MembersCard company={company} onLeft={() => setCompany(null)} />
      <TripsCard key={`trips-${version}`} />
      {canApprove(company.myRole) ? <SpendCard /> : null}
    </>
  );
}

function CompanyFields({
  value,
  countries,
  onChange,
}: {
  value: CompanyInput;
  countries: readonly Country[];
  onChange: (patch: Partial<CompanyInput>) => void;
}) {
  const { t } = useAccountT();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input
        id="company-name"
        label={t('account.company.name')}
        autoComplete="organization"
        maxLength={120}
        value={value.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <NativeSelect
        id="company-country"
        label={t('account.company.country')}
        value={value.countryCode}
        onChange={(event) => onChange({ countryCode: event.target.value })}
        options={countries.map((country) => ({ value: country.code, label: country.name }))}
      />
      <Input
        id="company-registration"
        label={t('account.company.registrationNumber')}
        maxLength={40}
        value={value.registrationNumber ?? ''}
        onChange={(event) => onChange({ registrationNumber: event.target.value })}
      />
      <Input
        id="company-tax-id"
        label={t('account.company.taxId')}
        maxLength={40}
        value={value.taxId ?? ''}
        onChange={(event) => onChange({ taxId: event.target.value })}
      />
      <Input
        id="company-billing-email"
        type="email"
        autoComplete="email"
        label={t('account.company.billingEmail')}
        value={value.billingEmail}
        onChange={(event) => onChange({ billingEmail: event.target.value })}
      />
    </div>
  );
}

function CreateCompany({
  countries,
  onCreated,
}: {
  countries: readonly Country[];
  onCreated: (company: Company) => void;
}) {
  const { t } = useAccountT();
  const [value, setValue] = useState<CompanyInput>({
    name: '',
    countryCode: countries.some((country) => country.code === 'NG')
      ? 'NG'
      : (countries[0]?.code ?? 'NG'),
    registrationNumber: '',
    taxId: '',
    billingEmail: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await browserApi().POST('/v1/me/company', { body: value });
      if (data) onCreated(data);
      else setError(t('account.company.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountCard
      heading={t('account.company.heading')}
      intro={t('account.company.none')}
      testId="company-create"
    >
      <form
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <h3 className="font-heading text-body font-bold text-heading">
          {t('account.company.createHeading')}
        </h3>
        <CompanyFields
          value={value}
          countries={countries}
          onChange={(patch) => setValue({ ...value, ...patch })}
        />
        <div>
          <Button type="submit" loading={busy}>
            {t('account.company.create')}
          </Button>
        </div>
        <ErrorLine message={error} />
      </form>
    </AccountCard>
  );
}

function CompanyDetails({
  company,
  countries,
  onSaved,
}: {
  company: Company;
  countries: readonly Country[];
  onSaved: (company: Company) => void;
}) {
  const { t } = useAccountT();
  const format = useFormatters();
  const [value, setValue] = useState<CompanyInput>({
    name: company.name,
    countryCode: company.countryCode,
    registrationNumber: company.registrationNumber ?? '',
    taxId: company.taxId ?? '',
    billingEmail: company.billingEmail,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const role = t(`account.company.roles.${company.myRole}`);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const { data } = await browserApi().PUT('/v1/me/company', { body: value });
      if (data) {
        onSaved(data);
        setStatus(t('account.company.saved'));
      } else setError(t('account.company.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountCard heading={company.name} intro={t('account.company.intro')} testId="company-details">
      <p className="font-body text-body-sm text-foreground" data-testid="company-role">
        {t('account.company.yourRole', { role })}
      </p>
      {company.status === 'suspended' ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {t('account.company.suspended')}
        </p>
      ) : null}
      {canManage(company.myRole) ? (
        <form
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <CompanyFields
            value={value}
            countries={countries}
            onChange={(patch) => setValue({ ...value, ...patch })}
          />
          <div>
            <Button type="submit" variant="secondary" loading={busy}>
              {t('account.company.save')}
            </Button>
          </div>
          <StatusLine message={status} />
          <ErrorLine message={error} />
        </form>
      ) : (
        <p className="font-body text-body-sm text-muted">
          {format.country(company.countryCode)} · {company.billingEmail}
        </p>
      )}
    </AccountCard>
  );
}

function PolicyCard({ company, onSaved }: { company: Company; onSaved: (c: Company) => void }) {
  const { t } = useAccountT();
  const format = useFormatters();
  const policy = company.policy;
  const [currency, setCurrency] = useState(policy.hotelNightlyCap?.currency ?? 'NGN');
  const [cap, setCap] = useState(
    policy.hotelNightlyCap
      ? minorToDecimal(policy.hotelNightlyCap.amountMinor, policy.hotelNightlyCap.currency)
      : '',
  );
  const [maxCabin, setMaxCabin] = useState(policy.maxCabin ?? '');
  const [days, setDays] = useState(policy.minAdvanceDays?.toString() ?? '');
  const [mode, setMode] = useState(policy.approvalMode);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = canManage(company.myRole);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setError(null);
    const capMinor = cap.trim() ? decimalToMinor(cap, currency) : null;
    const advance = days.trim() ? Number(days) : null;
    if (
      (cap.trim() && capMinor === null) ||
      (advance !== null && (!Number.isInteger(advance) || advance < 0 || advance > 365))
    ) {
      setError(t('account.company.error'));
      return;
    }
    setBusy(true);
    try {
      const { data } = await browserApi().PUT('/v1/me/company/policy', {
        body: {
          hotelNightlyCap: capMinor === null ? null : { amountMinor: capMinor, currency },
          maxCabin: maxCabin === '' ? null : (maxCabin as (typeof CABIN_CLASSES)[number]),
          minAdvanceDays: advance,
          approvalMode: mode,
        },
      });
      if (data) {
        onSaved(data);
        setStatus(t('account.company.saved'));
      } else setError(t('account.company.error'));
    } finally {
      setBusy(false);
    }
  };

  const noLimit = t('account.company.policy.noLimit');
  if (!editable) {
    return (
      <AccountCard
        heading={t('account.company.policy.heading')}
        intro={t('account.company.policy.intro')}
        testId="company-policy"
      >
        <dl className="grid gap-3 md:grid-cols-2">
          {(
            [
              [
                t('account.company.policy.hotelCap'),
                policy.hotelNightlyCap ? format.money(policy.hotelNightlyCap) : noLimit,
              ],
              [
                t('account.company.policy.maxCabin'),
                policy.maxCabin ? t(`cabins.${policy.maxCabin}`) : noLimit,
              ],
              [
                t('account.company.policy.minAdvanceDays'),
                policy.minAdvanceDays === null ? noLimit : format.number(policy.minAdvanceDays),
              ],
              [
                t('account.company.policy.approvalMode'),
                t(`account.company.policy.modes.${policy.approvalMode}`),
              ],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="font-body text-caption text-muted">{label}</dt>
              <dd className="font-body text-body text-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      heading={t('account.company.policy.heading')}
      intro={t('account.company.policy.intro')}
      testId="company-policy"
    >
      <form
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="policy-hotel-cap"
            inputMode="decimal"
            label={t('account.company.policy.hotelCap')}
            placeholder={noLimit}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
          <NativeSelect
            id="policy-currency"
            label={t('account.company.policy.currency')}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
          <NativeSelect
            id="policy-max-cabin"
            label={t('account.company.policy.maxCabin')}
            value={maxCabin}
            onChange={(event) => setMaxCabin(event.target.value)}
            options={[
              { value: '', label: noLimit },
              ...CABIN_CLASSES.map((cabin) => ({ value: cabin, label: t(`cabins.${cabin}`) })),
            ]}
          />
          <Input
            id="policy-advance-days"
            inputMode="numeric"
            label={t('account.company.policy.minAdvanceDays')}
            placeholder={noLimit}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
          <NativeSelect
            id="policy-approval"
            label={t('account.company.policy.approvalMode')}
            value={mode}
            onChange={(event) => setMode(event.target.value as Company['policy']['approvalMode'])}
            options={APPROVAL_MODES.map((value) => ({
              value,
              label: t(`account.company.policy.modes.${value}`),
            }))}
          />
        </div>
        <div>
          <Button type="submit" variant="secondary" loading={busy}>
            {t('account.company.save')}
          </Button>
        </div>
        <StatusLine message={status} />
        <ErrorLine message={error} />
      </form>
    </AccountCard>
  );
}

function MembersCard({ company, onLeft }: { company: Company; onLeft: () => void }) {
  const { t } = useAccountT();
  const format = useFormatters();
  const { user } = useAccountUser();
  const [members, setMembers] = useState<Members | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyRole>('traveller');
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = canManage(company.myRole);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company/members')
      .then(({ data }) => {
        if (!cancelled && data) setMembers(data);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!members) return null;

  const problem = (body: unknown): string =>
    typeof body === 'object' &&
    body !== null &&
    String((body as { type?: unknown }).type).endsWith('company-last-admin')
      ? t('account.company.members.lastAdmin')
      : t('account.company.error');

  const changeRole = async (memberId: string, next: CompanyRole) => {
    setStatus(null);
    setError(null);
    const { data, error: failure } = await browserApi().PUT(
      '/v1/me/company/members/{memberId}/role',
      {
        params: { path: { memberId } },
        body: { role: next },
      },
    );
    if (data) setMembers(data);
    else setError(problem(failure));
  };

  const remove = async (memberId: string, self: boolean) => {
    setStatus(null);
    setError(null);
    const { response, error: failure } = await browserApi().DELETE(
      '/v1/me/company/members/{memberId}',
      { params: { path: { memberId } } },
    );
    if (!response.ok) setError(problem(failure));
    else if (self) onLeft();
    else setVersion((value) => value + 1);
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setError(null);
    const { data } = await browserApi().POST('/v1/me/company/invitations', {
      body: { email: email.trim(), role },
    });
    if (data) {
      setEmail('');
      setStatus(t('account.company.members.invited'));
      setVersion((value) => value + 1);
    } else setError(t('account.company.error'));
  };

  const withdraw = async (invitationId: string) => {
    const { response } = await browserApi().DELETE('/v1/me/company/invitations/{invitationId}', {
      params: { path: { invitationId } },
    });
    if (response.ok) setVersion((value) => value + 1);
  };

  const roleOptions = COMPANY_ROLES.map((value) => ({
    value,
    label: t(`account.company.roles.${value}`),
  }));

  return (
    <AccountCard heading={t('account.company.members.heading')} testId="company-members">
      <ul className="flex flex-col divide-y divide-border">
        {members.members.map((member) => {
          const name = member.name ?? member.email ?? t('account.company.members.noName');
          const self = member.userId === user.id;
          return (
            <li
              key={member.id}
              className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
              data-testid={`company-member-${member.id}`}
            >
              <div className="flex flex-col gap-1">
                <p className="font-body text-body font-bold text-foreground">
                  {self ? t('account.company.members.you', { name }) : name}
                </p>
                {member.email && member.name ? (
                  <p className="font-body text-body-sm text-muted">{member.email}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {admin ? (
                  <NativeSelect
                    id={`member-role-${member.id}`}
                    label={t('account.company.members.role', { name })}
                    value={member.role}
                    onChange={(event) =>
                      void changeRole(member.id, event.target.value as CompanyRole)
                    }
                    options={roleOptions}
                  />
                ) : (
                  <Badge variant="neutral">{t(`account.company.roles.${member.role}`)}</Badge>
                )}
                {self ? (
                  <Button variant="ghost" onClick={() => void remove(member.id, true)}>
                    {t('account.company.members.leave')}
                  </Button>
                ) : admin ? (
                  <Button
                    variant="ghost"
                    aria-label={t('account.company.members.remove', { name })}
                    onClick={() => void remove(member.id, false)}
                  >
                    {t('account.remove')}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {admin ? (
        <>
          {members.invitations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-heading text-body font-bold text-heading">
                {t('account.company.members.pending')}
              </h3>
              <ul className="flex flex-col gap-2">
                {members.invitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center justify-between gap-3">
                    <span className="font-body text-body-sm text-foreground">
                      {t('account.company.members.pendingLine', {
                        email: invitation.emailHint,
                        role: t(`account.company.roles.${invitation.role}`),
                        date: format.date(invitation.expiresAt.slice(0, 10)),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      aria-label={t('account.company.members.withdraw', {
                        email: invitation.emailHint,
                      })}
                      onClick={() => void withdraw(invitation.id)}
                    >
                      {t('account.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <form
            method="post"
            noValidate
            onSubmit={(event) => void invite(event)}
            className="flex flex-col gap-3"
          >
            <h3 className="font-heading text-body font-bold text-heading">
              {t('account.company.members.inviteHeading')}
            </h3>
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                label={t('account.company.members.email')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <NativeSelect
                id="invite-role"
                label={t('account.company.members.inviteRole')}
                value={role}
                onChange={(event) => setRole(event.target.value as CompanyRole)}
                options={roleOptions}
              />
              <Button type="submit">{t('account.company.members.invite')}</Button>
            </div>
          </form>
        </>
      ) : null}
      <StatusLine message={status} />
      <ErrorLine message={error} />
    </AccountCard>
  );
}

/** What a company trip is: the route, the hotel or the product. */
function tripTitle(trip: Trip): string {
  return trip.flight
    ? `${trip.flight.origin.cityName ?? trip.flight.origin.code} → ${trip.flight.destination.cityName ?? trip.flight.destination.code}`
    : (trip.hotel?.name ?? trip.product?.title ?? trip.reference);
}

function TripLine({ trip, children }: { trip: Trip; children?: ReactNode }) {
  const { t } = useAccountT();
  const format = useFormatters();
  const findings = trip.policyFindings.map((finding) => t(`booking.company.findings.${finding}`));
  return (
    <li className="flex flex-col gap-2 py-3" data-testid={`company-trip-${trip.id}`}>
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <AppLink
          href={`/bookings/${trip.id}`}
          className="font-body text-body font-bold text-primary underline focus-visible:focus-ring"
        >
          {tripTitle(trip)}
        </AppLink>
        <span className="font-body text-body font-bold text-foreground">
          {format.money(trip.total)}
        </span>
      </div>
      <p className="font-body text-body-sm text-muted">
        {[
          trip.reference,
          format.date(trip.startsOn),
          trip.travellerName
            ? t('account.company.trips.traveller', { name: trip.travellerName })
            : null,
          trip.bookerName ? t('account.company.trips.bookedBy', { name: trip.bookerName }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge variant={trip.approvalStatus === 'rejected' ? 'danger' : 'neutral'}>
          {t(`booking.company.status.${trip.approvalStatus}`)}
        </Badge>
      </div>
      {findings.length > 0 ? (
        <p className="font-body text-body-sm text-foreground">
          {t('booking.company.outsidePolicy', { findings: format.list(findings) })}
        </p>
      ) : null}
      {children}
    </li>
  );
}

function ApprovalsCard({ onDecided }: { onDecided: () => void }) {
  const { t } = useAccountT();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, ApprovalRejectReason>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company/bookings', { params: { query: { approval: 'pending', limit: 50 } } })
      .then(({ data }) => {
        if (!cancelled && data) setTrips(data.items);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trips) return null;
  const decide = async (bookingId: string, approve: boolean) => {
    const result = approve
      ? await browserApi().POST('/v1/me/company/bookings/{bookingId}/approve', {
          params: { path: { bookingId } },
        })
      : await browserApi().POST('/v1/me/company/bookings/{bookingId}/reject', {
          params: { path: { bookingId } },
          body: { reason: reasons[bookingId] ?? 'other' },
        });
    if (result.data) {
      setStatus(
        t(approve ? 'account.company.approvals.approved' : 'account.company.approvals.rejected'),
      );
      onDecided();
    }
  };
  const reasonLabel = (reason: ApprovalRejectReason) =>
    reason === 'other'
      ? t('account.company.approvals.otherReason')
      : t(`account.company.approvals.reasons.${reason}`);

  return (
    <AccountCard heading={t('account.company.approvals.heading')} testId="company-approvals">
      {trips.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.company.approvals.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {trips.map((trip) => (
            <TripLine key={trip.id} trip={trip}>
              {trip.canDecide ? (
                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <Button onClick={() => void decide(trip.id, true)}>
                    {t('account.company.approvals.approve')}
                  </Button>
                  <NativeSelect
                    id={`reject-reason-${trip.id}`}
                    label={t('account.company.approvals.reason')}
                    value={reasons[trip.id] ?? 'other'}
                    onChange={(event) =>
                      setReasons({
                        ...reasons,
                        [trip.id]: event.target.value as ApprovalRejectReason,
                      })
                    }
                    options={APPROVAL_REJECT_REASONS.map((reason) => ({
                      value: reason,
                      label: reasonLabel(reason),
                    }))}
                  />
                  <Button variant="secondary" onClick={() => void decide(trip.id, false)}>
                    {t('account.company.approvals.reject')}
                  </Button>
                </div>
              ) : null}
            </TripLine>
          ))}
        </ul>
      )}
      <StatusLine message={status} />
    </AccountCard>
  );
}

function TripsCard() {
  const { t } = useAccountT();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company/bookings', { params: { query: cursor ? { cursor } : {} } })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setTrips((previous) => [...(cursor ? (previous ?? []) : []), ...data.items]);
        setNext(data.nextCursor);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor]);

  if (!trips) return null;
  return (
    <AccountCard heading={t('account.company.trips.heading')} testId="company-trips">
      {trips.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.company.trips.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {trips.map((trip) => (
            <TripLine key={trip.id} trip={trip} />
          ))}
        </ul>
      )}
      {next ? (
        <div>
          <Button variant="secondary" onClick={() => setCursor(next)}>
            {t('account.trips.more')}
          </Button>
        </div>
      ) : null}
    </AccountCard>
  );
}

function SpendCard() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [spend, setSpend] = useState<Schemas['CompanySpend'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company/spend')
      .then(({ data }) => {
        if (!cancelled && data) setSpend(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!spend) return null;
  const download = async () => {
    setError(null);
    const { data, response } = await browserApi().GET('/v1/me/company/export', {
      parseAs: 'blob',
    });
    if (!data || !response.ok) {
      setError(t('account.company.error'));
      return;
    }
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `company-trips-${spend.from}-${spend.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const table = (
    rows: { key: string; label: string; total: Schemas['Money']; bookings: number }[],
    heading: string,
    first: string,
  ) => (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <h3 className="font-heading text-body font-bold text-heading">{heading}</h3>
      <table className="w-full font-body text-body-sm text-foreground">
        <thead>
          <tr className="text-start text-muted">
            <th scope="col" className="py-2 text-start font-medium">
              {first}
            </th>
            <th scope="col" className="py-2 text-end font-medium">
              {t('account.company.report.trips')}
            </th>
            <th scope="col" className="py-2 text-end font-medium">
              {t('account.company.report.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <td className="py-2">{row.label}</td>
              <td className="py-2 text-end">{format.number(row.bookings)}</td>
              <td className="py-2 text-end font-bold">{format.money(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <AccountCard
      heading={t('account.company.report.heading')}
      intro={t('account.company.report.intro')}
      testId="company-spend"
    >
      {spend.totals.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.company.report.empty')}</p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-6">
            {spend.totals.map((line) => (
              <div key={line.total.currency} className="flex flex-col gap-1">
                <dt className="font-body text-caption text-muted">
                  {t('account.company.report.amount')}
                </dt>
                <dd
                  className="font-heading text-h3 font-bold text-heading"
                  data-testid="company-spend-total"
                >
                  {format.money(line.total)}
                </dd>
              </div>
            ))}
          </dl>
          {table(
            spend.byMonth.map((line) => ({
              key: `${line.month}-${line.total.currency}`,
              label: format.date(`${line.month}-01`, 'long').replace(/^\d+\s/, ''),
              total: line.total,
              bookings: line.bookings,
            })),
            t('account.company.report.byMonth'),
            t('account.company.report.month'),
          )}
          {table(
            spend.byTraveller.map((line) => ({
              key: `${line.travellerName}-${line.total.currency}`,
              label: line.travellerName,
              total: line.total,
              bookings: line.bookings,
            })),
            t('account.company.report.byTraveller'),
            t('account.company.report.traveller'),
          )}
        </>
      )}
      <div>
        <Button variant="secondary" onClick={() => void download()}>
          {t('account.company.report.download')}
        </Button>
      </div>
      <ErrorLine message={error} />
    </AccountCard>
  );
}
