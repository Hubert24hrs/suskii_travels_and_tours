'use client';

import { ROLES, type Role } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  ConfirmAction,
  DataTable,
  DetailList,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  StatusBadge,
  TextField,
} from '../ui';

type AdminUser = Schemas['AdminUser'];

const statusTone = (status: AdminUser['status']) =>
  status === 'active' ? 'success' : status === 'disabled' ? 'warning' : 'neutral';

const staffRoles = (roles: readonly Role[]): string =>
  roles.map((role) => label('roles', role)).join(', ');

export function UsersPage() {
  const [filters, setFilters] = useState<{ q?: string; staffOnly?: 'true' }>({});
  const [draft, setDraft] = useState({ q: '', staffOnly: false });
  const pages = useCursorPages(['get', '/v1/admin/users', filters], async (cursor) =>
    unwrap(
      await adminApi.GET('/v1/admin/users', {
        params: { query: { ...filters, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({
      ...(draft.q.trim().length >= 2 ? { q: draft.q.trim() } : {}),
      ...(draft.staffOnly ? { staffOnly: 'true' as const } : {}),
    });
  };
  return (
    <RequirePermission permission="users:read">
      <PageHeader title={t('users.title')} />
      <form onSubmit={apply} className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <TextField
            label={t('users.search')}
            name="q"
            value={draft.q}
            minLength={2}
            onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          />
        </div>
        <CheckboxField
          label={t('users.staffOnly')}
          name="staffOnly"
          checked={draft.staffOnly}
          onChange={(event) =>
            setDraft((current) => ({ ...current, staffOnly: event.target.checked }))
          }
        />
        <Button type="submit">{t('common.search')}</Button>
      </form>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <>
            <DataTable
              caption={t('users.title')}
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'email',
                  header: t('users.email'),
                  cell: (row) => (
                    <Link
                      href={`/users/${row.id}` as Route}
                      className="font-bold text-primary underline focus-visible:focus-ring"
                      aria-label={t('users.open', { email: row.email ?? row.phone ?? row.id })}
                    >
                      {row.email ?? row.phone ?? row.id}
                    </Link>
                  ),
                },
                {
                  key: 'name',
                  header: t('users.name'),
                  cell: (row) => row.displayName ?? t('common.none'),
                },
                { key: 'roles', header: t('users.roles'), cell: (row) => staffRoles(row.roles) },
                {
                  key: 'mfa',
                  header: t('users.mfa'),
                  cell: (row) =>
                    row.mfaEnabled ? t('users.detail.mfaOn') : t('users.detail.mfaOff'),
                },
                {
                  key: 'status',
                  header: t('users.status'),
                  cell: (row) => (
                    <StatusBadge tone={statusTone(row.status)}>
                      {label('users.statuses', row.status)}
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
        )}
      </QueryState>
    </RequirePermission>
  );
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/users/{id}'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/users'] }),
    ]);
}

