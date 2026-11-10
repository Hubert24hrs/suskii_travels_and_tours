import type { AgentName } from '@suskii/shared';

/**
 * What needs no model (ADR-106): a bare greeting, and the few requests whose words leave no
 * doubt where they go. Everything else is the router model's to decide. The rules are narrow on
 * purpose: a wrong shortcut costs more than a cheap model call.
 */

const GREETINGS: readonly RegExp[] = [
  /^(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening|day)|greetings|yo|howdy)$/,
  /^(?:how far|how you dey|wetin dey happen|good morning o|hello o)$/,
  /^(?:bonjour|bonsoir|salut|coucou)$/,
  /^(?:ol[aá]|oi|bom dia|boa tarde|boa noite)$/,
  /^(?:habari|hujambo|jambo|mambo|shikamoo|salama|habari yako|habari za asubuhi)$/,
  /^(?:مرحبا|مرحباً|أهلا|أهلاً|السلام عليكم|سلام|صباح الخير|مساء الخير)$/,
];

/** Lower case, without punctuation, emoji or repeated spaces. */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True for a message that only greets: nothing to route, nothing to look up. */
export function isGreeting(text: string): boolean {
  const words = plain(text);
  return words.length > 0 && words.length <= 40 && GREETINGS.some((pattern) => pattern.test(words));
}

/**
 * A phrase as a whole: `\b` only knows ASCII letters, so "annulé" would have no end. These
 * boundaries know every script.
 */
const phrase = (...alternatives: string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'u');

const OBVIOUS: readonly [AgentName, RegExp][] = [
  [
    'support',
    phrase(
      '(?:talk|speak|chat) (?:to|with) (?:a |an |one )?(?:human|person|agent|representative|someone|staff)',
      '(?:real|live) (?:person|human|agent)',
      'parler (?:à|avec) (?:un|une) (?:conseiller|conseillère|humain|personne|agent)',
      'falar com (?:um|uma) (?:pessoa|atendente|humano|agente)',
      '(?:nataka|naomba) kuongea na mtu',
      'التحدث (?:مع|إلى) (?:موظف|شخص)',
    ),
  ],
  [
    'bookings',
    phrase(
      '(?:track|find|show|see|view|check) my (?:booking|bookings|trip|trips|ticket|tickets|reservation|itinerary)',
      '(?:where is|status of) my (?:booking|ticket|reservation)',
      '(?:voir|suivre) (?:ma|mes) réservations?',
      '(?:ver|acompanhar) (?:a |as )?minhas? reservas?',
      'uhifadhi wangu',
      'حجزي',
      'حجوزاتي',
    ),
  ],
  [
    'disruption',
    phrase(
      'my flight (?:is|was|has been|got) (?:delayed|cancell?ed|rescheduled|diverted)',
      'mon vol (?:est|a été) (?:retardé|annulé)',
      '(?:o )?meu voo (?:foi|está) (?:atrasado|cancelado)',
      'ndege yangu (?:imechelewa|imeghairiwa)',
      'رحلتي (?:تأخرت|ألغيت)',
    ),
  ],
];

/**
 * The specialist a message plainly belongs to, or null. A message that matches two rules is
 * not obvious: the router model reads it.
 */
export function obviousAgent(text: string): AgentName | null {
  const words = plain(text);
  const matches = OBVIOUS.filter(([, pattern]) => pattern.test(words)).map(([agent]) => agent);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
