import { BRAND } from '@suskii/shared';

// Unstyled on purpose: styling arrives with design tokens in phase 1 and the
// full homepage in phase 4. No colours, radii or font sizes are hardcoded.
export default function HomePage() {
  return (
    <main>
      <h1>{BRAND.shortName}</h1>
    </main>
  );
}
