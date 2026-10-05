import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { ProfileScreen } from './profile-screen';

const m = getMessages('en-NG');
const preferences = {
  locale: null,
  currency: null,
  homeAirport: null,
  marketingConsent: false,
  marketingConsentAt: null,
};

describe('ProfileScreen', () => {
  it('saves the name, home airport and marketing consent', async () => {
    const saved: Record<string, unknown> = {};
    mockApi({
      'GET /v1/me/preferences': () => json(preferences),
      'PATCH /v1/me': async (request) => {
        saved.profile = await request.json();
        return json({
          id: '0192d3a0-7c1e-7b2a-9f00-00000000c001',
          email: 'ada@example.com',
          emailVerified: true,
          phone: '+2348012345678',
          phoneVerified: true,
          displayName: 'Ada N. Okafor',
          roles: ['customer'],
          mfaEnabled: false,
          hasPassword: true,
        });
      },
      'PATCH /v1/me/preferences': async (request) => {
        saved.preferences = await request.json();
        return json({ ...preferences, homeAirport: 'LOS', marketingConsent: true });
      },
    });
    const session = await signedInSession();
    await renderWithApp(<ProfileScreen />, session);

    await fireEvent.changeText(await screen.findByTestId('profile-name'), 'Ada N. Okafor');
    await fireEvent.changeText(screen.getByTestId('profile-home-airport'), 'los');
    await fireEvent.press(screen.getByTestId('profile-marketing'));
    await fireEvent.press(screen.getByTestId('profile-save'));

    expect(await screen.findByText(m.account.saved)).toBeOnTheScreen();
    expect(saved).toEqual({
      profile: { displayName: 'Ada N. Okafor' },
      preferences: { homeAirport: 'LOS', marketingConsent: true },
    });
    // The offline profile follows the change.
    expect(session.user?.displayName).toBe('Ada N. Okafor');
  });
});
