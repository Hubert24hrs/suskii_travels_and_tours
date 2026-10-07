'use client';

import { Button, Dialog, DialogContent } from '@suskii/ui-web';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { adminApi, problemOf } from '../lib/api';
import { t } from '../lib/i18n';
import { registerStepUpPrompt } from '../lib/step-up';

import { TextField } from './ui';

/**
 * Asks for an authenticator (or recovery) code when the API wants step-up for a risky action
 * (ADR-037). The API client opens it and repeats the refused request once it succeeds; closing it
 * leaves the action refused with its `step-up-required` message.
 */
export function StepUpPrompt() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    registerStepUpPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => {
      registerStepUpPrompt(null);
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  const finish = (confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const value = code.trim();
    const body = /^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value };
    const { response, error: problem } = await adminApi.POST('/v1/me/mfa/step-up', { body });
    setBusy(false);
    if (response.ok) {
      finish(true);
      return;
    }
    setError(
      problemOf(problem).slug === 'too-many-attempts'
        ? t('auth.errors.locked')
        : t('auth.errors.code'),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent
        title={t('auth.stepUp.heading')}
        description={t('auth.stepUp.intro')}
        closeLabel={t('common.close')}
      >
        <form
          method="post"
          className="flex flex-col gap-3"
          aria-label={t('auth.stepUp.heading')}
          onSubmit={(event) => void submit(event)}
        >
          <TextField
            label={t('auth.stepUp.code')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            maxLength={32}
            required
            data-testid="step-up-code"
          />
          {error ? (
            <p role="alert" className="font-body text-body-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {t('auth.stepUp.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => finish(false)}>
              {t('auth.stepUp.cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