function RolesForm({ user }: { user: AdminUser }) {
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const { toast } = useToast();
  const invalidate = useInvalidateUsers();
  const save = $api.useMutation('put', '/v1/admin/users/{id}/roles', {
    onSuccess: async () => {
      toast({ title: t('common.saved'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ params: { path: { id: user.id } }, body: { roles } });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-1 gap-1 md:grid-cols-2">
        <legend className="sr-only">{t('users.detail.roles')}</legend>
        {ROLES.map((role) => (
          <CheckboxField
            key={role}
            label={label('roles', role)}
            name={`role-${role}`}
            checked={roles.includes(role)}
            onChange={(event) =>
              setRoles((current) =>
                event.target.checked
                  ? [...current, role]
                  : current.filter((value) => value !== role),
              )
            }
          />
        ))}
      </fieldset>
      <ProblemAlert error={save.error} />
      <div>
        <Button type="submit" loading={save.isPending}>
          {t('users.detail.saveRoles')}
        </Button>
      </div>
    </form>
  );
}

function AccountActions({ user }: { user: AdminUser }) {
  const { toast } = useToast();
  const invalidate = useInvalidateUsers();
  const [openAction, setOpenAction] = useState<'disable' | 'reset' | 'sign-out' | null>(null);
  const done = async () => {
    setOpenAction(null);
    toast({ title: t('users.detail.done'), variant: 'success' });
    await invalidate();
  };
  const disable = $api.useMutation('post', '/v1/admin/users/{id}/disable', { onSuccess: done });
  const enable = $api.useMutation('post', '/v1/admin/users/{id}/enable', { onSuccess: done });
  const reset = $api.useMutation('post', '/v1/admin/users/{id}/mfa-reset', { onSuccess: done });
  const signOut = $api.useMutation('post', '/v1/admin/users/{id}/sessions/revoke', {
    onSuccess: ({ revoked }) => {
      setOpenAction(null);
      toast({ title: t('users.detail.signedOut', { count: revoked }), variant: 'success' });
    },
  });
  const path = { params: { path: { id: user.id } } };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {user.status === 'active' ? (
          <ConfirmAction
            triggerLabel={t('users.detail.disable')}
            question={t('users.detail.confirmDisable')}
            onConfirm={() => disable.mutate(path)}
            pending={disable.isPending}
            error={disable.error}
            open={openAction === 'disable'}
            onOpenChange={(open) => setOpenAction(open ? 'disable' : null)}
          />
        ) : user.status === 'disabled' ? (
          <Button variant="ghost" loading={enable.isPending} onClick={() => enable.mutate(path)}>
            {t('users.detail.enable')}
          </Button>
        ) : null}
        {user.mfaEnabled ? (
          <ConfirmAction
            triggerLabel={t('users.detail.resetMfa')}
            question={t('users.detail.confirmReset')}
            onConfirm={() => reset.mutate(path)}
            pending={reset.isPending}
            error={reset.error}
            open={openAction === 'reset'}
            onOpenChange={(open) => setOpenAction(open ? 'reset' : null)}
          />
        ) : null}
        {user.status === 'active' ? (
          <ConfirmAction
            triggerLabel={t('users.detail.signOutEverywhere')}
            question={t('users.detail.confirmSignOut')}
            onConfirm={() => signOut.mutate(path)}
            pending={signOut.isPending}
            error={signOut.error}
            open={openAction === 'sign-out'}
            onOpenChange={(open) => setOpenAction(open ? 'sign-out' : null)}
          />
        ) : null}
      </div>
      <p className="font-body text-caption text-muted">{t('users.detail.resetMfaHint')}</p>
      <p className="font-body text-caption text-muted">{t('users.detail.signOutEverywhereHint')}</p>
      <ProblemAlert error={enable.error} />
    </div>
  );
}

export function UserDetailPage({ userId }: { userId: string }) {
  const { can, session } = useStaffSession();
  const query = $api.useQuery('get', '/v1/admin/users/{id}', { params: { path: { id: userId } } });
  const self = session.status === 'signed-in' && session.user.id === userId;
  return (
    <RequirePermission permission="users:read">
      <div>
        <Link
          href="/users"
          className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
        >
          {t('common.back')}
        </Link>
      </div>
      <QueryState query={query}>
        {(user) => (
          <>
            <PageHeader title={user.email ?? user.phone ?? t('users.detail.title')} />
            <Section title={t('users.detail.title')}>
              <DetailList
                items={[
                  { term: t('users.email'), value: user.email ?? t('common.none') },
                  { term: t('users.phone'), value: user.phone ?? t('common.none') },
                  { term: t('users.name'), value: user.displayName ?? t('common.none') },
                  {
                    term: t('users.status'),
                    value: (
                      <StatusBadge tone={statusTone(user.status)}>
                        {label('users.statuses', user.status)}
                      </StatusBadge>
                    ),
                  },
                  { term: t('users.roles'), value: staffRoles(user.roles) },
                  {
                    term: t('users.mfa'),
                    value: user.mfaEnabled ? t('users.detail.mfaOn') : t('users.detail.mfaOff'),
                  },
                  { term: t('common.created'), value: format.dateTime(user.createdAt) },
                  { term: t('common.id'), value: <code className="break-all">{user.id}</code> },
                ]}
              />
            </Section>
            {can('roles:manage') && !self && user.status !== 'deleted' ? (
              <Section title={t('users.detail.roles')} intro={t('users.detail.rolesHint')}>
                <RolesForm key={user.roles.join(',')} user={user} />
              </Section>
            ) : null}
            {can('users:manage') && !self && user.status !== 'deleted' ? (
              <Section title={t('common.actions')}>
                <AccountActions user={user} />
              </Section>
            ) : null}
          </>
        )}
      </QueryState>
    </RequirePermission>
  );
}
