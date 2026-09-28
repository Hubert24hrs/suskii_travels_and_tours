import { BRAND } from '@suskii/shared';
import { Card } from '@suskii/ui-web';

// Token-styled shell; the full homepage is built in phase 4.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-page items-center px-4 py-12">
      <Card className="w-full p-6 md:p-10">
        <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
          {BRAND.shortName}
        </h1>
      </Card>
    </main>
  );
}
