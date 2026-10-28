import { getMessages } from '@suskii/i18n';
import type { Schemas } from '@suskii/api-client';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { StatusBanner } from '../components/status-banner';
import { json, mockApi, offline, renderWithApp } from '../test/app';

import { StatusScreen } from './status-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');

const incident = (patch: Partial<Schemas['StatusIncident']> = {}): Schemas['StatusIncident'] => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000f001',
  title: 'Card payments failing',
  impact: 'minor',
  status: 'investigating',
  components: ['payments'],
  startedAt: '2026-10-28T09:00:00.000Z',
  resolvedAt: null,
  updates: [
    {
      status: 'investigating',
      message: 'Some card payments fail. Bank transfers work.',
      createdAt: '2026-10-28T09:00:00.000Z',
    },
  ],
  ...patch,
});

const page = (patch: Partial<Schemas['StatusPage']> = {}): Schemas['StatusPage'] => ({
  state: 'operational',
  components: (['search', 'bookings', 'payments', 'accounts', 'support'] as const).map((id) => ({
    id,
    state: 'operational' as const,
  })),
  incidents: [],
  updatedAt: '2026-10-28T10:00:00.000Z',
  ...patch,
});

afterEach(() => {
  jest.mocked(router.push).mockClear();
});

describe('StatusScreen', () => {
  it('lists every part of the service as working when there is no incident', async () => {
    mockApi({ 'GET /v1/status': () => json(page()) });
    await renderWithApp(<StatusScreen />);
    expect(await screen.findByTestId('status-overall')).toHaveTextContent(
      m.status.overall.operational,
    );
    expect(screen.getByTestId('status-payments')).toHaveTextContent(m.status.states.operational, {
      exact: false,
    });
    expect(screen.getByText(m.status.noIncidents)).toBeOnTheScreen();
  });

  it('shows open and recent incidents with their updates and the affected parts', async () => {
    mockApi({
      'GET /v1/status': () =>
        json(
          page({
            state: 'degraded',
            components: page().components.map((component) =>
              component.id === 'payments' ? { ...component, state: 'degraded' } : component,
            ),
            incidents: [
              incident(),
              incident({
                id: '0192d3a0-7c1e-7b2a-9f00-00000000f002',
                title: 'Slow hotel search',
                components: ['search'],
                status: 'resolved',
                resolvedAt: '2026-10-27T12:00:00.000Z',
              }),
            ],
          }),
        ),
    });
    await renderWithApp(<StatusScreen />);
    expect(await screen.findByText(m.status.openHeading)).toBeOnTheScreen();
    expect(screen.getByTestId('status-payments')).toHaveTextContent(m.status.states.degraded, {
      exact: false,
    });
    expect(screen.getByText('Card payments failing')).toBeOnTheScreen();
    expect(screen.getByText('Slow hotel search')).toBeOnTheScreen();
    expect(screen.getAllByText('Some card payments fail. Bank transfers work.')).toHaveLength(2);
    expect(screen.getByText(`Affects: ${m.status.components.payments}`)).toBeOnTheScreen();
    expect(screen.queryByText(m.status.noIncidents)).toBeNull();
  });

  it('says it cannot load the status without a connection', async () => {
    mockApi({ 'GET /v1/status': offline });
    await renderWithApp(<StatusScreen />);
    expect(await screen.findByTestId('status-unavailable')).toHaveTextContent(
      m.status.unavailable,
      {
        exact: false,
      },
    );
  });
});

describe('StatusBanner', () => {
  it('names the major incident first and opens the status screen', async () => {
    mockApi({
      'GET /v1/status': () =>
        json(
          page({
            incidents: [
              incident(),
              incident({
                id: '0192d3a0-7c1e-7b2a-9f00-00000000f003',
                title: 'Sign-in not working',
                impact: 'major',
                components: ['accounts'],
              }),
            ],
          }),
        ),
    });
    await renderWithApp(<StatusBanner />);
    const banner = await screen.findByTestId('status-banner');
    expect(banner).toHaveTextContent(/Sign-in not working/);
    await fireEvent.press(banner);
    expect(router.push).toHaveBeenCalledWith('/status');
  });

  it('shows nothing while all is well, for resolved incidents or when the API is down', async () => {
    mockApi({
      'GET /v1/status': () =>
        json(page({ incidents: [incident({ resolvedAt: '2026-10-28T11:00:00.000Z' })] })),
    });
    const client = await renderWithApp(<StatusBanner />);
    await client.refetchQueries({ queryKey: ['status'] });
    expect(screen.queryByTestId('status-banner')).toBeNull();

    mockApi({ 'GET /v1/status': offline });
    await client.refetchQueries({ queryKey: ['status'] });
    expect(screen.queryByTestId('status-banner')).toBeNull();
  });
});
