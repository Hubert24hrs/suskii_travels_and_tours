import { isDisposableEmail } from './disposable-domains';
import { emailKey, networkPrefix } from './referrals.service';

describe('referral signals', () => {
  it('maps Gmail aliases and plus addresses to one mailbox', () => {
    expect(emailKey('Ada.Obi+travel@gmail.com')).toBe('adaobi@gmail.com');
    expect(emailKey('adaobi@googlemail.com')).toBe('adaobi@gmail.com');
    expect(emailKey('ada.obi+x@example.com')).toBe('ada.obi@example.com');
  });

  it('groups addresses by /24 or /48', () => {
    expect(networkPrefix('102.89.34.7')).toBe('102.89.34');
    expect(networkPrefix('::ffff:102.89.34.7')).toBe('102.89.34');
    expect(networkPrefix('2c0f:f5c0:440:1::1')).toBe('2c0f:f5c0:440');
    expect(networkPrefix('unknown')).toBeNull();
  });

  it('knows common throwaway mailbox domains', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@example.com')).toBe(false);
  });
});
