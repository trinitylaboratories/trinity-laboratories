export interface CapabilityMedia {
  src: string;
  alt: string;
  caption: string;
  focalPoint: string;
}

export interface Capability {
  index: string;
  slug: string;
  title: string;
  summary: string;
  introduction: string;
  questions: string[];
  methods: string[];
  projectInputs: string[];
  deliverables: string[];
  limitations: string[];
  media?: CapabilityMedia;
}

export const CAPABILITIES: readonly Capability[] = Object.freeze([
  {
    index: '01',
    slug: 'advanced-materials',
    title: 'Advanced Materials',
    summary:
      'Comparative material studies built around clearly defined conditions and practical use questions.',
    introduction:
      'We examine how material samples change, recover, adhere, or remain stable under a defined observation plan. The work is scoped to the material, environment, and decision the study needs to support.',
    questions: [
      'How consistently does a material behave across repeated samples or batches?',
      'Which observable changes occur under a controlled environmental or handling condition?',
      'Does a proposed preparation or inspection method produce repeatable observations?',
    ],
    methods: [
      'Comparative bench observations',
      'Conditioned sample intervals',
      'Dimensional and surface review',
      'Fixed-category visual assessment',
    ],
    projectInputs: [
      'A defined material or sample family',
      'The intended condition or comparison',
      'Acceptance questions and practical constraints',
    ],
    deliverables: [
      'Documented observation plan',
      'Comparison tables and method notes',
      'Technical summary with stated limitations',
    ],
    limitations: [
      'Bench studies do not substitute for certification or field qualification.',
      'Results apply to the samples and conditions included in the study.',
      'Material composition is not inferred beyond the measurements performed.',
    ],
    media: {
      src: '/media/facilities/materials-inspection.webp',
      alt: 'Materials arranged at an inspection station for comparative evaluation',
      caption: 'Comparative materials inspection and image-based evaluation.',
      focalPoint: '52% 54%',
    },
  },
  {
    index: '02',
    slug: 'industrial-instrumentation',
    title: 'Industrial Instrumentation',
    summary:
      'Measurement-system evaluation focused on repeatability, stability, and clear operator interpretation.',
    introduction:
      'We develop and assess practical measurement arrangements, from individual displays to assembled test setups. Each evaluation distinguishes instrument behavior from the limits of the reference method.',
    questions: [
      'Does an instrument produce stable readings across a defined operating interval?',
      'How closely do multiple displays or channels agree under the same condition?',
      'Can an operator repeat the setup and interpret its output consistently?',
    ],
    methods: [
      'Repeatability and warm-up observations',
      'Channel-to-channel comparison',
      'Load and response checks',
      'Operator-interface review',
    ],
    projectInputs: [
      'Instrument or assembly under review',
      'Expected operating range and observation interval',
      'Available reference method and acceptance criteria',
    ],
    deliverables: [
      'Verification sequence',
      'Observed agreement and stability summary',
      'Operating notes and follow-up recommendations',
    ],
    limitations: [
      'A comparative check is not a traceable calibration unless explicitly established as one.',
      'Results depend on the stated setup, reference, and environmental conditions.',
      'Long-term reliability is not inferred from a short observation series.',
    ],
    media: {
      src: '/media/facilities/instrumented-testing.webp',
      alt: 'Instrumented testing equipment prepared for a controlled laboratory evaluation',
      caption: 'Instrument setup, signal review, and controlled measurement support.',
      focalPoint: '55% 48%',
    },
  },
  {
    index: '03',
    slug: 'environmental-analysis',
    title: 'Environmental Analysis',
    summary:
      'Structured sampling and measurement for physical and environmental conditions that change over time.',
    introduction:
      'We use defined collection intervals, handling controls, and analytical checks to describe environmental observations without extending the result beyond what the sampling plan can support.',
    questions: [
      'How does a measured condition vary across time, samples, or observation points?',
      'Is the sampling and handling sequence producing consistent analytical material?',
      'Which ordinary environmental factors should be recorded alongside the primary measurement?',
    ],
    methods: [
      'Sampling-plan development',
      'Instrument stabilization checks',
      'Duplicate and blank review',
      'Environmental observation logs',
    ],
    projectInputs: [
      'The condition or material to be observed',
      'Sampling window and practical access constraints',
      'Required analytical resolution and reporting use',
    ],
    deliverables: [
      'Sampling and handling plan',
      'Analytical results with quality notes',
      'Interpretive summary bounded by the sampling design',
    ],
    limitations: [
      'A sample represents only its stated collection time and conditions.',
      'Screening measurements do not establish regulatory compliance unless designed for that purpose.',
      'Unmeasured environmental factors may affect interpretation.',
    ],
  },
  {
    index: '04',
    slug: 'applied-physics',
    title: 'Applied Physics',
    summary:
      'Controlled experiments that turn physical behavior into measurable, repeatable observations.',
    introduction:
      'We isolate a practical physical question, select observable quantities, and build a test sequence that can be repeated and reviewed. Emphasis stays on measured behavior rather than unsupported mechanism.',
    questions: [
      'Which measurable response changes when one test condition is varied?',
      'Is an observed effect repeatable above the ordinary background of the setup?',
      'What resolution and observation interval are appropriate to the question?',
    ],
    methods: [
      'Controlled-variable experiments',
      'Baseline and background surveys',
      'Time-series measurement',
      'Repeat-run comparison',
    ],
    projectInputs: [
      'A bounded physical question',
      'Observable response variables',
      'Known setup and measurement constraints',
    ],
    deliverables: [
      'Experimental plan and baseline record',
      'Measured response comparison',
      'Technical interpretation and uncertainty notes',
    ],
    limitations: [
      'Correlation within a test does not establish a broader causal mechanism.',
      'Resolution is limited by the stated instruments and setup.',
      'Results are not generalized beyond the tested range without additional work.',
    ],
  },
  {
    index: '05',
    slug: 'field-sampling-geological-research',
    title: 'Field Sampling & Geological Research',
    summary:
      'Field observation, sample handling, and geological documentation from collection through review.',
    introduction:
      'We plan field work so that observations, samples, and context remain connected throughout collection, return, preparation, and technical review. The record is designed to remain understandable after the field team has left the site.',
    questions: [
      'What collection pattern will represent the field question without overstating coverage?',
      'Which observations and handling steps are necessary to preserve sample context?',
      'How should field notes, labels, and returned material be reconciled?',
    ],
    methods: [
      'Field sampling plans',
      'Chain-of-custody and label reconciliation',
      'Geological observation records',
      'Sample return and preparation review',
    ],
    projectInputs: [
      'The field question and material of interest',
      'Access, schedule, and handling constraints',
      'Required observations and downstream analysis',
    ],
    deliverables: [
      'Collection and field-documentation plan',
      'Sample and notebook reconciliation record',
      'Field summary with coverage limitations',
    ],
    limitations: [
      'Field observations remain bounded by access, timing, and collection density.',
      'Sample handling cannot recover context that was not recorded at collection.',
      'Site-wide conditions are not inferred from a limited sampling pattern.',
    ],
    media: {
      src: '/media/facilities/core-sample-review.webp',
      alt: 'Prepared core samples arranged for observation and analytical review',
      caption: 'Sample preparation, observation, and analytical review after field return.',
      focalPoint: '50% 52%',
    },
  },
  {
    index: '06',
    slug: 'laboratory-safety-systems',
    title: 'Laboratory Safety Systems',
    summary:
      'Practical procedures, checks, and work controls that support consistent laboratory activity.',
    introduction:
      'We evaluate the ordinary systems that help laboratory work remain organized and repeatable: inspection routes, work-surface controls, readiness checks, and clearly documented response steps.',
    questions: [
      'Can a routine safety check be completed consistently by different staff?',
      'Are inspection intervals and response thresholds clear enough to use?',
      'Which parts of a work process create avoidable handling or documentation uncertainty?',
    ],
    methods: [
      'Inspection-route review',
      'Procedure walk-throughs',
      'Work-surface and readiness checks',
      'Fixed-interval maintenance observations',
    ],
    projectInputs: [
      'Existing procedure or work sequence',
      'Required inspection points and responsible roles',
      'Expected response and escalation criteria',
    ],
    deliverables: [
      'Procedure or checklist revision',
      'Observed workflow findings',
      'Practical control recommendations',
    ],
    limitations: [
      'A workflow review does not replace a formal regulatory or engineering assessment.',
      'Findings apply to the observed process and stated conditions.',
      'Implementation responsibility remains with the operating organization.',
    ],
  },
  {
    index: '07',
    slug: 'prototype-evaluation',
    title: 'Prototype Evaluation',
    summary:
      'Early evaluation of instruments, assemblies, and work processes against defined performance questions.',
    introduction:
      'We help turn a prototype into a testable set of questions. Evaluations focus on observable performance, repeatability, inspection, and the practical limits of an early design.',
    questions: [
      'Does the prototype perform its intended task across repeated trials?',
      'Which features create variation, inspection difficulty, or operator uncertainty?',
      'What should be measured before the next design revision?',
    ],
    methods: [
      'Functional trial sequences',
      'Assembly and marking inspection',
      'Repeat-use observation',
      'Defined-condition comparison',
    ],
    projectInputs: [
      'Prototype or representative assembly',
      'Intended task and operating conditions',
      'Questions for the next design decision',
    ],
    deliverables: [
      'Evaluation plan',
      'Observed performance and inspection findings',
      'Prioritized follow-up questions',
    ],
    limitations: [
      'Prototype results do not establish production performance.',
      'The evaluation addresses defined questions rather than complete product qualification.',
      'Changes after the tested revision may require a new comparison.',
    ],
  },
  {
    index: '08',
    slug: 'contract-research',
    title: 'Contract Research',
    summary:
      'Focused studies organized around an agreed question, method, schedule, and reporting need.',
    introduction:
      'We structure small applied-research projects so that scope, decisions, and limitations remain clear from intake through final reporting. Work may draw on several Trinity capabilities when the question requires it.',
    questions: [
      'What evidence is needed to make the intended practical decision?',
      'Which methods fit the available material, schedule, and level of certainty?',
      'How should results be documented so another reviewer can understand the work?',
    ],
    methods: [
      'Question and scope definition',
      'Cross-discipline study planning',
      'Milestone and review control',
      'Technical report preparation',
    ],
    projectInputs: [
      'A clear research or evaluation question',
      'Available samples, records, or test articles',
      'Schedule, decision context, and reporting audience',
    ],
    deliverables: [
      'Agreed study plan and schedule',
      'Documented observations or test results',
      'Concise final report with limitations and next steps',
    ],
    limitations: [
      'The project scope defines what the work can and cannot establish.',
      'Results are not represented as certification or regulatory approval.',
      'Additional questions may require a separate method or phase of work.',
    ],
  },
]);

export const CAPABILITY_ROUTES = Object.freeze(
  CAPABILITIES.map(({ slug }) => `/research/${slug}/`),
);

export function capabilityBySlug(slug: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.slug === slug);
}

export function capabilityByTitle(title: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.title === title);
}
