# @suskii/design-tokens

**Built in phase 1.** Not a workspace yet (no `package.json`), so pnpm and Turborepo ignore it.

Will contain the design tokens from `PROJECT_SPEC.json#/design_system/tokens` as typed TypeScript,
plus a generated Tailwind preset (web and NativeWind) and CSS custom properties, with an automated
WCAG 2.2 AA contrast test. It is the single source of truth for colour, type, spacing, radius,
shadow, breakpoints and motion.
