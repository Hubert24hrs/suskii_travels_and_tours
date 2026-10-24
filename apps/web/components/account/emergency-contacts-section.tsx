'use client';

import { Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi } from '../../lib/browser-api';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine } from './account-shell';

interface Contact {
  name: string;
  phone: string;
}
const MAX_CONTACTS = 3;
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * The rider's emergency contacts (ADR-050): texted when they press SOS on a ride. Stored
 * encrypted one by one; the whole list is replaced on save.
 */
export function EmergencyContactsSection() {
  const { t } = useAccountT();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/emergency-contacts')
      .then(({ data }) => {
        if (!cancelled) setContacts(data?.contacts ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!contacts) return null;

  const update = (index: number, patch: Partial<Contact>) =>
    setContacts(contacts.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setError(null);
    const cleaned = contacts.map((contact) => ({
      name: contact.name.trim(),
      phone: contact.phone.replace(/[\s-]/g, ''),
    }));
    if (cleaned.some((contact) => !contact.name || !E164.test(contact.phone))) {
      setError(t('account.emergency.invalid'));
      return;
    }
    setBusy(true);
    try {
      const { data } = await browserApi().PUT('/v1/me/emergency-contacts', {
        body: { contacts: cleaned },
      });
      if (data) {
        setContacts(data.contacts);
        setStatus(t('account.emergency.saved'));
      } else setError(t('account.emergency.error'));
    } catch {
      setError(t('account.emergency.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountCard
      heading={t('account.emergency.heading')}
      intro={t('account.emergency.intro')}
      testId="emergency-contacts"
    >
      <form
        method="post"
        noValidate
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-4"
      >
        {contacts.length === 0 ? (
          <p className="font-body text-body-sm text-foreground">{t('account.emergency.none')}</p>
        ) : null}
        {contacts.map((contact, index) => (
          <fieldset key={index} className="flex flex-col gap-3 md:flex-row md:items-end">
            <legend className="sr-only">
              {t('account.emergency.contact', { number: index + 1 })}
            </legend>
            <Input
              id={`emergency-${index}-name`}
              autoComplete="off"
              maxLength={80}
              label={t('account.emergency.name')}
              value={contact.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Input
              id={`emergency-${index}-phone`}
              type="tel"
              autoComplete="off"
              label={t('account.emergency.phone')}
              value={contact.phone}
              onChange={(event) => update(index, { phone: event.target.value })}
            />
            <Button
              variant="ghost"
              onClick={() => setContacts(contacts.filter((_, i) => i !== index))}
            >
              {t('account.emergency.remove')}
            </Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-3">
          {contacts.length < MAX_CONTACTS ? (
            <Button
              variant="secondary"
              onClick={() => setContacts([...contacts, { name: '', phone: '' }])}
            >
              {t('account.emergency.add')}
            </Button>
          ) : null}
          <Button type="submit" loading={busy}>
            {t('account.emergency.save')}
          </Button>
        </div>
        <StatusLine message={status} />
        <ErrorLine message={error} />
      </form>
    </AccountCard>
  );
}
