'use client';

import {
  AGENT_MEMORY_BUDGETS,
  AGENT_MEMORY_KEYS,
  AGENT_MEMORY_SEATS,
  CABIN_CLASSES,
  type AgentMemoryKey,
} from '@suskii/shared/lite';
import { Button, Card, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { hasSession } from '../../lib/session';
import { useHydrated } from '../../lib/use-hydrated';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { memoryValueText } from './memory-text';
import { useAssistantT } from './use-assistant-t';

type Memory = Schemas['AssistantMemory'];

const LINK =
  'inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring';

/** The choices of the preferences that have a fixed set; the others take a code. */
const CHOICES: Partial<Record<AgentMemoryKey, readonly string[]>> = {
  cabin: CABIN_CLASSES,
  seat: AGENT_MEMORY_SEATS,
  budget: AGENT_MEMORY_BUDGETS,
};

/**
 * One preference: what is remembered, a way to change it and a way to erase it. A choice is a
 * list; an airport or airline is typed as its code, which the API checks against the catalog.
 */
function Preference({
  name,
  item,
  onChanged,
}: {
  name: AgentMemoryKey;
  item: Memory['items'][number] | null;
  onChanged: (memory: Memory) => void;
}) {
  const { t } = useAssistantT();
  const choices = CHOICES[name];
  const [value, setValue] = useState(item?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const label = t(`assistant.memory.keys.${name}`);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { data, error: problem } = await browserApi().PUT('/v1/me/assistant-memory/{key}', {
        params: { path: { key: name } },
        body: { value: value.trim() },
      });
      if (!data) {
        setError(
          problemSlug(problem) === 'agent-memory-invalid'
            ? t('assistant.memory.errors.invalid')
            : t('assistant.memory.errors.generic'),
        );
        return;
      }
      setSaved(true);
      onChanged(data);
    } catch {
      setError(t('assistant.memory.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const erase = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { data } = await browserApi().DELETE('/v1/me/assistant-memory/{key}', {
        params: { path: { key: name } },
      });
      if (data) {
        setValue('');
        onChanged(data);
      } else setError(t('assistant.memory.errors.generic'));
    } catch {
      setError(t('assistant.memory.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-4" data-testid={`memory-${name}`}>
      <form
        method="post"
        className="flex flex-col gap-2 md:flex-row md:items-end"
        onSubmit={(event) => void save(event)}
      >
        <div className="flex-1">
          {choices ? (
            <NativeSelect
              label={label}
              name={name}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              options={[
                { value: '', label: t('assistant.memory.notSet') },
                ...choices.map((choice) => ({
                  value: choice,
                  label: memoryValueText(t, name, choice),
                })),
              ]}
            />
          ) : (
            <Input
              label={label}
              hint={
                name === 'airlines'
                  ? t('assistant.memory.hints.airlines')
                  : t('assistant.memory.hints.home_airport')
              }
              name={name}
              value={value}
              maxLength={16}
              autoCapitalize="characters"
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" loading={busy} disabled={!value.trim()}>
            {t('assistant.memory.save')}
          </Button>
          {item ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-label={t('assistant.memory.eraseLabel', { preference: label })}
              onClick={() => void erase()}
            >
              {t('assistant.memory.erase')}
            </Button>
          ) : null}
        </div>
      </form>
      {item ? (
        <p className="font-body text-caption text-muted" data-testid={`memory-${name}-value`}>
          {memoryValueText(t, name, item.value)} · {t(`assistant.memory.setBy.${item.source}`)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="font-body text-body-sm text-foreground">
          {t('assistant.memory.saved')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What the assistant remembers about the signed-in traveller (ADR-105): a switch they turn
 * on themselves, and each preference to see, change and erase. Turning it off erases all of
 * them, and says so on the button. Nothing here is free text.
 */
export function AssistantMemory() {
  const { t } = useAssistantT();
  const hydrated = useHydrated();
  const signedIn = hydrated && hasSession();
  const [memory, setMemory] = useState<Memory | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/me/assistant-memory')
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setMemory(data);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const turn = async (enabled: boolean) => {
    setBusy(true);
    setError(false);
    try {
      const { data } = await browserApi().PUT('/v1/me/assistant-memory', { body: { enabled } });
      if (data) setMemory(data);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!hydrated) return null;
  if (!signedIn) {
    return (
      <p className="font-body text-body text-foreground">
        {t('assistant.memory.signIn')}{' '}
        <AppLink href="/sign-in?next=/assistant/preferences" className={LINK}>
          {t('assistant.signIn')}
        </AppLink>
      </p>
    );
  }
  if (missing) {
    return (
      <p role="alert" className="font-body text-body text-foreground">
        {t('assistant.memory.unavailable')}
      </p>
    );
  }
  if (!memory) return null;

  return (
    <Card className="flex max-w-dialog flex-col gap-4 p-6" data-testid="assistant-memory">
      {memory.enabled ? (
        <>
          {memory.items.length === 0 ? (
            <p className="font-body text-body-sm text-muted">{t('assistant.memory.empty')}</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-border">
            {AGENT_MEMORY_KEYS.map((name) => {
              const item = memory.items.find((entry) => entry.key === name) ?? null;
              return (
                <Preference
                  // A value confirmed in a chat since the page loaded starts the field afresh.
                  key={`${name}:${item?.value ?? ''}`}
                  name={name}
                  item={item}
                  onChanged={setMemory}
                />
              );
            })}
          </ul>
          <Button
            variant="ghost"
            className="self-start"
            loading={busy}
            onClick={() => void turn(false)}
            data-testid="memory-off"
          >
            {t('assistant.memory.turnOff')}
          </Button>
        </>
      ) : (
        <>
          <p className="font-body text-body text-foreground" data-testid="memory-is-off">
            {t('assistant.memory.off')}
          </p>
          <Button
            className="self-start"
            loading={busy}
            onClick={() => void turn(true)}
            data-testid="memory-on"
          >
            {t('assistant.memory.turnOn')}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {t('assistant.memory.errors.generic')}
        </p>
      ) : null}
    </Card>
  );
}
