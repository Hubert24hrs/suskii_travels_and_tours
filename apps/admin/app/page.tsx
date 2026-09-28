import { BRAND } from '@suskii/shared';
import { Card } from '@suskii/ui-web';

// Minimal shell until the RBAC-gated console lands in phase 10.
export default function AdminHomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-page items-center px-4 py-12">
      <Card className="w-full p-6">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {BRAND.shortName} Admin
        </h1>
      </Card>
    </main>
  );
}
