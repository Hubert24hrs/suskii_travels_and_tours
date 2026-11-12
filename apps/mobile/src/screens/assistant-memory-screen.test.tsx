import { getMessages } from '@suskii/i18n';
import type { Schemas } from '@suskii/api-client';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { AssistantMemoryScreen } from './assistant-memory-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
type Memory = Schemas['AssistantMemory'];
type Item = Memory['items'][number];

const item = (key: Item['key'], value: string, source: Item['source'] = 'traveller'): Item => ({
  key,
  value,
  source,
  updatedAt: '2026-11-11T09:00:00.000Z',
});
const memory = (items: Item[] = [], enabled = true): Memory => ({
  enabled,
  enabledAt: enabled ? '2026-11-11T09:00:00.000Z' : null,
  items,
});

describe('AssistantMemoryScreen', () => {
  it('asks a guest to sign in, and reads nothing', async () => {
    const { calls } = mockApi({});
    await renderWithApp(<AssistantMemoryScreen />);

    expect(await screen.findByTestId('account-required')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });

  it('remembers nothing until the traveller says so', async () => {
    const { calls } = mockApi({
      'GET /v1/me/assistant-memory': () => json(memory([], false)),
      'PUT /v1/me/assistant-memory': () => json(memory([])),
    });
    await renderWithApp(<AssistantMemoryScreen />, await signedInSession());

    expect(await screen.findByTestId('memory-is-off')).toHaveTextContent(m.assistant.memory.off);
    expect(screen.getByText(m.assistant.memory.intro)).toBeOnTheScreen();
    // No preference can be set while it is off.
    expect(screen.queryByTestId('memory-seat')).toBeNull();

    await fireEvent.press(screen.getByTestId('memory-on'));
    expect(await screen.findByText(m.assistant.memory.empty)).toBeOnTheScreen();
    const turned = calls.find((call) => call.method === 'PUT');
    expect(await turned?.json()).toEqual({ enabled: true });
    expect(screen.getByTestId('memory-seat')).toBeOnTheScreen();
  });

  it('saves a choice with one press and a code from the field, and shows who set each', async () => {
    let kept: Item[] = [item('cabin', 'business', 'assistant')];
    const { calls } = mockApi({
      'GET /v1/me/assistant-memory': () => json(memory(kept)),
      'PUT /v1/me/assistant-memory/seat': () => {
        kept = [...kept, item('seat', 'window')];
        return json(memory(kept));
      },
      'PUT /v1/me/assistant-memory/home_airport': () => {
        kept = [item('home_airport', 'LOS'), ...kept];
        return json(memory(kept));
      },
    });
    await renderWithApp(<AssistantMemoryScreen />, await signedInSession());

    // What a chat confirmed says so; names come from the catalog, never the stored code.
    expect(await screen.findByTestId('memory-cabin-value')).toHaveTextContent(
      `${m.cabins.business} · ${m.assistant.memory.setBy.assistant}`,
    );
    expect(screen.getByTestId('memory-cabin-business')).toBeChecked();

    await fireEvent.press(screen.getByTestId('memory-seat-window'));
    expect(await screen.findByTestId('memory-seat-value')).toHaveTextContent(
      `${m.assistant.memory.seats.window} · ${m.assistant.memory.setBy.traveller}`,
    );
    const seat = calls.find((call) => call.url.endsWith('/assistant-memory/seat'));
    expect(await seat?.json()).toEqual({ value: 'window' });

    await fireEvent.changeText(screen.getByTestId('memory-home_airport-input'), ' los ');
    await fireEvent.press(screen.getByTestId('memory-home_airport-save'));
    expect(await screen.findByTestId('memory-home_airport-value')).toHaveTextContent(/LOS/);
    const airport = calls.find((call) => call.url.endsWith('/assistant-memory/home_airport'));
    expect(await airport?.json()).toEqual({ value: 'los' });
  });

  it('says when a code names nothing, erases one preference, and erases all when switched off', async () => {
    let kept: Item[] = [item('seat', 'aisle'), item('airlines', 'KQ,ET')];
    const { calls } = mockApi({
      'GET /v1/me/assistant-memory': () => json(memory(kept)),
      'PUT /v1/me/assistant-memory/home_airport': () =>
        json(
          {
            type: 'urn:suskii:problem:agent-memory-invalid',
            title: 'That is not a value this preference takes',
            status: 422,
          },
          422,
        ),
      'DELETE /v1/me/assistant-memory/seat': () => {
        kept = kept.filter((entry) => entry.key !== 'seat');
        return json(memory(kept));
      },
      'PUT /v1/me/assistant-memory': () => json(memory([], false)),
    });
    await renderWithApp(<AssistantMemoryScreen />, await signedInSession());

    expect(await screen.findByTestId('memory-airlines-value')).toHaveTextContent(/KQ, ET/);
    await fireEvent.changeText(screen.getByTestId('memory-home_airport-input'), 'QQQ');
    await fireEvent.press(screen.getByTestId('memory-home_airport-save'));
    expect(await screen.findByTestId('memory-home_airport-error')).toHaveTextContent(
      m.assistant.memory.errors.invalid,
    );

    await fireEvent.press(screen.getByTestId('memory-seat-erase'));
    await waitFor(() => expect(screen.queryByTestId('memory-seat-value')).toBeNull());
    expect(screen.getByTestId('memory-airlines-value')).toBeOnTheScreen();

    // The button says what switching off does.
    expect(screen.getByText(m.assistant.memory.turnOff)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('memory-off'));
    expect(await screen.findByTestId('memory-is-off')).toBeOnTheScreen();
    const off = calls.filter((call) => call.method === 'PUT').at(-1);
    expect(await off?.json()).toEqual({ enabled: false });
    expect(screen.queryByTestId('memory-airlines-value')).toBeNull();
  });

  it('says so while the assistant is switched off', async () => {
    mockApi({
      'GET /v1/me/assistant-memory': () =>
        json({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }, 404),
    });
    await renderWithApp(<AssistantMemoryScreen />, await signedInSession());

    expect(await screen.findByTestId('memory-unavailable')).toBeOnTheScreen();
  });
});
