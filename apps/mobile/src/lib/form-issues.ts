import type { Messages, Translator } from '@suskii/i18n';

type IssueKey = keyof Messages['search']['issues'];

const KNOWN = new Set<string>([
  'same_origin_destination',
  'date_in_past',
  'date_too_far',
  'return_before_departure',
  'legs_not_chronological',
  'infants_exceed_adults',
  'too_many_travellers',
  'check_out_not_after_check_in',
  'stay_too_long',
]);

const valueAt = (input: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined,
    input,
  );

export type FieldErrors = Record<string, string>;

/** Shared-schema issues to one message per field path ("legs.1.origin"), like the web forms. */
export function toFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  input: unknown,
  t: Translator<Messages>['t'],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    if (errors[key]) continue;
    if (KNOWN.has(issue.message)) {
      errors[key] = t(`search.issues.${issue.message as IssueKey}`);
      continue;
    }
    const value = valueAt(input, issue.path);
    errors[key] = t(
      value === '' || value === null || value === undefined
        ? 'search.issues.required'
        : 'search.issues.invalid',
    );
  }
  return errors;
}
