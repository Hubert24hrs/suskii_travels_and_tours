'use client';

import { Button } from '@suskii/ui-web';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { adminApi } from '../../lib/api';
import { format, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { DataTable, PageHeader, QueryState, SelectField, TextField } from '../ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Areas the log can be narrowed to; the assistant's pages link here with one chosen. */
const AREAS = ['assistant'] as const;
type Area = (typeof AREAS)[number];
const areaOf = (value: string | null): Area | '' =>
  value && (AREAS as readonly string[]).includes(value) ? (value as Area) : '';

export function AuditPage() {
  const initialArea = areaOf(useSearchParams().get('area'));
  const [filters, setFilters] = useState<{ action?: string; actorUserId?: string; area?: Area }>(
    initialArea ? { area: initialArea } : {},
  );
  const [draft, setDraft] = useState<{ action: string; actorUserId: string; area: Area | '' }>({
    action: '',
    actorUserId: '',
    area: initialArea,
  });
  const pages = useCursorPages(['get', '/v1/admin/audit-logs', filters], async (cursor) =>
    unwrap(
      await adminApi.GET('/v1/admin/audit-logs', {
        params: { query: { ...filters, limit: 50, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({
      ...(draft.action.trim() ? { action: draft.action.trim() } : {}),
      ...(UUID.test(draft.actorUserId.trim()) ? { actorUserId: draft.actorUserId.trim() } : {}),
      ...(draft.area ? { area: draft.area } : {}),
    });
  };
  return (
    <RequirePermission permission="audit:read">
      <PageHeader title={t('audit.title')} intro={t('audit.intro')} />
      <form method="post" onSubmit={apply} className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <TextField
            label={t('audit.filterAction')}
            name="action"
            value={draft.action}
            placeholder="pricing.markup_updated"
            onChange={(event) =>
              setDraft((current) => ({ ...current, action: event.target.value }))
            }
          />
        </div>
        <div className="flex-1">
          <TextField
            label={t('audit.filterActor')}
            name="actorUserId"
            value={draft.actorUserId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, actorUserId: event.target.value }))
            }
          />
        </div>
        <SelectField
          label={t('audit.filterArea')}
          name="area"
          value={draft.area}
          options={[
            { value: '', label: t('audit.areas.all') },
            ...AREAS.map((value) => ({ value, label: t(`audit.areas.${value}`) })),
          ]}
          onChange={(event) =>
            setDraft((current) => ({ ...current, area: areaOf(event.target.value) }))
          }
        />
        <Button type="submit">{t('common.apply')}</Button>
      </form>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <>
            <DataTable
              caption={t('audit.title')}
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'when',
                  header: t('audit.when'),
                  cell: (row) => format.dateTime(row.occurredAt),
                },
                {
                  key: 'action',
                  header: t('audit.action'),
                  cell: (row) => <code className="break-all">{row.action}</code>,
                },
                {
                  key: 'actor',
                  header: t('audit.actor'),
                  cell: (row) => (
                    <span className="break-all">{row.actorUserId ?? row.actorType}</span>
                  ),
                },
                {
                  key: 'target',
                  header: t('audit.target'),
                  cell: (row) =>
                    row.targetType ? (
                      <span className="break-all">
                        {row.targetType}
                        {row.targetId ? `: ${row.targetId}` : ''}
                      </span>
                    ) : (
                      t('common.none')
                    ),
                },
                {
                  key: 'details',
                  header: t('audit.details'),
                  cell: (row) =>
                    Object.keys(row.metadata).length > 0 ? (
                      <details>
                        <summary className="cursor-pointer text-primary">
                          {t('audit.details')}
                        </summary>
                        <pre className="max-w-popover overflow-x-auto font-body text-caption whitespace-pre-wrap">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      t('common.none')
                    ),
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
