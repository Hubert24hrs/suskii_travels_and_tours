import { afterEach, describe, expect, it } from 'vitest';

import { axeViolations } from './axe';

afterEach(() => {
  document.body.replaceChildren();
});

// Guards against a vacuous harness: axe must really evaluate contrast and names in this browser.
describe('axe harness', () => {
  it('reports insufficient colour contrast', async () => {
    const text = document.createElement('p');
    text.textContent = 'Low contrast text';
    text.style.color = 'rgb(191, 208, 220)';
    text.style.backgroundColor = 'rgb(255, 255, 255)';
    document.body.append(text);

    const ids = (await axeViolations()).map((violation) => violation.id);
    expect(ids).toContain('color-contrast');
  });

  it('reports buttons without an accessible name', async () => {
    document.body.append(document.createElement('button'));
    const ids = (await axeViolations()).map((violation) => violation.id);
    expect(ids).toContain('button-name');
  });
});
