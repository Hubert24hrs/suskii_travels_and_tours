import type { Schemas } from '@suskii/api-client';
import {
  AGENT_MEMORY_BUDGETS,
  AGENT_MEMORY_KEYS,
  AGENT_MEMORY_SEATS,
  CABIN_CLASSES,
  type AgentMemoryKey,
} from '@suskii/shared';
import { Button, Card, Input } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { memoryValueText } from '../components/assistant/memory-text';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { useApp, useT } from '../providers/app-provider';

type Memory = Schemas['AssistantMemory'];
type Item = Memory['items'][number];

const KEY = ['assistant-memory'] as const;

/** The choices of the preferences that have a fixed set; the others take a code. */
const CHOICES: Partial<Record<AgentMemoryKey, readonly string[]>> = {
  cabin: CABIN_CLASSES,
  seat: AGENT_MEMORY_SEATS,
  budget: AGENT_MEMORY_BUDGETS,
};

/**
 * One preference: what is remembered, a way to change it and a way to erase it. A choice is a
 * row of options saved with one press; an airport or airline is typed as its code, which the
 * API checks against the catalog.
 */
function Preference({
  name,
  item,
  onChanged,
}: {
  name: AgentMemoryKey;
  item: Item | null;
  onChanged: (memory: Memory) => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const choices = CHOICES[name];
  const [value, setValue] = useState(item?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t(`assistant.memory.keys.${name}`);

  const save = async (next: string) => {
    if (!next.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.PUT('/v1/me/assistant-memory/{key}', {
        params: { path: { key: name } },
        body: { value: next.trim() },
      });
      if (data) onChanged(data);
      else {
        setError(
          problemSlug(problem) === 'agent-memory-invalid'
            ? t('assistant.memory.errors.invalid')
            : t('assistant.memory.errors.generic'),
        );
      }
    } catch {
      setError(t('assistant.memory.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const erase = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.DELETE('/v1/me/assistant-memory/{key}', {
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
    <View testID={`memory-${name}`} className="gap-2">
      {choices ? (
        <>
          <Text className="font-body-bold text-body-sm text-foreground">{label}</Text>
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
            {choices.map((choice) => (
              <Pressable
                key={choice}
                testID={`memory-${name}-${choice}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: item?.value === choice, disabled: busy }}
                disabled={busy}
                onPress={() => void save(choice)}
                className={
                  item?.value === choice
                    ? 'min-h-12 justify-center rounded-md bg-primary-subtle px-3'
                    : 'min-h-12 justify-center rounded-md border border-border-strong px-3'
                }
              >
                <Text className="font-body text-body-sm text-foreground">
                  {memoryValueText(t, name, choice)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
          <Input
            testID={`memory-${name}-input`}
            label={label}
            hint={
              name === 'airlines'
                ? t('assistant.memory.hints.airlines')
                : t('assistant.memory.hints.home_airport')
            }
            value={value}
            onChangeText={setValue}
            maxLength={16}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View className="items-start">
            <Button
              testID={`memory-${name}-save`}
              variant="secondary"
              loading={busy}
              disabled={!value.trim()}
              onPress={() => void save(value)}
            >
              {t('assistant.memory.save')}
            </Button>
          </View>
        </>
      )}
      {item ? (
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text
            testID={`memory-${name}-value`}
            className="flex-1 font-body text-caption text-muted"
          >
            {`${memoryValueText(t, name, item.value)} · ${t(`assistant.memory.setBy.${item.source}`)}`}
          </Text>
          <Button
            testID={`memory-${name}-erase`}
            variant="ghost"
            disabled={busy}
            accessibilityLabel={t('assistant.memory.eraseLabel', { preference: label })}
            onPress={() => void erase()}
          >
            {t('assistant.memory.erase')}
          </Button>
        </View>
      ) : null}
      {error ? (
        <Text
          testID={`memory-${name}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          className="font-body text-body-sm text-danger"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Preferences() {
  const { api } = useApp();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const memory = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/me/assistant-memory');
      // 404 while the assistant is switched off: there is nothing to remember with.
      if (response.status === 404) return null;
      if (!data) throw new Error('assistant-memory');
      return data;
    },
  });
  const changed = (next: Memory) => queryClient.setQueryData(KEY, next);

  if (memory.isPending) return <Loading label={t('mobile.loading')} />;
  if (memory.isError) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void memory.refetch()}
      />
    );
  }
  if (!memory.data) {
    return <Notice testID="memory-unavailable" body={t('assistant.memory.unavailable')} />;
  }

  const turn = async (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await api.PUT('/v1/me/assistant-memory', { body: { enabled } });
      if (data) changed(data);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const { enabled, items } = memory.data;

  return (
    <ScrollView
      testID="assistant-memory"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="font-body text-body text-foreground">{t('assistant.memory.intro')}</Text>
      {enabled ? (
        <>
          {items.length === 0 ? (
            <Text className="font-body text-body-sm text-muted">{t('assistant.memory.empty')}</Text>
          ) : null}
          {AGENT_MEMORY_KEYS.map((name) => {
            const item = items.find((entry) => entry.key === name) ?? null;
            return (
              <Card key={name} className="p-4">
                <Preference
                  // A value confirmed in a chat since the screen opened starts the field afresh.
                  key={`${name}:${item?.value ?? ''}`}
                  name={name}
                  item={item}
                  onChanged={changed}
                />
              </Card>
            );
          })}
          <Button
            testID="memory-off"
            variant="ghost"
            loading={busy}
            onPress={() => void turn(false)}
          >
            {t('assistant.memory.turnOff')}
          </Button>
        </>
      ) : (
        <Card className="gap-3 p-4">
          <Text testID="memory-is-off" className="font-body text-body text-foreground">
            {t('assistant.memory.off')}
          </Text>
          <Button testID="memory-on" loading={busy} onPress={() => void turn(true)}>
            {t('assistant.memory.turnOn')}
          </Button>
        </Card>
      )}
      {failed ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          className="font-body text-body-sm text-danger"
        >
          {t('assistant.memory.errors.generic')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * What the assistant remembers about the signed-in traveller (ADR-105): a switch they turn on
 * themselves, and each preference to see, change and erase. Turning it off erases all of
 * them, and the button says so. Nothing here is free text, and nothing is kept on the phone.
 */
export function AssistantMemoryScreen() {
  const { t } = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('assistant.memory.heading') }} />
      <RequireAccount>
        <Preferences />
      </RequireAccount>
    </>
  );
}
