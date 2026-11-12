import { Breadcrumbs } from '../breadcrumbs';

/** Breadcrumbs, heading and intro at the top of a Cars page (ADR-049). */
export function CarsHeader({
  heading,
  body,
  trail,
}: {
  heading: string;
  body?: string;
  trail: { name: string; path: string }[];
}) {
  return (
    <header className="flex flex-col gap-3">
      <Breadcrumbs items={trail} />
      <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
        {heading}
      </h1>
      {body ? <p className="font-body text-body text-foreground">{body}</p> : null}
    </header>
  );
}
