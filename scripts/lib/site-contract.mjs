export const PRODUCTION_ORIGIN = 'https://trinitylaboratories.org';
export const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).host;

export const CORE_ROUTES = Object.freeze([
  '/',
  '/about/',
  '/research/',
  '/studies/',
  '/studies/indoor-condition-observation/',
  '/studies/household-timekeeping-stability/',
  '/studies/consumer-compass-repeatability/',
  '/studies/paper-substrate-curl-recovery/',
  '/studies/diagram-recall-route-notation/',
  '/studies/small-sensor-display-agreement/',
  '/facilities/',
  '/publications/',
  '/careers/',
  '/contact/',
  '/employee-access/',
]);

export const PORTAL_ROUTES = Object.freeze([
  '/portal/',
  '/portal/records/',
  '/portal/personnel/',
  '/portal/authorizations/',
  '/portal/forms/',
  '/portal/help/',
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

export const RESEARCH_RECORD_ROUTES = Object.freeze([
  '/records/research/subject-oversight-classification/',
]);

export const RECORD_ROUTES = Object.freeze([
  ...SECURITY_RECORD_ROUTES,
  ...RESEARCH_RECORD_ROUTES,
  ...FORM_ROUTES,
]);

export const SEARCHABLE_FORM_ROUTES = Object.freeze([
  '/records/forms/tl-101/',
  '/records/forms/tl-220/',
  '/records/forms/tl-p110/',
  '/records/forms/tl-o205/',
  '/records/forms/tl-sop-720/',
]);

export const SEARCHABLE_RECORD_ROUTES = Object.freeze([
  '/records/security/information-classification/',
  ...SEARCHABLE_FORM_ROUTES,
]);

export const RECORD_INDEX_ROUTES = Object.freeze([
  '/records/',
  '/records/search/',
  '/records/security/',
  '/records/research/',
  '/records/forms/',
]);

export const REPORT_IDS = Object.freeze([
  'tl-101-am-8701',
  'tl-101-cr-8801',
  'tl-101-ii-8902',
  'tl-220-ea-9101',
  'tl-101-ap-9303',
  'tl-220-pe-9502',
  'tl-220-am-9704',
  'tl-101-fs-9901',
  'tl-101-pe-0002',
  'tl-101-ea-0102',
  'tl-220-ap-0301',
  'tl-101-ii-0503',
  'tl-220-ls-0702',
  'tl-101-ea-0904',
  'tl-220-ii-1102',
  'tl-101-am-1305',
  'tl-220-cr-1402',
  'tl-220-pe-1503',
  'tl-220-fs-1701',
  'tl-101-ls-1904',
  'tl-220-ii-2102',
  'tl-101-ls-2201',
  'tl-220-am-2303',
  'tl-220-fs-2501',
  'tl-101-ins-001',
  'tl-220-ea-001',
  'tl-340-trn-001',
  'tl-sop-720-fs-001',
  'tl-p110-per-9302',
  'tl-p110-per-9804',
  'tl-p110-per-0403',
  'tl-p110-per-1110',
  'tl-p110-per-1806',
  'tl-p110-per-2402',
]);

export const REPORT_ROUTES = Object.freeze([
  '/records/reports/',
  ...REPORT_IDS.map((recordId) => `/records/reports/${recordId}/`),
  '/records/submissions/',
]);

export const CONTROLLED_RECORD_ROUTES = Object.freeze([
  ...RECORD_INDEX_ROUTES,
  ...RECORD_ROUTES,
  ...REPORT_ROUTES,
]);

export const SITEMAP_ROUTES = Object.freeze([...CORE_ROUTES]);
export const NOINDEX_ROUTES = Object.freeze([...PORTAL_ROUTES, ...CONTROLLED_RECORD_ROUTES]);
export const SITE_ROUTES = Object.freeze([...SITEMAP_ROUTES, ...NOINDEX_ROUTES]);

export const LOCAL_FORM_ROUTES = Object.freeze(['/contact/', '/careers/']);
export const STUDY_ROUTES = Object.freeze(
  CORE_ROUTES.filter((route) => route === '/studies/' || route.startsWith('/studies/')),
);
export const STUDY_FORM_ROUTES = Object.freeze([
  '/studies/indoor-condition-observation/',
  '/studies/household-timekeeping-stability/',
  '/studies/consumer-compass-repeatability/',
]);
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
