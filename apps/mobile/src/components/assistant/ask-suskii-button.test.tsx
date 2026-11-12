import { getMessages } from '@suskii/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { askSuskii } from '../../lib/ask-suskii';
import { json, mockApi, renderWithApp } from '../../test/app';

import {
  ASK_SUSKII_PLACES,
  ASK_SUSKII_REST_MS,
  AskSuskiiButton,
  nextPlace,
  showsAskSuskii,
} from './ask-suskii-button';

const m = getMessages('en-NG');
const pathname = usePathname as jest.Mock;
const available = () => json({ enabled: true, paused: false, available: true });

/**
 * The router's path as a real piece of state, so that opening another screen draws the button
 * again as it does in the app. Returns the function that opens a screen.
 */
function navigable(): (path: string) => void {
  let go: (path: string) => void = () => undefined;
  pathname.mockImplementation(() => {
    const [path, setPath] = useState('/');
    go = setPath;
    return path;
  });
  return (path) => go(path);
}

/** The place the button is in now, read from the id of the view that carries it. */
const placeNow = (): string =>
  String(screen.getByTestId(/^ask-suskii-at-/).props.testID).replace('ask-suskii-at-', '');

describe('AskSuskiiButton (ADR-109)', () => {
  let reduceMotion: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    askSuskii.reset();
    pathname.mockReset();
    pathname.mockReturnValue('/');
    // Most cases look at what the button is, not how it travels: no glide to wait for.
    reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is one button named "Ask Suskii" that opens the assistant', async () => {
    mockApi({ 'GET /v1/agent/status': available });
    await renderWithApp(<AskSuskiiButton />);

    const button = await screen.findByTestId('ask-suskii');
    expect(m.assistant.open).toBe('Ask Suskii');
    expect(button).toHaveTextContent('Ask Suskii');
    expect(button.props.accessibilityLabel).toBe('Ask Suskii');
    expect(screen.getAllByTestId('ask-suskii')).toHaveLength(1);

    await fireEvent.press(button);
    expect(router.push).toHaveBeenCalledWith('/assistant');
  });

  it('shows nothing while the assistant is off, paused or cannot be read', async () => {
    for (const answer of [
      () => json({ enabled: false, paused: false, available: false }),
      () => json({ enabled: true, paused: true, available: false }),
      () => json({ title: 'Unavailable' }, 503),
    ]) {
      const { calls } = mockApi({ 'GET /v1/agent/status': answer });
      const view = await renderWithApp(<AskSuskiiButton />);
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(screen.queryByTestId('ask-suskii')).toBeNull();
      view.unmount();
    }
  });

  it('keeps off the assistant, sign-in, payment, trip and account screens', async () => {
    mockApi({ 'GET /v1/agent/status': available });
    for (const path of [
      '/assistant',
      '/assistant/preferences',
      '/checkout/0192d3a0-7c1e-7b2a-9f00-00000000a501',
      '/sign-in',
      '/register',
      '/trips/0192d3a0-7c1e-7b2a-9f00-00000000a301',
      '/trips/built/0192d3a0-7c1e-7b2a-9f00-00000000a302',
      '/rides/0192d3a0-7c1e-7b2a-9f00-00000000a303',
      '/account/privacy',
      '/support',
      '/driver',
      '/operator/scan',
    ]) {
      expect([path, showsAskSuskii(path)]).toEqual([path, false]);
    }
    for (const path of ['/', '/trips', '/account', '/search/flights', '/hotels/abc', '/cars']) {
      expect([path, showsAskSuskii(path)]).toEqual([path, true]);
    }

    pathname.mockReturnValue('/checkout/0192d3a0-7c1e-7b2a-9f00-00000000a501');
    const { calls } = mockApi({ 'GET /v1/agent/status': available });
    await renderWithApp(<AskSuskiiButton />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('ask-suskii')).toBeNull();
  });

  it('never picks the place it is already in', () => {
    for (let current = 0; current < ASK_SUSKII_PLACES; current += 1) {
      for (const roll of [0, 0.34, 0.67, 0.999]) {
        const next = nextPlace(current, () => roll);
        expect(next).not.toBe(current);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(ASK_SUSKII_PLACES);
      }
    }
  });

  it('moves on after a rest, and to another place when another screen opens', async () => {
    reduceMotion.mockResolvedValue(false);
    jest.useFakeTimers();
    const open = navigable();
    mockApi({ 'GET /v1/agent/status': available });
    await renderWithApp(<AskSuskiiButton />);
    await screen.findByTestId('ask-suskii');
    const first = placeNow();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(ASK_SUSKII_REST_MS + 50);
    });
    const second = placeNow();
    expect(second).not.toBe(first);

    await act(async () => {
      open('/search/flights');
      await Promise.resolve();
    });
    expect(placeNow()).not.toBe(second);
    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
  });

  it('holds still for someone who asked for less motion, and still changes place between screens', async () => {
    jest.useFakeTimers();
    const open = navigable();
    mockApi({ 'GET /v1/agent/status': available });
    await renderWithApp(<AskSuskiiButton />);
    await screen.findByTestId('ask-suskii');
    const first = placeNow();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(ASK_SUSKII_REST_MS * 3);
    });
    expect(placeNow()).toBe(first);

    await act(async () => {
      open('/hotels/abc');
      await Promise.resolve();
    });
    expect(placeNow()).not.toBe(first);
  });

  it('can be put away until the app starts again', async () => {
    mockApi({ 'GET /v1/agent/status': available });
    await renderWithApp(<AskSuskiiButton />);
    const hide = await screen.findByTestId('ask-suskii-hide');
    expect(hide.props.accessibilityLabel).toBe(m.assistant.hide);
    await fireEvent.press(hide);
    expect(screen.queryByTestId('ask-suskii')).toBeNull();
    // Account offers the assistant while the button is away.
    expect(askSuskii.isAway()).toBe(true);
  });
});
