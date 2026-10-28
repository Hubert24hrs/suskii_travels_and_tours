'use client';

import { COMPANY_STATUSES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  ConfirmAction,
  DataTable,
  DetailList,
  PageHeader,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextField,
} from '../ui';

type Company = Schemas['AdminCompany'];
type Detail = Schemas['AdminCompanyDetail'];
type Status = Company['status'];

const PATH = '/v1/admin/companies';
const tone = (status: Status) => (status === 'active' ? 'success' : 'warning');

function useInvalidateCompanies() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', PATH] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/companies/{id}'] }),
    ]);
}

/** Suspends or reinstates a company (suspension asks for a fresh authenticator check). */
function StatusAction({ company }: { company: Detail }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateCompanies();
  const suspending = company.status === 'active';
  const options = {
    onSuccess: async () => {
      setOpen(false);
      toast({
        title: t(suspending ? 'companies.suspended' : 'companies.reinstated'),
        variant: 'success',
      });
      await invalidate();
    },
  };
  const suspend = $api.useMutation('post', '/v1/admin/companies/{id}/suspend', options);
  const reinstate = $api.useMutation('post', '/v1/admin/companies/{id}/reinstate', options);
  const mutation = suspending ? suspend : reinstate;
  return (
    <ConfirmAction
      triggerLabel={t(suspending ? 'companies.suspend' : 'companies.reinstate')}
      triggerAriaLabel={t(suspending ? 'companies.suspendFor' : 'companies.reinstateFor', {
        name: company.name,
      })}
      question={t(suspending ? 'companies.confirmSuspend' : 'companies.confirmReinstate')}
      onConfirm={() => mutation.mutate({ params: { path: { id: company.id } } })}
      pending={mutation.isPending}
      error={mutation.error}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function CompanyDetail({ id }: { id: string }) {
  const { can } = useStaffSession();
  const detail = useQuery({
    queryKey: ['get', '/v1/admin/companies/{id}', id],
    queryFn: async () =>
      unwrap(await adminApi.GET('/v1/admin/companies/{id}', { params: { path: { id } } })),
  });
  return (
    <QueryState query={detail}>
      {(company) => {
        const policy = company.policy;
        const noLimit = t('companies.noLimit');
        return (
          <Section
            title={company.name}
            intro={t('companies.detail')}
            actions={can('users:manage') ? <StatusAction company={company} /> : null}
          >
            <DetailList
              items={[
                {
                  term: t('companies.status'),
                  value: (
                    <StatusBadge tone={tone(company.status)}>
                      {label('companies.statuses', company.status)}
                    </StatusBadge>
                  ),
                },
                { term: t('companies.country'), value: company.countryCode },
                {
                  term: t('companies.registrationNumber'),
                  value: company.registrationNumber ?? t('common.none'),
                },
                { term: t('companies.taxId'), value: company.taxId ?? t('common.none') },
                { term: t('companies.billingEmail'), value: company.billingEmail },
                {
                  term: t('companies.hotelCap'),
                  value: policy.hotelNightlyCap ? format.money(policy.hotelNightlyCap) : noLimit,
                },
                {
                  term: t('companies.maxCabin'),
                  value: policy.maxCabin ? label('pricing.cabins', policy.maxCabin) : noLimit,
                },
                {
                  term: t('companies.minAdvanceDays'),
                  value:
                    policy.minAdvanceDays === null ? noLimit : format.number(policy.minAdvanceDays),
                },
                {
                  term: t('companies.approvalMode'),
                  value: label('companies.approvalModes', policy.approvalMode),
                },
              ]}
            />
            <DataTable
              caption={t('companies.members')}
              rows={company.memberList}
              rowKey={(row) => row.userId}
              columns={[
                {
                  key: 'name',
                  header: t('companies.name'),
                  cell: (row) => row.name ?? row.email ?? t('common.none'),
                },
                { key: 'email', header: t('users.email'), cell: (row) => row.email ?? '' },
                {
                  key: 'role',
                  header: t('companies.role'),
                  cell: (row) => label('companies.roles', row.role),
                },
                {
                  key: 'joined',
                  header: t('companies.joined'),
                  cell: (row) => format.dateTime(row.joinedAt),
                },
              ]}
            />
          </Section>
        );
      }}
    </QueryState>
  );
}

/** Company accounts (ADR-078): find a company, see its members and policy, suspend it. */
export function CompaniesPage() {
  const [filters, setFilters] = useState<{ q?: string; status?: Status }>({});
  const [draft, setDraft] = useState<{ q: string; status: Status | '' }>({ q: '', status: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const pages = useCursorPages(['get', PATH, filters], async (cursor) =>
    unwrap(
      await adminApi.GET(PATH, {
        params: { query: { ...filters, limit: 50, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({
      ...(draft.q.trim().length >= 2 ? { q: draft.q.trim() } : {}),
      ...(draft.status ? { status: draft.status } : {}),
    });
  };
  return (
    <RequirePermission permission="users:read">
      <PageHeader title={t('companies.title')} intro={t('companies.intro')} />
      <form method="get" onSubmit={apply} className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <TextField
            label={t('companies.search')}
            name="q"
            value={draft.q}
            minLength={2}
            onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          />
        </div>
        <SelectField
          label={t('companies.status')}
          name="status"
          value={draft.status}
          onChange={(event) =>
            setDraft((current) => ({ ...current, status: event.target.value as Status | '' }))
          }
          options={[
            { value: '', label: t('companies.any') },
            ...COMPANY_STATUSES.map((value) => ({
              value,
              label: label('companies.statuses', value),
            })),
          ]}
        />
        <Button type="submit">{t('common.search')}</Button>
      </form>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) =>
          items.length === 0 ? (
            <p className="font-body text-body text-muted">{t('companies.empty')}</p>
          ) : (
            <>
              <DataTable
                caption={t('companies.title')}
                rows={items}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'name',
                    header: t('companies.name'),
                    cell: (row) => (
                      <Button
                        variant="ghost"
                        aria-label={t('companies.open', { name: row.name })}
                        onClick={() => setSelected(row.id)}
                      >
                        {row.name}
                      </Button>
                    ),
                  },
                  {
                    key: 'country',
                    header: t('companies.country'),
                    cell: (row) => row.countryCode,
                  },
                  {
                    key: 'members',
                    header: t('companies.members'),
                    cell: (row) => format.number(row.members),
                  },
                  {
                    key: 'bookings',
                    header: t('companies.bookings'),
                    cell: (row) => format.number(row.bookings),
                  },
                  {
                    key: 'status',
                    header: t('companies.status'),
                    cell: (row) => (
                      <StatusBadge tone={tone(row.status)}>
                        {label('companies.statuses', row.status)}
                      </StatusBadge>
                    ),
                  },
                  {
                    key: 'created',
                    header: t('common.created'),
                    cell: (row) => format.dateTime(row.createdAt),
                  },
                ]}
              />
              {pages.hasNextPage ? (
                <Button
                  variant="ghost"
                  loading={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
      {selected ? <CompanyDetail key={selected} id={selected} /> : null}
    </RequirePermission>
  );
}
