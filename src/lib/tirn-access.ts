export const TIRN_SESSION_STORAGE_KEY = 'tirn-session';
export const TIRN_GRANT_STORAGE_KEY = 'tirn-grant';
export const TIRN_ACCESS_CHANGE_EVENT = 'tirn:access-change';

export const BASE_STAFF_LEVEL = 'TL-2' as const;
export const DEMONSTRATION_GRANT_LEVEL = 'TL-3' as const;
export const TEMPORARY_GRANT_SCOPE = 'records-review' as const;
export const ELEVATED_GRANT_TTL_MS = 15 * 60 * 1000;
export const TEMPORARY_GRANT_LEVELS = ['TL-3', 'TL-4'] as const;
export const AUTHORIZATION_PURPOSES = [
  'record-review',
  'required-training',
  'records-administration',
] as const;

export const AUTHORIZATION_REFERENCE_EXAMPLE = 'TL3-ABC123';
export const CONTROL_OFFICE_REFERENCE_EXAMPLE = 'CO-ABC123';

export const TIRN_LEVELS = [
  'TL-0',
  'TL-1',
  'TL-2',
  'TL-3',
  'TL-4',
  'TL-5',
  'TL-6',
  'TL-7',
  'TL/Ø',
] as const;

export type TirnLevel = (typeof TIRN_LEVELS)[number];
export type DisclosureMode = 'open' | 'authorize' | 'withheld';
export type TemporaryGrantLevel = (typeof TEMPORARY_GRANT_LEVELS)[number];
export type AuthorizationPurpose = (typeof AUTHORIZATION_PURPOSES)[number];

export interface ElevatedGrant {
  version: 1;
  level: TemporaryGrantLevel;
  scope: typeof TEMPORARY_GRANT_SCOPE;
  expiresAt: number;
}

export interface AuthorizationRequest {
  requiredLevel: TirnLevel;
  purpose: string;
  authorizationReference: string;
  controlOfficeReference?: string;
  attested: boolean;
}

export type AuthorizationRequestResult =
  | { accepted: true; grant: ElevatedGrant }
  | {
      accepted: false;
      field:
        'level' | 'purpose' | 'authorizationReference' | 'controlOfficeReference' | 'attestation';
      message: string;
    };

export interface TirnAccessState {
  session: 'unverified' | 'staff';
  baseLevel: 'TL-0' | typeof BASE_STAFF_LEVEL;
  effectiveLevel: 'TL-0' | typeof BASE_STAFF_LEVEL | TemporaryGrantLevel;
  grant: ElevatedGrant | null;
}

const STANDARD_LEVEL_RANK: Partial<Record<TirnLevel, number>> = {
  'TL-0': 0,
  'TL-1': 1,
  'TL-2': 2,
  'TL-3': 3,
  'TL-4': 4,
  'TL-5': 5,
  'TL-6': 6,
  'TL-7': 7,
};

export function normalizeAuthorizationReference(value: string): string {
  return value.trim().toUpperCase();
}

export function isTemporaryGrantLevel(level: TirnLevel): level is TemporaryGrantLevel {
  return TEMPORARY_GRANT_LEVELS.includes(level as TemporaryGrantLevel);
}

export function createElevatedGrant(level: TirnLevel, now: number): ElevatedGrant | null {
  if (!isTemporaryGrantLevel(level)) return null;
  return {
    version: 1,
    level,
    scope: TEMPORARY_GRANT_SCOPE,
    expiresAt: now + ELEVATED_GRANT_TTL_MS,
  };
}

export function authorizationReferenceMatchesLevel(value: string, level: TirnLevel): boolean {
  if (!isTemporaryGrantLevel(level)) return false;
  const match = normalizeAuthorizationReference(value).match(/^TL([34])-[A-Z0-9]{6,12}$/);
  return Boolean(match && `TL-${match[1]}` === level);
}

export function isControlOfficeReference(value: string): boolean {
  return /^CO-[A-Z0-9]{6,12}$/.test(normalizeAuthorizationReference(value));
}

export function evaluateAuthorizationRequest(
  request: AuthorizationRequest,
  now: number,
): AuthorizationRequestResult {
  if (!isTemporaryGrantLevel(request.requiredLevel)) {
    return {
      accepted: false,
      field: 'level',
      message: 'This information level requires separate authorization.',
    };
  }

  if (!AUTHORIZATION_PURPOSES.includes(request.purpose as AuthorizationPurpose)) {
    return {
      accepted: false,
      field: 'purpose',
      message: 'Select a working purpose.',
    };
  }

  if (!authorizationReferenceMatchesLevel(request.authorizationReference, request.requiredLevel)) {
    return {
      accepted: false,
      field: 'authorizationReference',
      message: `Enter a ${request.requiredLevel} authorization reference in the ${request.requiredLevel.replace('-', '')}-XXXXXX format.`,
    };
  }

  if (
    request.requiredLevel === 'TL-4' &&
    !isControlOfficeReference(request.controlOfficeReference ?? '')
  ) {
    return {
      accepted: false,
      field: 'controlOfficeReference',
      message: 'Enter a control-office reference in the CO-XXXXXX format.',
    };
  }

  if (!request.attested) {
    return {
      accepted: false,
      field: 'attestation',
      message: 'Confirm the need-to-know attestation.',
    };
  }

  return { accepted: true, grant: createElevatedGrant(request.requiredLevel, now)! };
}

export function serializeElevatedGrant(grant: ElevatedGrant): string {
  return JSON.stringify(grant);
}

export function parseElevatedGrant(value: string | null, now: number): ElevatedGrant | null {
  if (!value) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'expiresAt,level,scope,version') return null;
    if (
      record.version !== 1 ||
      !TEMPORARY_GRANT_LEVELS.includes(record.level as TemporaryGrantLevel) ||
      record.scope !== TEMPORARY_GRANT_SCOPE ||
      typeof record.expiresAt !== 'number' ||
      !Number.isFinite(record.expiresAt) ||
      record.expiresAt <= now ||
      record.expiresAt > now + ELEVATED_GRANT_TTL_MS
    ) {
      return null;
    }
    return candidate as ElevatedGrant;
  } catch {
    return null;
  }
}

export function levelAllows(current: TirnLevel, required: TirnLevel): boolean {
  if (current === 'TL/Ø' || required === 'TL/Ø') return current === required;
  return (
    (STANDARD_LEVEL_RANK[current] ?? -1) >= (STANDARD_LEVEL_RANK[required] ?? Number.MAX_VALUE)
  );
}

export function resolveTirnAccess(
  sessionValue: string | null,
  storedGrantValue: string | null,
  now: number,
): TirnAccessState {
  const staffSession = sessionValue === 'accepted';
  const grant = staffSession ? parseElevatedGrant(storedGrantValue, now) : null;
  return {
    session: staffSession ? 'staff' : 'unverified',
    baseLevel: staffSession ? BASE_STAFF_LEVEL : 'TL-0',
    effectiveLevel: grant?.level ?? (staffSession ? BASE_STAFF_LEVEL : 'TL-0'),
    grant,
  };
}

export function accessAllows(
  state: TirnAccessState,
  requiredLevel: TirnLevel,
  requiredScope: typeof TEMPORARY_GRANT_SCOPE = TEMPORARY_GRANT_SCOPE,
): boolean {
  if (state.session !== 'staff') return requiredLevel === 'TL-0';
  if (levelAllows(state.baseLevel, requiredLevel)) return true;
  return Boolean(
    state.grant &&
    state.grant.scope === requiredScope &&
    levelAllows(state.grant.level, requiredLevel),
  );
}

export function formatGrantRemaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
