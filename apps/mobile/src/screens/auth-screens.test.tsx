import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { guestSession, json, mockApi, renderWithApp, USER_ID } from '../test/app';

import { RegisterScreen, SignInScreen } from './auth-screens';

const m = getMessages('en-NG');

const signedIn = {
  status: 'authenticated',
  sessionId: '0192d3a0-7c1e-7b2a-9f00-00000000c002',
  accessTokenExpiresAt: '2026-10-05T10:15:00.000Z',
  refreshTokenExpiresAt: '2026-11-04T10:00:00.000Z',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: USER_ID,
    email: null,
    emailVerified: false,
    phone: '+2348012345678',
    phoneVerified: true,
    displayName: null,
    roles: ['customer'],
    mfaEnabled: false,
    hasPassword: false,
  },
};

describe('SignInScreen with a phone code', () => {
  afterEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
  });

  it('texts a code, then signs in with it and keeps the invite code from the link', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ ref: 'k7q2-mxra' });
    const { calls } = mockApi({
      'POST /v1/auth/otp/request': () =>
        json({ status: 'accepted', expiresInSeconds: 300, resendAfterSeconds: 60 }, 202),
      'POST /v1/auth/otp/verify': () => json(signedIn),
    });
    const session = guestSession();
    await renderWithApp(<SignInScreen />, session);

    await fireEvent.press(screen.getByTestId('sign-in-switch'));
    await fireEvent.changeText(screen.getByTestId('sign-in-phone'), '+234 801 234 5678');
    await fireEvent.press(screen.getByTestId('sign-in-send-code'));

    expect(
      await screen.findByText(m.auth.signIn.codeSent.replace('{phone}', '+2348012345678')),
    ).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '123456');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(session.signedIn).toBe(true);
    expect(await calls[0]?.json()).toEqual({ phone: '+2348012345678' });
    expect(await calls[1]?.json()).toEqual({
      phone: '+2348012345678',
      code: '123456',
      transport: 'token',
      referralCode: 'K7Q2MXRA',
    });
  });

  it('checks the number before calling the API and explains a wrong code', async () => {
    const { calls } = mockApi({
      'POST /v1/auth/otp/request': () =>
        json({ status: 'accepted', expiresInSeconds: 300, resendAfterSeconds: 60 }, 202),
      'POST /v1/auth/otp/verify': () =>
        json({ type: 'urn:suskii:problem:invalid-code', title: 'Invalid', status: 401 }, 401),
    });
    await renderWithApp(<SignInScreen />);

    await fireEvent.press(screen.getByTestId('sign-in-switch'));
    await fireEvent.changeText(screen.getByTestId('sign-in-phone'), '0801 234 5678');
    await fireEvent.press(screen.getByTestId('sign-in-send-code'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.auth.phoneInvalid);
    expect(calls).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('sign-in-phone'), '+2348012345678');
    await fireEvent.press(screen.getByTestId('sign-in-send-code'));
    await fireEvent.changeText(await screen.findByTestId('sign-in-code'), '000000');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.auth.codeInvalid);
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('RegisterScreen', () => {
  afterEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
  });

  it('sends the invite code from the link with the registration', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ ref: 'K7Q2MXRA' });
    const { calls } = mockApi({
      'POST /v1/auth/register': () => json({ status: 'accepted' }, 202),
    });
    await renderWithApp(<RegisterScreen />);

    expect(screen.getByTestId('register-referral')).toHaveDisplayValue('K7Q2MXRA');
    await fireEvent.changeText(screen.getByTestId('register-email'), 'ada@example.com');
    await fireEvent.changeText(
      screen.getByTestId('register-password'),
      'a perfectly long passphrase',
    );
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByText(m.mobile.auth.registered)).toBeOnTheScreen();
    const register = calls.find((request) => request.url.endsWith('/v1/auth/register'));
    expect(await register?.json()).toEqual({
      email: 'ada@example.com',
      password: 'a perfectly long passphrase',
      referralCode: 'K7Q2MXRA',
    });
  });

  it('refuses a malformed invite code without calling the API', async () => {
    const { calls } = mockApi({});
    await renderWithApp(<RegisterScreen />);

    await fireEvent.changeText(screen.getByTestId('register-email'), 'ada@example.com');
    await fireEvent.changeText(
      screen.getByTestId('register-password'),
      'a perfectly long passphrase',
    );
    await fireEvent.changeText(screen.getByTestId('register-referral'), 'NOT-A-CODE');
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.auth.referralInvalid);
    expect(calls).toHaveLength(0);
  });
});
