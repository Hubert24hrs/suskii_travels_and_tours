import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { biometrics } from '../lib/biometric';
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
    const sent = calls.filter((request) => request.url.includes('/v1/auth/otp/'));
    expect(await sent[0]?.json()).toEqual({ phone: '+2348012345678' });
    expect(await sent[1]?.json()).toEqual({
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
    expect(calls.filter((request) => !request.url.includes('/social/providers'))).toHaveLength(0);

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

  it('sends the invite code with the registration, then signs straight in', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ ref: 'K7Q2MXRA' });
    const { calls } = mockApi({
      'POST /v1/auth/register': () => json({ status: 'accepted' }, 202),
      'POST /v1/auth/login': () => json(signedIn),
    });
    const session = guestSession();
    await renderWithApp(<RegisterScreen />, session);

    expect(screen.getByTestId('register-referral')).toHaveDisplayValue('K7Q2MXRA');
    await fireEvent.changeText(screen.getByTestId('register-email'), 'ada@example.com');
    await fireEvent.changeText(
      screen.getByTestId('register-password'),
      'a perfectly long passphrase',
    );
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(session.signedIn).toBe(true);
    const register = calls.find((request) => request.url.endsWith('/v1/auth/register'));
    expect(await register?.json()).toEqual({
      email: 'ada@example.com',
      password: 'a perfectly long passphrase',
      referralCode: 'K7Q2MXRA',
    });
    const login = calls.find((request) => request.url.endsWith('/v1/auth/login'));
    expect(await login?.json()).toEqual({
      email: 'ada@example.com',
      password: 'a perfectly long passphrase',
      transport: 'token',
    });
  });

  it('says so when the email already had an account with another password', async () => {
    mockApi({
      'POST /v1/auth/register': () => json({ status: 'accepted' }, 202),
      'POST /v1/auth/login': () =>
        json({ type: 'urn:suskii:problem:invalid-credentials', title: 'x', status: 401 }, 401),
    });
    await renderWithApp(<RegisterScreen />);

    await fireEvent.changeText(screen.getByTestId('register-email'), 'ada@example.com');
    await fireEvent.changeText(
      screen.getByTestId('register-password'),
      'a perfectly long passphrase',
    );
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.auth.registeredExisting);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('explains a password the API refuses as too easy to guess', async () => {
    mockApi({
      'POST /v1/auth/register': () =>
        json(
          {
            type: 'urn:suskii:problem:password-guessable',
            title: 'Choose a different password',
            status: 422,
          },
          422,
        ),
    });
    await renderWithApp(<RegisterScreen />);

    await fireEvent.changeText(screen.getByTestId('register-email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'suskii forever and ever');
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.auth.register.breached);
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
    expect(calls.filter((request) => !request.url.includes('/social/providers'))).toHaveLength(0);
  });
});

describe('Google and Apple on the test server (mock provider)', () => {
  it('signs up with the email the tester types, through the same sign-in route', async () => {
    const { calls } = mockApi({
      'GET /v1/auth/social/providers': () => json({ google: true, apple: true, mock: true }),
      'POST /v1/auth/social/nonce': () =>
        json({ nonce: 'n'.repeat(43), expiresAt: '2026-10-27T12:10:00.000Z' }),
      'POST /v1/auth/social/mock-token': () => json({ idToken: 'mock.id.token' }),
      'POST /v1/auth/google': () => json(signedIn),
    });
    const session = guestSession();
    await renderWithApp(<RegisterScreen />, session);

    await fireEvent.press(await screen.findByTestId('social-google'));
    expect(screen.getByText(m.auth.social.mockIntro)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('social-mock-email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('social-mock-name'), 'Ada Okafor');
    await fireEvent.press(screen.getByTestId('social-mock-submit'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(session.signedIn).toBe(true);
    const minted = calls.find((request) => request.url.endsWith('/mock-token'));
    expect(await minted?.json()).toEqual({
      provider: 'google',
      email: 'ada@example.com',
      name: 'Ada Okafor',
      nonce: 'n'.repeat(43),
    });
    const google = calls.find((request) => request.url.endsWith('/v1/auth/google'));
    expect(await google?.json()).toEqual({
      idToken: 'mock.id.token',
      nonce: 'n'.repeat(43),
      transport: 'token',
    });
  });

  it('shows no provider buttons when the API offers none', async () => {
    mockApi({
      'GET /v1/auth/social/providers': () => json({ google: false, apple: false, mock: false }),
    });
    await renderWithApp(<SignInScreen />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('social-google')).toBeNull();
  });
});

describe('fingerprint sign-in', () => {
  const credential = {
    credentialId: '0192d3a0-7c1e-7b2a-9f00-0000000000d1',
    secret: 's'.repeat(43),
  };

  beforeEach(() => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true);
  });
  afterEach(async () => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false);
    await biometrics.forget();
  });

  async function signInWithPassword() {
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'a long passphrase');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
  }

  it('is offered after signing in with a password and turns on behind the prompt', async () => {
    const { calls } = mockApi({
      'POST /v1/auth/login': () => json(signedIn),
      'POST /v1/me/device-credentials': () => json(credential, 201),
    });
    await renderWithApp(<SignInScreen />, guestSession());

    await signInWithPassword();
    expect(await screen.findByTestId('fingerprint-offer')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('fingerprint-enable'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(biometrics.credentialId()).toBe(credential.credentialId);
    const enrolled = calls.find((request) => request.url.endsWith('/v1/me/device-credentials'));
    expect(await enrolled?.json()).toEqual({ label: 'iPhone' });
    // Behind the biometric prompt, on this device only.
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'auth.device-credential',
      JSON.stringify(credential),
      expect.objectContaining({ requireAuthentication: true }),
    );
  });

  it('signs in with the fingerprint once it is on', async () => {
    await biometrics.save(credential, 'prompt');
    const { calls } = mockApi({ 'POST /v1/auth/device': () => json(signedIn) });
    const session = guestSession();
    await renderWithApp(<SignInScreen />, session);

    await fireEvent.press(screen.getByTestId('sign-in-fingerprint'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(session.signedIn).toBe(true);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
      'auth.device-credential',
      expect.objectContaining({ requireAuthentication: true }),
    );
    const device = calls.find((request) => request.url.endsWith('/v1/auth/device'));
    expect(await device?.json()).toEqual({ ...credential, transport: 'token' });
    // Already on: no offer after signing in this way.
    expect(screen.queryByTestId('fingerprint-offer')).toBeNull();
  });

  it('forgets a credential the API no longer accepts and says what to do', async () => {
    await biometrics.save(credential, 'prompt');
    mockApi({
      'POST /v1/auth/device': () =>
        json({ type: 'urn:suskii:problem:invalid-credentials', title: 'x', status: 401 }, 401),
    });
    await renderWithApp(<SignInScreen />, guestSession());

    await fireEvent.press(screen.getByTestId('sign-in-fingerprint'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.auth.fingerprint.expired);
    expect(biometrics.enabled()).toBe(false);
  });

  it('is not offered on a phone without a fingerprint', async () => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false);
    mockApi({ 'POST /v1/auth/login': () => json(signedIn) });
    await renderWithApp(<SignInScreen />, guestSession());

    await signInWithPassword();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(screen.queryByTestId('fingerprint-offer')).toBeNull();
  });
});
