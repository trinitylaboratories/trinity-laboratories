import { describe, expect, it } from 'vitest';
import {
  accessAllows,
  AUTHORIZATION_REFERENCE_EXAMPLE,
  authorizationReferenceMatchesLevel,
  BASE_STAFF_LEVEL,
  CONTROL_OFFICE_REFERENCE_EXAMPLE,
  createElevatedGrant,
  DEMONSTRATION_GRANT_SCOPE,
  ELEVATED_GRANT_TTL_MS,
  evaluateAuthorizationRequest,
  formatGrantRemaining,
  isControlOfficeReference,
  levelAllows,
  normalizeAuthorizationReference,
  parseElevatedGrant,
  resolveTirnAccess,
  serializeElevatedGrant,
  TIRN_GRANT_STORAGE_KEY,
  TIRN_SESSION_STORAGE_KEY,
  type AuthorizationRequest,
  type ElevatedGrant,
  type TemporaryGrantLevel,
} from '../../src/lib/tirn-access';

const NOW = Date.parse('2026-08-24T12:00:00Z');

function grant(
  level: TemporaryGrantLevel = 'TL-3',
  expiresAt = NOW + ELEVATED_GRANT_TTL_MS,
): ElevatedGrant {
  return {
    version: 1,
    level,
    scope: DEMONSTRATION_GRANT_SCOPE,
    expiresAt,
  };
}

function request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    requiredLevel: 'TL-3',
    purpose: 'record-review',
    authorizationReference: AUTHORIZATION_REFERENCE_EXAMPLE,
    attested: true,
    ...overrides,
  };
}

describe('TIRN local access requests', () => {
  it('normalizes and validates level-specific authorization references', () => {
    expect(normalizeAuthorizationReference('  tl3-abc123  ')).toBe('TL3-ABC123');
    expect(authorizationReferenceMatchesLevel(' tl3-abc123 ', 'TL-3')).toBe(true);
    expect(authorizationReferenceMatchesLevel('TL4-ABC123', 'TL-3')).toBe(false);
    expect(authorizationReferenceMatchesLevel('TL3-SHORT', 'TL-3')).toBe(false);
    expect(authorizationReferenceMatchesLevel('TL3-ABC123', 'TL-5')).toBe(false);
    expect(isControlOfficeReference(` ${CONTROL_OFFICE_REFERENCE_EXAMPLE.toLowerCase()} `)).toBe(
      true,
    );
    expect(isControlOfficeReference('TL4-ABC123')).toBe(false);
  });

  it('returns field-specific incomplete results without reflecting entered values', () => {
    expect(evaluateAuthorizationRequest(request({ purpose: '' }), NOW)).toEqual({
      accepted: false,
      field: 'purpose',
      message: 'Select a working purpose.',
    });
    expect(
      evaluateAuthorizationRequest(request({ authorizationReference: 'RAW-REFERENCE-91F7' }), NOW),
    ).toEqual({
      accepted: false,
      field: 'authorizationReference',
      message: 'Enter a TL-3 authorization reference in the TL3-XXXXXX format.',
    });
    expect(evaluateAuthorizationRequest(request({ attested: false }), NOW)).toEqual({
      accepted: false,
      field: 'attestation',
      message: 'Confirm the need-to-know attestation.',
    });
  });

  it('requires an independent control-office reference for TL-4', () => {
    const incomplete = evaluateAuthorizationRequest(
      request({
        requiredLevel: 'TL-4',
        authorizationReference: 'TL4-ABC123',
      }),
      NOW,
    );
    expect(incomplete).toEqual({
      accepted: false,
      field: 'controlOfficeReference',
      message: 'Enter a control-office reference in the CO-XXXXXX format.',
    });

    const accepted = evaluateAuthorizationRequest(
      request({
        requiredLevel: 'TL-4',
        authorizationReference: 'TL4-ABC123',
        controlOfficeReference: CONTROL_OFFICE_REFERENCE_EXAMPLE,
      }),
      NOW,
    );
    expect(accepted).toEqual({ accepted: true, grant: grant('TL-4') });
  });

  it('issues only generic temporary state and keeps TL-5+ unavailable', () => {
    const rawReference = 'TL3-RAW91F7';
    const accepted = evaluateAuthorizationRequest(
      request({ authorizationReference: rawReference, purpose: 'records-administration' }),
      NOW,
    );
    expect(accepted.accepted).toBe(true);
    expect(JSON.stringify(accepted)).not.toContain(rawReference);
    expect(JSON.stringify(accepted)).not.toContain('records-administration');
    expect(accepted).toEqual({ accepted: true, grant: grant('TL-3') });

    expect(createElevatedGrant('TL-5', NOW)).toBeNull();
    expect(evaluateAuthorizationRequest(request({ requiredLevel: 'TL-5' }), NOW)).toEqual({
      accepted: false,
      field: 'level',
      message: 'This information level requires separate authorization.',
    });
  });
});

