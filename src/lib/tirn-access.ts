export const TIRN_SESSION_STORAGE_KEY = 'tirn-session';
export const TIRN_GRANT_STORAGE_KEY = 'tirn-grant';
export const TIRN_ACCESS_CHANGE_EVENT = 'tirn:access-change';

export const BASE_STAFF_LEVEL = 'TL-2' as const;
export const DEMONSTRATION_GRANT_LEVEL = 'TL-3' as const;
export const DEMONSTRATION_GRANT_SCOPE = 'training' as const;
export const ELEVATED_GRANT_TTL_MS = 15 * 60 * 1000;

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

export interface ElevatedGrant {
  version: 1;
  level: typeof DEMONSTRATION_GRANT_LEVEL;
  scope: typeof DEMONSTRATION_GRANT_SCOPE;
  expiresAt: number;
}

export interface AuthorizationVerifier {
  version: 1;
  salt: string;
  digest: string;
  level: typeof DEMONSTRATION_GRANT_LEVEL;
  scope: typeof DEMONSTRATION_GRANT_SCOPE;
}

export const TRAINING_AUTHORIZATION_VERIFIER: Readonly<AuthorizationVerifier> = Object.freeze({
  version: 1,
  salt: '1b31e36bc1cdded03fe6095f8a33d333',
  digest: 'e6123cc3f56f2c813fd67ba4e5b354298f737e473366d45a18f7cf70a5d4c209',
  level: DEMONSTRATION_GRANT_LEVEL,
  scope: DEMONSTRATION_GRANT_SCOPE,
});

export interface TirnAccessState {
  session: 'unverified' | 'staff';
  baseLevel: 'TL-0' | typeof BASE_STAFF_LEVEL;
  effectiveLevel: 'TL-0' | typeof BASE_STAFF_LEVEL | typeof DEMONSTRATION_GRANT_LEVEL;
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

function bytesToHex(values: ArrayLike<number>): string {
  return Array.from(values, (value) => (value & 0xff).toString(16).padStart(2, '0')).join('');
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function normalizeAuthorizationCredential(value: string): string {
  return value.trim().toUpperCase();
}

export async function hashAuthorizationCredential(
  credential: string,
  salt: string,
): Promise<string> {
  const normalized = normalizeAuthorizationCredential(credential);
  const payload = new TextEncoder().encode(`${salt}:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyAuthorizationCredential(
  input: string,
  now: number,
): Promise<ElevatedGrant | null> {
  const verifier = TRAINING_AUTHORIZATION_VERIFIER;
  if (
    verifier.version !== 1 ||
    verifier.level !== DEMONSTRATION_GRANT_LEVEL ||
    verifier.scope !== DEMONSTRATION_GRANT_SCOPE ||
    !normalizeAuthorizationCredential(input)
  ) {
    return null;
  }

  const candidateDigest = await hashAuthorizationCredential(input, verifier.salt);
  if (!equalHex(candidateDigest, verifier.digest)) return null;

  return {
    version: 1,
    level: DEMONSTRATION_GRANT_LEVEL,
    scope: DEMONSTRATION_GRANT_SCOPE,
    expiresAt: now + ELEVATED_GRANT_TTL_MS,
  };
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
      record.level !== DEMONSTRATION_GRANT_LEVEL ||
      record.scope !== DEMONSTRATION_GRANT_SCOPE ||
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
  requiredScope: typeof DEMONSTRATION_GRANT_SCOPE = DEMONSTRATION_GRANT_SCOPE,
): boolean {
  if (state.session !== 'staff') return requiredLevel === 'TL-0';
  if (requiredLevel === 'TL-3') {
    return Boolean(state.grant && state.grant.scope === requiredScope);
  }
  return levelAllows(state.effectiveLevel, requiredLevel);
}

export function formatGrantRemaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
