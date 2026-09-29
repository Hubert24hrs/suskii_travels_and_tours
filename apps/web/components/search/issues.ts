import type { Translator } from '@suskii/i18n';

import type { SearchMessages } from './search-messages';

type IssueKey = keyof SearchMessages['search']['issues'];

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
  'end_before_start',
  'month_in_past',
  'budget_min_above_max',
  'same_nationality_destination',
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

/**
 * Maps shared-schema issues to one translated message per field ("legs.1.origin"). Issue codes
 * from @suskii/shared get their own message; built-in Zod messages become "required" when the
 * field is empty and "check this field" otherwise.
 */
export function toFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  input: unknown,
  t: Translator<SearchMessages>['t'],
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

/**
 * Focuses the first invalid field that exists on the page. Field ids follow the keys
 * (`legs.1.origin` -> `flight-legs-1-origin`); a nested key falls back to its parent field
 * (`travellers.infants` -> `flight-travellers`), and comboboxes are focused through their input.
 */
export function focusFirstError(errors: FieldErrors, prefix: string): void {
  for (const key of Object.keys(errors)) {
    const parts = key.split('.');
    for (let length = parts.length; length > 0; length -= 1) {
      const base = `${prefix}-${parts.slice(0, length).join('-')}`;
      const element = document.getElementById(`${base}-input`) ?? document.getElementById(base);
      if (element) {
        element.focus();
        return;
      }
    }
  }
}
