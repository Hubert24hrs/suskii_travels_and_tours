import { composeStories } from '@storybook/react-vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import * as badge from '../components/badge.stories';
import * as button from '../components/button.stories';
import * as dealCard from '../components/deal-card.stories';
import * as destinationCard from '../components/destination-card.stories';
import * as filterChip from '../components/filter-chip.stories';
import * as input from '../components/input.stories';
import * as segmentedControl from '../components/segmented-control.stories';
import * as trustBar from '../components/trust-bar.stories';

type StoriesModule = Parameters<typeof composeStories>[0];
interface RunnableStory {
  run: () => Promise<void>;
}

/** The components every page is built from; overlays are covered by the axe and interaction suites. */
const MODULES: Record<string, StoriesModule> = {
  badge,
  button,
  'deal-card': dealCard,
  'destination-card': destinationCard,
  'filter-chip': filterChip,
  input,
  'segmented-control': segmentedControl,
  'trust-bar': trustBar,
};

beforeAll(() => {
  // Spinners and transitions would make every capture different.
  const style = document.createElement('style');
  style.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.append(style);
});

describe.each(Object.entries(MODULES))('%s', (name, module) => {
  const stories = Object.entries<RunnableStory>(composeStories(module));
  it.each(stories)('%s looks as approved', async (story, Story) => {
    await Story.run();
    await document.fonts.ready;
    await expect.element(page.elementLocator(document.body)).toMatchScreenshot(`${name}-${story}`);
  });
});
