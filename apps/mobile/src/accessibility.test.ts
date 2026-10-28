import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Source guard for the app's accessibility rules (docs/accessibility/wcag-2.2-aa.md): every
 * touchable has a role and a name screen readers can announce, choices announce their state the
 * way TalkBack and VoiceOver expect, text inputs carry a label, and nothing switches off the
 * system font size. Screen tests check behaviour; this catches a new control written without them.
 */

const ROOTS = [join(__dirname), join(__dirname, '..', '..', '..', 'packages', 'ui-native', 'src')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'test' ? [] : sources(path);
    return entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') ? [path] : [];
  });
}

interface Element {
  file: string;
  line: number;
  tag: string;
  /** The opening tag with its props. */
  open: string;
  /** What sits between the opening tag and its closing tag ('' when self-closing). */
  body: string;
}

/** Opening tags of `names`, with balanced braces, and their bodies up to the matching close. */
function elements(file: string, source: string, names: readonly string[]): Element[] {
  const found: Element[] = [];
  const pattern = new RegExp(`<(${names.join('|')})\\b`, 'g');
  for (const match of source.matchAll(pattern)) {
    const tag = match[1] ?? '';
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    const open = source.slice(match.index, end + 1);
    let body = '';
    if (!open.endsWith('/>')) {
      // Find the matching close, counting nested elements of the same tag.
      const nested = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
      nested.lastIndex = end + 1;
      let level = 1;
      for (let next = nested.exec(source); next; next = nested.exec(source)) {
        level += next[0].startsWith('</') ? -1 : 1;
        if (level === 0) {
          body = source.slice(end + 1, next.index);
          break;
        }
      }
    }
    found.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      tag,
      open,
      body,
    });
  }
  return found;
}

const has = (open: string, ...props: string[]): boolean =>
  props.some((prop) => new RegExp(`\\b${prop}=`).test(open));
/** A component that passes its props on (`{...props}`) gets them from its caller. */
const spreads = (open: string): boolean => /\{\s*\.\.\./.test(open);
const roleOf = (open: string): string | undefined =>
  /\b(?:accessibilityRole|role)="([a-z]+)"/.exec(open)?.[1];

const TOUCHABLES = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
] as const;

type Rule = (element: Element) => string | null;

const RULES: Record<'touchable' | 'input', Rule[]> = {
  touchable: [
    ({ open }) =>
      has(open, 'accessibilityRole', 'role') || spreads(open) ? null : 'touchable without a role',
    // A name comes from a label or from the text inside; an icon alone announces nothing.
    ({ open, body }) =>
      has(open, 'accessibilityLabel', 'aria-label') ||
      spreads(open) ||
      /<Text\b|<Card\b|\{children\}|\{label\}|\bt\(/.test(body)
        ? null
        : 'touchable without an accessible name',
    // TalkBack and VoiceOver announce "checked" for radios, checkboxes and switches; "selected"
    // is for tabs.
    ({ open }) => {
      const role = roleOf(open);
      if (role === 'radio' || role === 'checkbox' || role === 'switch') {
        return /accessibilityState=\{\{[^}]*\bchecked\b/.test(open)
          ? null
          : `${role} without accessibilityState.checked`;
      }
      if (role === 'tab') {
        return /accessibilityState=\{\{[^}]*\bselected\b/.test(open)
          ? null
          : 'tab without accessibilityState.selected';
      }
      return null;
    },
  ],
  input: [
    ({ open }) =>
      has(open, 'accessibilityLabel', 'aria-label', 'accessibilityLabelledBy') || spreads(open)
        ? null
        : 'text input without a label',
  ],
};

function problems(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const path of sources(root)) {
      const source = readFileSync(path, 'utf8');
      const file = relative(join(__dirname, '..', '..', '..'), path);
      if (source.includes('allowFontScaling={false}'))
        found.push(`${file}: allowFontScaling={false}`);
      const checks: [readonly string[], Rule[]][] = [
        [TOUCHABLES, RULES.touchable],
        [['TextInput'], RULES.input],
      ];
      for (const [names, rules] of checks) {
        for (const element of elements(file, source, names)) {
          for (const rule of rules) {
            const problem = rule(element);
            if (problem) found.push(`${element.file}:${element.line} ${problem}`);
          }
        }
      }
    }
  }
  return found;
}

describe('accessibility source guard', () => {
  it('finds the touchables and inputs it checks', () => {
    let touchables = 0;
    for (const root of ROOTS) {
      for (const path of sources(root)) {
        touchables += elements(path, readFileSync(path, 'utf8'), TOUCHABLES).length;
      }
    }
    expect(touchables).toBeGreaterThanOrEqual(25);
  });

  it('flags the mistakes it guards against', () => {
    const check = (source: string, names: readonly string[], rules: Rule[]) =>
      elements('x.tsx', source, names).flatMap((element) =>
        rules.map((rule) => rule(element)).filter(Boolean),
      );
    expect(
      check('<Pressable onPress={go}><Icon /></Pressable>', TOUCHABLES, RULES.touchable),
    ).toEqual(['touchable without a role', 'touchable without an accessible name']);
    expect(
      check(
        '<Pressable accessibilityRole="radio" accessibilityState={{ selected: on }}><Text>A</Text></Pressable>',
        TOUCHABLES,
        RULES.touchable,
      ),
    ).toEqual(['radio without accessibilityState.checked']);
    expect(
      check(
        '<Pressable accessibilityRole="button" accessibilityLabel={close} onPress={go}><X /></Pressable>',
        TOUCHABLES,
        RULES.touchable,
      ),
    ).toEqual([]);
    expect(check('<TextInput value={v} />', ['TextInput'], RULES.input)).toEqual([
      'text input without a label',
    ]);
  });

  it('every touchable has a role and a name, choices announce their state, inputs a label', () => {
    expect(problems()).toEqual([]);
  });
});
