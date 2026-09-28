import { BRAND } from '@suskii/shared';

// Minimal shell until the RBAC-gated console lands in phase 10.
// Unstyled on purpose: design tokens arrive in phase 1.
export default function AdminHomePage() {
  return (
    <main>
      <h1>{BRAND.shortName} Admin</h1>
    </main>
  );
}
