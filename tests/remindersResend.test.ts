import { describe, it, expect } from 'vitest';
import { lastRemindersBatch, remindersDeepLink } from '../src/lib/shopStores';

describe('reminders re-send', () => {
  const nov9 = new Date('2026-11-09T22:51:18.848Z');
  const nov11 = new Date('2026-11-11T18:57:10.048Z');

  it('is empty when nothing went to Reminders', () => {
    expect(lastRemindersBatch([])).toEqual([]);
    expect(
      lastRemindersBatch([{ name: 'gold potatoes', dest: 'wegmans', pushedAt: nov11 }]),
    ).toEqual([]);
  });

  it('re-sends only the newest Reminders push, not older ones or other stores', () => {
    const names = lastRemindersBatch([
      { name: 'sour cream', dest: 'reminders', pushedAt: nov9 },
      { name: 'black beans', dest: 'reminders', pushedAt: nov11 },
      { name: 'jalapeños', dest: 'reminders', pushedAt: nov11 },
      { name: 'gold potatoes', dest: 'wegmans', pushedAt: nov11 },
    ]);
    expect(names).toEqual(['Black beans', 'Jalapeños']);
    expect(remindersDeepLink(names)).toContain('Black%20beans%0AJalape%C3%B1os');
  });

  it('reads a push time that came back from storage as a string', () => {
    expect(
      lastRemindersBatch([
        { name: 'bacon', dest: 'reminders', pushedAt: nov11.toISOString() },
        { name: 'limes', dest: 'reminders', pushedAt: nov11 },
      ]),
    ).toEqual(['Bacon', 'Limes']);
  });
});
