import { composeStories } from '@storybook/react-vite';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { axeViolations, formatViolations } from './axe';

type StoriesModule = Parameters<typeof composeStories>[0];
interface RunnableStory {
  run: () => Promise<void>;
}

const modules = import.meta.glob<StoriesModule>('../components/*.stories.tsx', { eager: true });

const VIEWPORTS = {
  mobile: { width: 360, height: 800 },
  desktop: { width: 1280, height: 900 },
} as const;

/**
 * Acceptance criterion "axe checks pass in Storybook": every story is rendered (and its play
 * function run, so open popovers and dialogs are checked too) at mobile and desktop widths.
 */
describe.each(Object.entries(VIEWPORTS))('stories at %s width', (_name, viewport) => {
  for (const [path, module] of Object.entries(modules)) {
    const stories = Object.entries<RunnableStory>(composeStories(module));
    describe(path.replace('../components/', ''), () => {
      it.each(stories)('%s has no WCAG A/AA violations', async (_story, Story) => {
        await page.viewport(viewport.width, viewport.height);
        await Story.run();
        const violations = await axeViolations();
        expect(violations, formatViolations(violations)).toEqual([]);
      });
    });
  }
});
