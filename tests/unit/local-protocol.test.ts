import { describe, expect, it } from 'vitest';
import {
  issueTerminalCode,
  simulatedFormResult,
  terminalCodeMatches,
  terminalCodeRemainingMs,
  TERMINAL_CODE_ALPHABET,
  TERMINAL_CODE_TTL_MS,
} from '../../src/lib/local-protocol';

describe('local terminal protocol', () => {
  it('derives a deterministic six-character code from cryptographic values', () => {
    const values = [
      0,
      1,
      2,
      TERMINAL_CODE_ALPHABET.length,
      TERMINAL_CODE_ALPHABET.length + 1,
      TERMINAL_CODE_ALPHABET.length + 2,
    ];
    expect(issueTerminalCode(values, 1_000)).toEqual({
      code: 'ABCABC',
      expiresAt: 1_000 + TERMINAL_CODE_TTL_MS,
    });
    expect(() => issueTerminalCode([1, 2, 3], 0)).toThrow(/exactly six/);
  });

  it('accepts a matching code only before the exact five-minute boundary', () => {
    const issued = issueTerminalCode([0, 1, 2, 3, 4, 5], 10_000);
    expect(terminalCodeRemainingMs(issued.expiresAt, issued.expiresAt - 1)).toBe(1);
    expect(
      terminalCodeMatches(` ${issued.code.toLowerCase()} `, issued, issued.expiresAt - 1),
    ).toBe(true);
    expect(terminalCodeRemainingMs(issued.expiresAt, issued.expiresAt)).toBe(0);
    expect(terminalCodeMatches(issued.code, issued, issued.expiresAt)).toBe(false);
    expect(terminalCodeMatches('AAAAAA', issued, issued.expiresAt - 1)).toBe(false);
  });

  it('models incomplete and accepted simulated-form states without retaining values', () => {
    expect(simulatedFormResult(false, 'CUSTOM ACCEPTED')).toEqual({
      accepted: false,
      message: 'Submission incomplete. Review the marked fields.',
      reset: false,
      state: 'incomplete',
    });
    expect(simulatedFormResult(true, 'CUSTOM ACCEPTED')).toEqual({
      accepted: true,
      message: 'CUSTOM ACCEPTED',
      reset: true,
      state: 'success',
    });
    expect(simulatedFormResult(true)).toEqual(
      expect.objectContaining({ message: 'SUBMISSION ACCEPTED.', reset: true }),
    );
  });
});
