'use client';

import { Button } from '@suskii/ui-web';
import { useState, type FormEvent } from 'react';

import { $api } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { PageHeader, ProblemAlert, Section, TextField } from '../ui';

export function VouchersPage() {
  const [code, setCode] = useState('');
  const redeem = $api.useMutation('post', '/v1/admin/vouchers/redeem', {
    onSuccess: () => setCode(''),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    redeem.mutate({ body: { code: code.trim() } });
  };
  const result = redeem.data;
  return (
    <RequirePermission permission="bookings:manage">
      <PageHeader title={t('vouchers.title')} intro={t('vouchers.intro')} />
      <Section title={t('vouchers.code')}>
        <form
          method="post"
          onSubmit={submit}
          className="flex flex-col gap-4 md:flex-row md:items-end"
        >
          <div className="flex-1">
            <TextField
              label={t('vouchers.code')}
              name="code"
              value={code}
              autoComplete="off"
              required
              onChange={(event) => setCode(event.target.value)}
              data-testid="voucher-code"
            />
          </div>
          <Button type="submit" loading={redeem.isPending}>
            {t('vouchers.submit')}
          </Button>
        </form>
        <ProblemAlert error={redeem.error} />
        {result ? (
          <div
            role="status"
            className="rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground"
          >
            <p className="font-bold">{t('vouchers.redeemed')}</p>
            <p>
              {t('vouchers.result', {
                kind: `${label('vouchers.kinds', result.kind)}: ${result.title}`,
                travellers: result.travellers,
                date:
                  result.startsOn.length > 10
                    ? result.startsOn.replace('T', ' ')
                    : format.date(result.startsOn, 'medium'),
                reference: result.bookingReference,
              })}
            </p>
          </div>
        ) : null}
      </Section>
    </RequirePermission>
  );
}
