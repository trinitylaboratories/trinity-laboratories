export const TERMINAL_CODE_TTL_MS = 5 * 60 * 1000;
export const TERMINAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface IssuedTerminalCode {
  code: string;
  expiresAt: number;
}

export interface SimulatedFormResult {
  accepted: boolean;
  message: string;
  reset: boolean;
  state: 'incomplete' | 'success';
}

export function issueTerminalCode(
  randomValues: ArrayLike<number>,
  now: number,
): IssuedTerminalCode {
  if (randomValues.length !== 6) {
    throw new Error('Terminal codes require exactly six random values.');
  }
  const code = Array.from(
    randomValues,
    (value) => TERMINAL_CODE_ALPHABET[value % TERMINAL_CODE_ALPHABET.length],
  ).join('');
  return { code, expiresAt: now + TERMINAL_CODE_TTL_MS };
}

export function terminalCodeRemainingMs(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now);
}

export function terminalCodeMatches(
  input: string,
  issued: IssuedTerminalCode,
  now: number,
): boolean {
  return (
    issued.code.length === 6 &&
    terminalCodeRemainingMs(issued.expiresAt, now) > 0 &&
    input.trim().toUpperCase() === issued.code
  );
}

export function simulatedFormResult(
  isValid: boolean,
  successMessage?: string,
): SimulatedFormResult {
  if (!isValid) {
    return {
      accepted: false,
      message: 'Please complete the highlighted fields.',
      reset: false,
      state: 'incomplete',
    };
  }
  return {
    accepted: true,
    message: successMessage || 'Thank you. Your form is complete.',
    reset: true,
    state: 'success',
  };
}