describe('TIRN generic session state', () => {
  it('uses the existing generic session and grant keys', () => {
    expect(TIRN_SESSION_STORAGE_KEY).toBe('tirn-session');
    expect(TIRN_GRANT_STORAGE_KEY).toBe('tirn-grant');
    expect(BASE_STAFF_LEVEL).toBe('TL-2');
  });

  it('round-trips strict TL-3 and TL-4 grant shapes', () => {
    for (const level of ['TL-3', 'TL-4'] as const) {
      const serialized = serializeElevatedGrant(grant(level));
      expect(JSON.parse(serialized)).toEqual(grant(level));
      expect(parseElevatedGrant(serialized, NOW)).toEqual(grant(level));
    }
  });

  it('rejects expired, overlong, malformed, unsupported, and raw-value-bearing grants', () => {
    expect(parseElevatedGrant(serializeElevatedGrant(grant('TL-3', NOW)), NOW)).toBeNull();
    expect(
      parseElevatedGrant(
        serializeElevatedGrant(grant('TL-4', NOW + ELEVATED_GRANT_TTL_MS + 1)),
        NOW,
      ),
    ).toBeNull();
    expect(parseElevatedGrant('{not-json', NOW)).toBeNull();
    expect(parseElevatedGrant(JSON.stringify({ ...grant(), level: 'TL-5' }), NOW)).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), purpose: 'forbidden' }), NOW),
    ).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), authorizationReference: 'forbidden' }), NOW),
    ).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), controlOfficeReference: 'forbidden' }), NOW),
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

  it('allows TL-4 to satisfy TL-3 while keeping TL-5 and TL/Ø unavailable', () => {
    expect(levelAllows('TL-4', 'TL-3')).toBe(true);
    expect(levelAllows('TL-3', 'TL-4')).toBe(false);
    expect(levelAllows('TL-7', 'TL/Ø')).toBe(false);
    expect(levelAllows('TL/Ø', 'TL/Ø')).toBe(true);

    const tl3Staff = resolveTirnAccess('accepted', serializeElevatedGrant(grant('TL-3')), NOW);
    expect(accessAllows(tl3Staff, 'TL-2')).toBe(true);
    expect(accessAllows(tl3Staff, 'TL-3')).toBe(true);
    expect(accessAllows(tl3Staff, 'TL-4')).toBe(false);

    const tl4Staff = resolveTirnAccess('accepted', serializeElevatedGrant(grant('TL-4')), NOW);
    expect(accessAllows(tl4Staff, 'TL-3')).toBe(true);
    expect(accessAllows(tl4Staff, 'TL-4')).toBe(true);
    expect(accessAllows(tl4Staff, 'TL-5')).toBe(false);
    expect(accessAllows(tl4Staff, 'TL/Ø')).toBe(false);
  });

  it('formats remaining grant time for the staff header', () => {
    expect(formatGrantRemaining(NOW + 15 * 60 * 1000, NOW)).toBe('15:00');
    expect(formatGrantRemaining(NOW - 1, NOW)).toBe('00:00');
  });
});
