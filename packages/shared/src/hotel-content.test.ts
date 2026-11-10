import { describe, expect, it } from 'vitest';

import { isSafePhotoUrl, plainDescription } from './hotel-content';

describe('plainDescription', () => {
  it('strips markup and entities and collapses whitespace', () => {
    expect(
      plainDescription('<p>Rooms &amp; suites<br/>by the   lagoon.</p><script>x()</script>', 200),
    ).toBe('Rooms & suites by the lagoon. x()');
    expect(plainDescription('  ', 200)).toBeNull();
    expect(plainDescription(null, 200)).toBeNull();
    expect(plainDescription('<b></b>', 200)).toBeNull();
  });

  it('cuts at a sentence when one ends in the second half, else at a word', () => {
    const text =
      'A quiet hotel near the airport. It has a pool and a gym. Breakfast is served daily.';
    expect(plainDescription(text, 60)).toBe(
      'A quiet hotel near the airport. It has a pool and a gym.',
    );
    expect(plainDescription('Overlooking the waterfront promenade and marina', 30)).toBe(
      'Overlooking the waterfront…',
    );
    expect(plainDescription(text, 500)).toBe(text);
  });
});

describe('isSafePhotoUrl', () => {
  it('takes https URLs with a host and nothing else', () => {
    expect(isSafePhotoUrl('https://photos.example.com/h/1.jpg')).toBe(true);
    expect(isSafePhotoUrl('http://photos.example.com/h/1.jpg')).toBe(false);
    expect(isSafePhotoUrl('https://user:pass@photos.example.com/1.jpg')).toBe(false);
    expect(isSafePhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePhotoUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafePhotoUrl('/art/hotels/a.svg')).toBe(false);
    expect(isSafePhotoUrl(`https://x.example/${'a'.repeat(600)}`)).toBe(false);
    expect(isSafePhotoUrl(null)).toBe(false);
  });
});
