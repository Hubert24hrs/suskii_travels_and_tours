'use client';

import {
  AGENT_APPROVAL_PERMISSIONS,
  AGENT_APPROVAL_REJECT_REASONS,
  AGENT_APPROVAL_STATUSES,
  type AgentApprovalRejectReason,
  type AgentApprovalStatus,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import { $api, idempotencyKey, type Schemas } from '../../lib/api';
import { percentFromBps } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  ConfirmAction,
  DetailList,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
} from '../ui';

type Approval = Schemas['AgentApproval'];
type Money = Schemas['Money'];

const PATH = '/v1/admin/ai/approvals';
const LINK = 'font-bold text-primary underline focus-visible:focus-ring';

const tone = (status: AgentApprovalStatus) =>
  status === 'pending'
    ? 'warning'
    : status === 'approved'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : 'neutral';

const useRefresh = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const money = (value: unknown): Money | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { amountMinor, currency } = value as { amountMinor?: unknown; currency?: unknown };
  return typeof amountMinor === 'number' && typeof currency === 'string'
    ? { amountMinor, currency }
    : null;
};

/**
 * What approving would do, read from the proposal itself. The payload is the kind's own form
 * (a refund request, a promo code); anything unexpected is simply not shown.
 */
function payloadItems(approval: Approval): { term: string; value: ReactNode }[] {
  const payload = approval.payload;
  const none = t('common.none');
  if (approval.kind === 'refund_request') {
    const bookingId = text(payload.bookingId);
    const amount = money(payload.amount);
    const reason = text(payload.reason);
    return [
      {
        term: t('approvals.booking'),
        value: bookingId ? (
          <Link href={`/bookings/${bookingId}` as Route} className={LINK}>
            {t('approvals.openBooking')}
          </Link>
        ) : (
          none
        ),
      },
      { term: t('common.amount'), value: amount ? format.money(amount) : none },
      { term: t('common.reason'), value: reason ? label('refunds.reasons', reason) : none },
      { term: t('approvals.payment'), value: text(payload.paymentId) ?? none },
      {
        term: t('approvals.cancelBooking'),
        value: payload.cancelBooking === true ? t('common.yes') : t('common.no'),
      },
    ];
  }
  const value = whole(payload.value);
  const currency = text(payload.currency);
  const verticals = Array.isArray(payload.verticals)
    ? payload.verticals.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const amountOf = (minor: unknown): string =>
    whole(minor) !== null && currency
      ? format.money({ amountMinor: whole(minor) ?? 0, currency })
      : none;
  const when = (instant: unknown): string => {
    const iso = text(instant);
    return iso ? format.dateTime(iso) : none;
  };
  const count = (limit: unknown): string => {
    const number = whole(limit);
    return number === null ? none : format.number(number);
  };
  return [
    { term: t('approvals.code'), value: text(payload.code) ?? none },
    {
      term: t('approvals.gives'),
      value:
        value === null
          ? none
          : payload.type === 'percentage'
            ? t('approvals.percentOff', { percent: percentFromBps(value) })
            : t('approvals.amountOff', { amount: amountOf(value) }),
    },
    {
      term: t('approvals.appliesTo'),
      value:
        verticals.length === 0
          ? t('approvals.everyProduct')
          : verticals.map((vertical) => label('verticals', vertical)).join(', '),
    },
    { term: t('approvals.validFrom'), value: when(payload.validFrom) },
    { term: t('approvals.validTo'), value: when(payload.validTo) },
    { term: t('approvals.uses'), value: count(payload.maxRedemptions) },
    { term: t('approvals.usesPerAccount'), value: count(payload.maxRedemptionsPerUser) },
    { term: t('approvals.minSpend'), value: amountOf(payload.minSpendMinor) },
    { term: t('approvals.maxDiscount'), value: amountOf(payload.maxDiscountMinor) },
  ];
}

function ApproveAction({ approval, name }: { approval: Approval; name: string }) {
  const [open, setOpen] = useState(false);
  // One key per proposal: a second press replays the first answer instead of deciding twice.
  const [key] = useState(idempotencyKey);
  const { toast } = useToast();
  const refresh = useRefresh();
  const approve = $api.useMutation('post', `${PATH}/{approvalId}/approve`, {
    onSuccess: async (decided) => {
      setOpen(false);
      toast(
        decided.status === 'failed'
          ? { title: t('approvals.failedToast'), variant: 'error' }
          : { title: t('approvals.approved'), variant: 'success' },
      );
      await refresh();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('approvals.approve')}
      triggerAriaLabel={t('approvals.approveLabel', {
        kind: name,
        time: format.dateTime(approval.createdAt),
      })}
      question={
        approval.kind === 'refund_request'
          ? t('approvals.approveRefundQuestion')
          : t('approvals.approvePromoQuestion')
      }
      onConfirm={() =>
        approve.mutate({
          params: { path: { approvalId: approval.id }, header: { 'Idempotency-Key': key } },
        })
      }
      pending={approve.isPending}
      error={approve.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) approve.reset();
      }}
    />
  );
}

