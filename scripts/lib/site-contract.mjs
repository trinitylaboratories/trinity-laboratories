export const PRODUCTION_ORIGIN = 'https://trinitylaboratories.org';
export const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).host;

export const CORE_ROUTES = Object.freeze([
  '/',
  '/about/',
  '/research/',
  '/facilities/',
  '/publications/',
  '/careers/',
  '/contact/',
  '/employee-access/',
  '/records/',
  '/records/search/',
  '/records/security/information-classification/',
  '/records/security/physical-access/',
  '/records/security/endorsements-and-conditions/',
  '/records/forms/',
]);

export const FORM_IDS = Object.freeze([
  'tl-101',
  'tl-220',
  'tl-340',
  'tl-470',
  'tl-590',
  'tl-p110',
  'tl-p365',
  'tl-o205',
  'tl-n310',
  'tl-n480',
  'tl-sop-720',
  'tl-sop-760',
  'tl-sop-890',
  'tl-x510',
  'tl-x595',
]);

export const FORM_ROUTES = Object.freeze(FORM_IDS.map((formId) => `/records/forms/${formId}/`));

export const SECURITY_RECORD_ROUTES = Object.freeze([
  '/records/security/information-classification/',
  '/records/security/physical-access/',
  '/records/security/endorsements-and-conditions/',
]);

export const RECORD_ROUTES = Object.freeze([...SECURITY_RECORD_ROUTES, ...FORM_ROUTES]);

export const SITE_ROUTES = Object.freeze([...CORE_ROUTES, ...FORM_ROUTES]);

export const LOCAL_FORM_ROUTES = Object.freeze(['/contact/', '/careers/']);
export const GATEWAY_ROUTE = '/employee-access/';

export const REQUIRED_GATEWAY_HOOKS = Object.freeze([
  'data-gateway-form',
  'data-generate-code',
  'data-terminal-code',
]);

export const REQUIRED_SESSION_HOOKS = Object.freeze([
  'data-session-state',
  'data-session-terminate',
]);

export function canonicalUrl(route) {
  return new URL(normalizeRoute(route), `${PRODUCTION_ORIGIN}/`).href;
}

export function normalizeRoute(route) {
  const parsed = new URL(route, `${PRODUCTION_ORIGIN}/`);
  let pathname = parsed.pathname.replace(/\/{2,}/g, '/');

  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (!pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(pathname)) pathname += '/';

  return pathname;
}

export function routeToOutputPath(route) {
  const normalized = normalizeRoute(route);
  return normalized === '/' ? 'index.html' : `${normalized.slice(1)}index.html`;
}
