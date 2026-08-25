import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accessAllows,
  BASE_STAFF_LEVEL,
  DEMONSTRATION_GRANT_LEVEL,
  DEMONSTRATION_GRANT_SCOPE,
  ELEVATED_GRANT_TTL_MS,
  formatGrantRemaining,
  hashAuthorizationCredential,
  levelAllows,
  normalizeAuthorizationCredential,
  parseElevatedGrant,
  resolveTirnAccess,
  serializeElevatedGrant,
  TIRN_GRANT_STORAGE_KEY,
  TIRN_SESSION_STORAGE_KEY,
  TRAINING_AUTHORIZATION_VERIFIER,
  verifyAuthorizationCredential,
  type ElevatedGrant,
} from '../../src/lib/tirn-access';

const NOW = Date.parse('2026-08-24T12:00:00Z');

function grant(expiresAt = NOW + ELEVATED_GRANT_TTL_MS): ElevatedGrant {
  return {
    version: 1,
    level: DEMONSTRATION_GRANT_LEVEL,
    scope: DEMONSTRATION_GRANT_SCOPE,
    expiresAt,
  };
}

describe('TIRN authorization credentials', () => {
  it('publishes only a salted verifier and not a usable raw credential', () => {
    expect(TRAINING_AUTHORIZATION_VERIFIER).toEqual({
      version: 1,
      salt: expect.stringMatching(/^[a-f0-9]{32}$/),
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      level: 'TL-3',
      scope: 'training',
    });
    expect(Object.keys(TRAINING_AUTHORIZATION_VERIFIER)).not.toContain('credential');
  });

  it('normalizes exactly by trimming and uppercasing', () => {
    expect(normalizeAuthorizationCredential('  example-code  ')).toBe('EXAMPLE-CODE');
    expect(normalizeAuthorizationCredential('space retained inside')).toBe('SPACE RETAINED INSIDE');
  });

  it('hashes salt, a colon, and the normalized credential', async () => {
    const salt = '0123456789abcdef';
    const expected = createHash('sha256').update(`${salt}:EXAMPLE-CODE`).digest('hex');
    await expect(hashAuthorizationCredential(' example-code ', salt)).resolves.toBe(expected);
  });

  it('rejects an unrecognized credential without creating a grant', async () => {
    await expect(verifyAuthorizationCredential('NOT-A-VALID-CREDENTIAL', NOW)).resolves.toBeNull();
  });
});

describe('TIRN generic session state', () => {
  it('uses the existing generic session key and the generic elevated key', () => {
    expect(TIRN_SESSION_STORAGE_KEY).toBe('tirn-session');
    expect(TIRN_GRANT_STORAGE_KEY).toBe('tirn-grant');
    expect(BASE_STAFF_LEVEL).toBe('TL-2');
  });

  it('round-trips only the approved grant shape', () => {
    const serialized = serializeElevatedGrant(grant());
    expect(JSON.parse(serialized)).toEqual(grant());
    expect(parseElevatedGrant(serialized, NOW)).toEqual(grant());
  });

  it('rejects expired, overlong, malformed, and raw-value-bearing grants', () => {
    expect(parseElevatedGrant(serializeElevatedGrant(grant(NOW)), NOW)).toBeNull();
    expect(
      parseElevatedGrant(serializeElevatedGrant(grant(NOW + ELEVATED_GRANT_TTL_MS + 1)), NOW),
    ).toBeNull();
    expect(parseElevatedGrant('{not-json', NOW)).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), credential: 'forbidden' }), NOW),
    ).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), badgeId: 'forbidden' }), NOW),
    ).toBeNull();
    expect(parseElevatedGrant(null, NOW)).toBeNull();
  });

  it('requires an accepted base session before applying an elevated grant', () => {
    const stored = serializeElevatedGrant(grant());
    expect(resolveTirnAccess(null, stored, NOW)).toEqual({
      session: 'unverified',
      baseLevel: 'TL-0',
      effectiveLevel: 'TL-0',
      grant: null,
    });
    expect(resolveTirnAccess('accepted', stored, NOW)).toEqual({
      session: 'staff',
      baseLevel: 'TL-2',
      effectiveLevel: 'TL-3',
      grant: grant(),
    });
  });

  it('keeps TL/Ø exceptional and applies the TL-3 grant only to training scope', () => {
    expect(levelAllows('TL-4', 'TL-3')).toBe(true);
    expect(levelAllows('TL-3', 'TL-4')).toBe(false);
    expect(levelAllows('TL-7', 'TL/Ø')).toBe(false);
    expect(levelAllows('TL/Ø', 'TL/Ø')).toBe(true);

    const staff = resolveTirnAccess('accepted', serializeElevatedGrant(grant()), NOW);
    expect(accessAllows(staff, 'TL-2')).toBe(true);
    expect(accessAllows(staff, 'TL-3')).toBe(true);
    expect(accessAllows(staff, 'TL-4')).toBe(false);
  });

  it('formats remaining grant time for the staff header', () => {
    expect(formatGrantRemaining(NOW + 15 * 60 * 1000, NOW)).toBe('15:00');
    expect(formatGrantRemaining(NOW - 1, NOW)).toBe('00:00');
  });
});