function RejectDialog({ approval, name }: { approval: Approval; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AgentApprovalRejectReason>('not_needed');
  const { toast } = useToast();
  const refresh = useRefresh();
  const reject = $api.useMutation('post', `${PATH}/{approvalId}/reject`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('approvals.rejected'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reject.mutate({ params: { path: { approvalId: approval.id } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('approvals.reject')}
      triggerAriaLabel={t('approvals.rejectLabel', {
        kind: name,
        time: format.dateTime(approval.createdAt),
      })}
      title={t('approvals.rejectTitle')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reject.reset();
      }}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('approvals.rejectReason')}
          name="reason"
          value={reason}
          options={AGENT_APPROVAL_REJECT_REASONS.map((value) => ({
            value,
            label: label('approvals.rejectReasons', value),
          }))}
          onChange={(event) => setReason(event.target.value as AgentApprovalRejectReason)}
        />
        <ProblemAlert error={reject.error} />
        <Button type="submit" loading={reject.isPending}>
          {t('approvals.reject')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const { session, can } = useStaffSession();
  const mine = session.status === 'signed-in' && session.user.id === approval.requestedBy;
  const name = label('approvals.kinds', approval.kind);
  const pending = approval.status === 'pending';
  return (
    <Section
      title={name}
      intro={t('approvals.preparedBy', { agent: label('ai.agents', approval.agent) })}
      actions={
        pending && approval.mayDecide ? (
          <>
            <ApproveAction approval={approval} name={name} />
            <RejectDialog approval={approval} name={name} />
          </>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone(approval.status)}>
          {label('approvals.statuses', approval.status)}
        </StatusBadge>
        <span className="font-body text-body-sm text-muted">
          {t('approvals.askedAt')} {format.dateTime(approval.createdAt)}
          {pending ? ` · ${t('approvals.expires')} ${format.dateTime(approval.expiresAt)}` : ''}
          {approval.decidedAt
            ? ` · ${t('approvals.decidedAt')} ${format.dateTime(approval.decidedAt)}`
            : ''}
        </span>
      </div>
      <DetailList
        items={[
          {
            term: t('approvals.askedBy'),
            value: mine ? (
              t('approvals.askedByYou')
            ) : (
              <Link href={`/users/${approval.requestedBy}` as Route} className={LINK}>
                {approval.requestedBy}
              </Link>
            ),
          },
          ...payloadItems(approval),
        ]}
      />
      {pending && mine ? (
        <p className="font-body text-body-sm text-muted">{t('approvals.ownNote')}</p>
      ) : null}
      {pending && !mine && !can(AGENT_APPROVAL_PERMISSIONS[approval.kind]) ? (
        <p className="font-body text-body-sm text-muted">{t('approvals.noPermissionNote')}</p>
      ) : null}
      {approval.status === 'failed' ? (
        <p className="font-body text-body-sm text-danger">{t('approvals.failedNote')}</p>
      ) : null}
      {approval.status === 'rejected' && approval.reason ? (
        <p className="font-body text-body-sm text-foreground">
          {t('common.reason')}: {label('approvals.rejectReasons', approval.reason)}
        </p>
      ) : null}
      {approval.result ? (
        <p className="flex flex-wrap items-center gap-2 font-body text-body-sm text-foreground">
          {approval.result.type === 'refund'
            ? t('approvals.resultRefund')
            : t('approvals.resultPromo')}
          <Link href={approval.result.type === 'refund' ? '/refunds' : '/promos'} className={LINK}>
            {approval.result.type === 'refund'
              ? t('approvals.seeRefunds')
              : t('approvals.seePromos')}
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

/**
 * The approvals queue (ADR-107): what a staff agent prepared, for a person to decide. Approving
 * runs the ordinary action as the approver; the person whose question produced a proposal can
 * never decide it, and the API checks both again.
 */
export function ApprovalsPage() {
  const [status, setStatus] = useState<AgentApprovalStatus>('pending');
  const query = $api.useQuery('get', PATH, { params: { query: { status, limit: 50 } } });
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('approvals.title')} intro={t('approvals.intro')} />
        <div className="max-w-popover">
          <SelectField
            label={t('approvals.filter')}
            name="status"
            value={status}
            options={AGENT_APPROVAL_STATUSES.map((value) => ({
              value,
              label: label('approvals.statuses', value),
            }))}
            onChange={(event) => setStatus(event.target.value as AgentApprovalStatus)}
          />
        </div>
        <QueryState query={query}>
          {(data) => (
            <div className="flex flex-col gap-4">
              <Section title={t('approvals.alsoWaiting')}>
                <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                  <li>
                    {t('approvals.quotesToVerify', {
                      count: data.alsoWaiting.assistedQuotesToVerify,
                    })}
                  </li>
                  <li>
                    {t('approvals.bookingsToBook', {
                      count: data.alsoWaiting.assistedBookingsToBook,
                    })}
                  </li>
                </ul>
                <Link
                  href="/assisted-quotes"
                  className={`inline-flex min-h-6 items-center self-start font-body text-body-sm ${LINK}`}
                >
                  {t('approvals.openQuotes')}
                </Link>
              </Section>
              {data.approvals.length === 0 ? (
                <p className="font-body text-body-sm text-muted">{t('approvals.empty')}</p>
              ) : (
                data.approvals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} />
                ))
              )}
            </div>
          )}
        </QueryState>
      </div>
    </RequirePermission>
  );
}
