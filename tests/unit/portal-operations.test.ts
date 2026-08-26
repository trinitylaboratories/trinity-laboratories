import { describe, expect, it } from 'vitest';

import {
  PORTAL_NOTICES,
  PORTAL_NOTICE_KINDS,
  PORTAL_WORK_ITEMS,
  PORTAL_WORK_ITEM_KINDS,
} from '../../src/lib/portal-operations';

describe('portal operations data', () => {
  it('provides one typed routine item for each supported work category', () => {
    expect(PORTAL_WORK_ITEMS.map(({ kind }) => kind).sort()).toEqual(
      [...PORTAL_WORK_ITEM_KINDS].sort(),
    );
    expect(new Set(PORTAL_WORK_ITEMS.map(({ id }) => id)).size).toBe(PORTAL_WORK_ITEMS.length);
  });

  it('keeps work-item actions internal and within supported portal eligibility', () => {
    for (const item of PORTAL_WORK_ITEMS) {
      expect(item.href).toMatch(/^(?:\/|#)/);
      expect(['TL-2', 'TL-3']).toContain(item.requiredLevel);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(20);
    }
  });

  it('includes a routine service window without creating personal assignments or an inbox', () => {
    expect(PORTAL_NOTICES.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([...PORTAL_NOTICE_KINDS]),
    );
    const operationalCopy = JSON.stringify({ notices: PORTAL_NOTICES, items: PORTAL_WORK_ITEMS });
    expect(operationalCopy).not.toMatch(/applicant|candidate inbox|assigned to [A-Z][a-z]+ [A-Z]/i);
  });
});
