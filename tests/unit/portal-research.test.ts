import { describe, expect, it } from 'vitest';

import {
  relatedReportsForStudy,
  researchStudyRegistryEntry,
  selectResearchReports,
  sortResearchStudyRegistry,
} from '../../src/lib/portal-research';
import type { StudyData } from '../../src/lib/study-schema';
import type { SubmissionRecordData } from '../../src/lib/submission-schema';

const study = (overrides: Partial<StudyData> = {}): StudyData =>
  ({
    studyId: 'ST-26-014',
    slug: 'indoor-condition-observation',
    shortTitle: 'Indoor condition observations',
    discipline: 'Environmental Analysis',
    status: 'recruiting',
    phase: 'Observation series 02',
    protocolRevision: '2.1',
    controllingOffice: 'Participant Programs Office',
    application: { mode: 'eligibility-screen' },
    relatedRecordIds: ['TL-220-EA-001'],
    displayOrder: 2,
    ...overrides,
  }) as StudyData;

const submission = (
  recordId: string,
  effectiveDate: string,
  recordFamily: SubmissionRecordData['recordFamily'] = 'research',
): SubmissionRecordData => ({ recordId, effectiveDate, recordFamily }) as SubmissionRecordData;

describe('portal research registry helpers', () => {
  it('normalizes public protocol metadata without participant responses', () => {
    expect(researchStudyRegistryEntry(study())).toMatchObject({
      studyId: 'ST-26-014',
      statusLabel: 'Participation open',
      publicIntakeLabel: 'Eligibility screen open',
      relatedRecordIds: ['TL-220-EA-001'],
    });
    expect(
      researchStudyRegistryEntry(study({ status: 'completed', application: null }))
        .publicIntakeLabel,
    ).toBe('No current public intake');
  });

  it('sorts protocols by display order and research reports by effective date', () => {
    const later = researchStudyRegistryEntry(study({ studyId: 'ST-26-021', displayOrder: 3 }));
    const earlier = researchStudyRegistryEntry(study({ displayOrder: 1 }));
    expect(sortResearchStudyRegistry([later, earlier]).map(({ studyId }) => studyId)).toEqual([
      'ST-26-014',
      'ST-26-021',
    ]);

    expect(
      selectResearchReports([
        submission('TL-101-AM-8701', '1987-03-18'),
        submission('TL-P110-PER-2402', '2024-02-12', 'personnel'),
        submission('TL-220-EA-001', '2026-08-20'),
      ]).map(({ recordId }) => recordId),
    ).toEqual(['TL-220-EA-001', 'TL-101-AM-8701']);
  });

  it('resolves only explicitly linked completed records', () => {
    const reports = [
      submission('TL-220-EA-001', '2026-08-20'),
      submission('TL-101-AM-8701', '1987-03-18'),
    ];
    const entry = researchStudyRegistryEntry(
      study({ relatedRecordIds: ['TL-220-EA-001', 'TL-DOES-NOT-EXIST'] }),
    );
    expect(relatedReportsForStudy(entry, reports).map(({ recordId }) => recordId)).toEqual([
      'TL-220-EA-001',
    ]);
  });
});
