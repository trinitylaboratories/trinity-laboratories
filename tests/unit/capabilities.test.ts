import { describe, expect, it } from 'vitest';

import { CAPABILITY_ROUTES as CONTRACT_CAPABILITY_ROUTES } from '../../scripts/lib/site-contract.mjs';
import {
  CAPABILITIES,
  CAPABILITY_ROUTES,
  capabilityBySlug,
  capabilityByTitle,
} from '../../src/lib/capabilities';

describe('public research capabilities', () => {
  it('defines eight unique, stable capability routes', () => {
    expect(CAPABILITIES).toHaveLength(8);
    expect(CAPABILITY_ROUTES).toHaveLength(8);
    expect(CAPABILITY_ROUTES).toEqual(CONTRACT_CAPABILITY_ROUTES);
    expect(new Set(CAPABILITY_ROUTES).size).toBe(8);
    expect(CAPABILITY_ROUTES.every((route) => /^\/research\/[a-z0-9-]+\/$/.test(route))).toBe(true);
  });

  it('keeps every capability substantive and conservatively bounded', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.questions).toHaveLength(3);
      expect(capability.methods.length).toBeGreaterThanOrEqual(4);
      expect(capability.projectInputs).toHaveLength(3);
      expect(capability.deliverables).toHaveLength(3);
      expect(capability.limitations).toHaveLength(3);
      expect(capability.summary).not.toMatch(/accredit|certif|client|guarantee/i);
    }
  });

  it('supports lookup by route slug and controlling-office title', () => {
    expect(capabilityBySlug('advanced-materials')?.title).toBe('Advanced Materials');
    expect(capabilityByTitle('Industrial Instrumentation')?.slug).toBe(
      'industrial-instrumentation',
    );
    expect(capabilityBySlug('unknown')).toBeUndefined();
  });
});
