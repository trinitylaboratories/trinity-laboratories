import type { TirnLevel } from './tirn-access';

export const PORTAL_WORK_ITEM_KINDS = [
  'report-review',
  'policy-review',
  'training-review',
  'field-return',
] as const;

export const PORTAL_NOTICE_KINDS = ['service-window', 'records-advisory'] as const;

export type PortalWorkItemKind = (typeof PORTAL_WORK_ITEM_KINDS)[number];
export type PortalNoticeKind = (typeof PORTAL_NOTICE_KINDS)[number];

export interface PortalWorkItem {
  id: string;
  kind: PortalWorkItemKind;
  title: string;
  detail: string;
  state: 'open' | 'review' | 'required' | 'controlled';
  timing: string;
  office: string;
  href: string;
  actionLabel: string;
  requiredLevel: TirnLevel;
}

export interface PortalNotice {
  id: string;
  kind: PortalNoticeKind;
  title: string;
  detail: string;
  state: 'scheduled' | 'advisory';
  timing: string;
  href: string;
  actionLabel: string;
}

export const PORTAL_WORK_ITEMS = [
  {
    id: 'effective-record-review',
    kind: 'report-review',
    title: 'Effective-record review',
    detail:
      'Review records made effective during the current register cycle before relying on an earlier revision.',
    state: 'review',
    timing: 'Current register cycle',
    office: 'Records Control',
    href: '#recent-records-heading',
    actionLabel: 'Review recent records',
    requiredLevel: 'TL-2',
  },
  {
    id: 'research-oversight-review',
    kind: 'policy-review',
    title: 'Research oversight reference review',
    detail:
      'Personnel supporting protocol administration should confirm the archived framework and current control-office instructions before assignment.',
    state: 'required',
    timing: 'Before protocol support',
    office: 'Research Standards & Laboratory Control',
    href: '/portal/research/',
    actionLabel: 'Open research register',
    requiredLevel: 'TL-2',
  },
  {
    id: 'controlled-record-training',
    kind: 'training-review',
    title: 'Controlled-record handling review',
    detail:
      'Complete the applicable review cycle before handling work that requires temporary information authorization.',
    state: 'controlled',
    timing: 'Before elevated record review',
    office: 'Information Security & Records Division',
    href: '/records/reports/tl-340-trn-001/',
    actionLabel: 'Review control record',
    requiredLevel: 'TL-3',
  },
  {
    id: 'field-return-reconciliation',
    kind: 'field-return',
    title: 'Field-return reconciliation',
    detail:
      'Confirm custody paperwork, equipment checks, and field notes are reconciled before the return packet is closed.',
    state: 'open',
    timing: 'At field closeout',
    office: 'Field Sampling & Geological Research',
    href: '/records/reports/tl-sop-720-fs-001/',
    actionLabel: 'Open return procedure',
    requiredLevel: 'TL-2',
  },
] as const satisfies readonly PortalWorkItem[];

export const PORTAL_NOTICES = [
  {
    id: 'routine-index-service',
    kind: 'service-window',
    title: 'Routine records service window',
    detail:
      'Search-index verification is reserved for Sunday 02:00–02:30 local. Record search may be briefly unavailable during the interval.',
    state: 'scheduled',
    timing: 'Weekly',
    href: '/records/search/',
    actionLabel: 'Open records search',
  },
  {
    id: 'oversight-archive-status',
    kind: 'records-advisory',
    title: 'Archived oversight reference',
    detail:
      'TL-RSO-001 is retained for historical control comparison. Current protocol orders and control-office instructions govern active work.',
    state: 'advisory',
    timing: 'Standing notice',
    href: '/portal/research/',
    actionLabel: 'Review research register',
  },
] as const satisfies readonly PortalNotice[];
