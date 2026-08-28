import { describe, expect, it } from 'vitest';
import {
  accessAllows,
  AUTHORIZATION_REFERENCE_EXAMPLE,
  authorizationReferenceMatchesLevel,
  BASE_STAFF_LEVEL,
  CONTROL_OFFICE_REFERENCE_EXAMPLE,
  createElevatedGrant,
  DIRECTORATE_RELEASE_REFERENCE_EXAMPLE,
  TEMPORARY_GRANT_SCOPE,
  ELEVATED_GRANT_TTL_MS,
  evaluateAuthorizationRequest,
  formatGrantRemaining,
  isControlOfficeReference,
  isDirectorateReleaseReference,
  isIsolationReference,
  ISOLATION_REFERENCE_EXAMPLE,
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
    scope: TEMPORARY_GRANT_SCOPE,
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
    expect(authorizationReferenceMatchesLevel('TL5-ABC123', 'TL-5')).toBe(true);
    expect(authorizationReferenceMatchesLevel('TL6-ABC123', 'TL-6')).toBe(true);
    expect(isControlOfficeReference(` ${CONTROL_OFFICE_REFERENCE_EXAMPLE.toLowerCase()} `)).toBe(
      true,
    );
    expect(isControlOfficeReference('TL4-ABC123')).toBe(false);
    expect(
      isDirectorateReleaseReference(` ${DIRECTORATE_RELEASE_REFERENCE_EXAMPLE.toLowerCase()} `),
    ).toBe(true);
    expect(isDirectorateReleaseReference('CO-ABC123')).toBe(false);
    expect(isIsolationReference(` ${ISOLATION_REFERENCE_EXAMPLE.toLowerCase()} `)).toBe(true);
    expect(isIsolationReference('DR-ABC123')).toBe(false);
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

  it('requires an independent control-office reference for TL-4 and above', () => {
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

    const higherLevel = evaluateAuthorizationRequest(
      request({
        requiredLevel: 'TL-5',
        authorizationReference: 'TL5-ABC123',
      }),
      NOW,
    );
    expect(higherLevel).toEqual({
      accepted: false,
      field: 'controlOfficeReference',
      message: 'Enter a control-office reference in the CO-XXXXXX format.',
    });
  });

  it('requires a Directorate release for TL-5 and an isolation reference for TL-6', () => {
    const tl5Request = {
      requiredLevel: 'TL-5' as const,
      authorizationReference: 'TL5-ABC123',
      controlOfficeReference: CONTROL_OFFICE_REFERENCE_EXAMPLE,
    };
    expect(evaluateAuthorizationRequest(request(tl5Request), NOW)).toEqual({
      accepted: false,
      field: 'directorateReleaseReference',
      message: 'Enter a Directorate release reference in the DR-XXXXXX format.',
    });
    expect(
      evaluateAuthorizationRequest(
        request({
          ...tl5Request,
          directorateReleaseReference: DIRECTORATE_RELEASE_REFERENCE_EXAMPLE,
        }),
        NOW,
      ),
    ).toEqual({ accepted: true, grant: grant('TL-5') });

    const tl6Request = {
      requiredLevel: 'TL-6' as const,
      authorizationReference: 'TL6-ABC123',
      controlOfficeReference: CONTROL_OFFICE_REFERENCE_EXAMPLE,
      directorateReleaseReference: DIRECTORATE_RELEASE_REFERENCE_EXAMPLE,
    };
    expect(evaluateAuthorizationRequest(request(tl6Request), NOW)).toEqual({
      accepted: false,
      field: 'isolationReference',
      message: 'Enter an isolation-register reference in the IR-XXXXXX format.',
    });
    const accepted = evaluateAuthorizationRequest(
      request({ ...tl6Request, isolationReference: ISOLATION_REFERENCE_EXAMPLE }),
      NOW,
    );
    expect(accepted).toEqual({ accepted: true, grant: grant('TL-6') });
    for (const rawValue of [
      tl6Request.authorizationReference,
      tl6Request.controlOfficeReference,
      tl6Request.directorateReleaseReference,
      ISOLATION_REFERENCE_EXAMPLE,
    ]) {
      expect(JSON.stringify(accepted)).not.toContain(rawValue);
    }
  });

  it('issues only generic temporary state through TL-6', () => {
    const rawReference = 'TL3-RAW91F7';
    const accepted = evaluateAuthorizationRequest(
      request({ authorizationReference: rawReference, purpose: 'records-administration' }),
      NOW,
    );
    expect(accepted.accepted).toBe(true);
    expect(JSON.stringify(accepted)).not.toContain(rawReference);
    expect(JSON.stringify(accepted)).not.toContain('records-administration');
    expect(accepted).toEqual({ accepted: true, grant: grant('TL-3') });

    expect(createElevatedGrant('TL-5', NOW)).toEqual(grant('TL-5'));
    expect(createElevatedGrant('TL-6', NOW)).toEqual(grant('TL-6'));
    expect(evaluateAuthorizationRequest(request({ requiredLevel: 'TL-7' }), NOW)).toEqual({
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

  it('round-trips strict TL-3 through TL-6 grant shapes', () => {
    for (const level of ['TL-3', 'TL-4', 'TL-5', 'TL-6'] as const) {
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
    expect(parseElevatedGrant(JSON.stringify({ ...grant(), level: 'TL-7' }), NOW)).toBeNull();
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
      parseElevatedGrant(
        JSON.stringify({ ...grant(), directorateReleaseReference: 'forbidden' }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseElevatedGrant(JSON.stringify({ ...grant(), isolationReference: 'forbidden' }), NOW),
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

  it('applies generic temporary eligibility hierarchically through TL-6', () => {
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

    const tl5Staff = resolveTirnAccess('accepted', serializeElevatedGrant(grant('TL-5')), NOW);
    expect(accessAllows(tl5Staff, 'TL-4')).toBe(true);
    expect(accessAllows(tl5Staff, 'TL-5')).toBe(true);
    expect(accessAllows(tl5Staff, 'TL-6')).toBe(false);

    const tl6Staff = resolveTirnAccess('accepted', serializeElevatedGrant(grant('TL-6')), NOW);
    expect(accessAllows(tl6Staff, 'TL-5')).toBe(true);
    expect(accessAllows(tl6Staff, 'TL-6')).toBe(true);
    expect(accessAllows(tl6Staff, 'TL-7')).toBe(false);
    expect(accessAllows(tl6Staff, 'TL/Ø')).toBe(false);
  });

  it('formats remaining grant time for the staff header', () => {
    expect(formatGrantRemaining(NOW + 15 * 60 * 1000, NOW)).toBe('15:00');
    expect(formatGrantRemaining(NOW - 1, NOW)).toBe('00:00');
  });
});
