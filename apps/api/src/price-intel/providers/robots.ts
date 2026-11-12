/**
 * The part of the Robots Exclusion Protocol (RFC 9309) the direct fetcher needs: the group for
 * our own token, or else the group for everyone, and its Allow and Disallow rules with `*` and
 * `$`. The longest matching rule decides; an Allow wins a tie.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

const NO_RULES: RobotsRules = { allow: [], disallow: [] };

export function parseRobots(text: string, token: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.rules.allow.push(value);
    // An empty Disallow allows everything: it is no rule.
    if (field === 'disallow' && value) current.rules.disallow.push(value);
  }
  const mine = token.toLowerCase();
  const own = groups.filter((group) => group.agents.some((agent) => agent === mine));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  return chosen.reduce<RobotsRules>(
    (merged, group) => ({
      allow: [...merged.allow, ...group.rules.allow],
      disallow: [...merged.disallow, ...group.rules.disallow],
    }),
    NO_RULES,
  );
}

/** How much of `path` a rule matches: its length, or -1 when it does not match. */
function matchLength(rule: string, path: string): number {
  const anchored = rule.endsWith('$');
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path) ? rule.length : -1;
}

/** Whether the rules let `path` (with its query) be fetched. */
export function robotsAllow(rules: RobotsRules, path: string): boolean {
  const best = (list: readonly string[]): number =>
    list.reduce((longest, rule) => Math.max(longest, matchLength(rule, path)), -1);
  const disallowed = best(rules.disallow);
  if (disallowed < 0) return true;
  return best(rules.allow) >= disallowed;
}
