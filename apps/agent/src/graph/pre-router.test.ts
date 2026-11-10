import { describe, expect, it } from 'vitest';

import { isGreeting, obviousAgent } from './pre-router.js';

describe('the rule-based pre-router (ADR-106)', () => {
  it('knows a bare greeting in the languages travellers write in', () => {
    for (const text of [
      'Hi',
      'hello!!',
      'Good morning',
      'Bonjour',
      'Olá',
      'Bom dia',
      'Habari',
      'مرحبا',
      'السلام عليكم',
      'How far?',
      'How you dey',
    ]) {
      expect([text, isGreeting(text)]).toEqual([text, true]);
    }
  });

  it('does not take a greeting with a question for a greeting', () => {
    for (const text of [
      'Hi, I need a flight to Abuja',
      'Hello, where is my ticket?',
      'Bonjour, je cherche un hôtel',
      '',
      'history of Lagos',
    ]) {
      expect([text, isGreeting(text)]).toEqual([text, false]);
    }
  });

  it('routes only what leaves no doubt', () => {
    expect(obviousAgent('Please track my booking')).toBe('bookings');
    expect(obviousAgent('Je veux voir mes réservations')).toBe('bookings');
    expect(obviousAgent('I want to talk to a human')).toBe('support');
    expect(obviousAgent('Quero falar com um atendente')).toBe('support');
    expect(obviousAgent('My flight was cancelled!')).toBe('disruption');
    expect(obviousAgent('Mon vol a été annulé')).toBe('disruption');

    expect(obviousAgent('Flights to Abuja on Friday')).toBeNull();
    expect(obviousAgent('How much is a hotel in Accra?')).toBeNull();
    // Two rules at once is not obvious: the router model reads it.
    expect(obviousAgent('My flight was cancelled, let me speak to a person')).toBeNull();
  });
});
