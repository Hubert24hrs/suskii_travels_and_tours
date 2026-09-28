/** Formats a font stack for CSS, quoting family names that contain spaces. */
export function cssFontStack(families: readonly string[]): string {
  return families
    .map((family) =>
      family.startsWith('var(') || family.startsWith('"') || !family.includes(' ')
        ? family
        : `"${family}"`,
    )
    .join(', ');
}

export const px = (value: number): string => `${value}px`;
export const ms = (value: number): string => `${value}ms`;
