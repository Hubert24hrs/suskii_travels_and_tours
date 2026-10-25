import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { renderWithApp } from '../test/app';

import { ServerUnreachable } from './server-unreachable';

jest.mock('../config', () => ({
  appConfig: {
    variant: 'e2e',
    apiBaseUrl: 'http://localhost:4000',
    webBaseUrl: 'http://localhost:3000',
    customServer: false,
  },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG').mobile;

describe('ServerUnreachable in the test build', () => {
  it('tells the tester to run the stack and leads to Test server', async () => {
    const onRetry = jest.fn();
    await renderWithApp(<ServerUnreachable onRetry={onRetry} />);

    expect(screen.getByRole('alert', { name: m.home.unreachable })).toBeOnTheScreen();
    expect(screen.getByText(m.home.unreachableTestBuild)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('server-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('server-set-test-server'));
    expect(router.push).toHaveBeenCalledWith('/account');
  });
});
