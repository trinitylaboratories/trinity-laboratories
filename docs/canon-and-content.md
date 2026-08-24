# Canon and Content Policy

This document governs how source material becomes public website content. It is designed to preserve
the institutional terminology of the supplied Trinity Laboratories documents without turning model
inference into accidental canon.

## Source precedence

When sources disagree, use this order:

1. supplied Trinity policies, forms, and authoritative brand assets;
2. decisions explicitly approved by the project owner;
3. the website handoff and approved project specifications;
4. new contributor or model-generated proposals.

Lower-priority material must not silently overwrite higher-priority material. Record a conflict and
leave it unresolved until the owner decides.

## Content states

Every substantive lore claim should be identifiable as one of:

- **Source-backed** — directly supported by supplied material.
- **Owner-approved** — explicitly accepted as project canon.
- **Working convention** — used to keep implementation coherent while a decision remains open.
- **Proposal** — a suggested addition that is not canon.
- **Placeholder** — temporary copy or data that must not be mistaken for a final fact.

Public narrative copy may omit these editorial labels when its status is tracked in the source notes,
but proposals and placeholders must never be presented as established facts without approval.

## Required distinctions

- **Information classification** and **physical security authority** are separate systems. Never
  collapse a `TL-*` information code and an `S-*` access code into one clearance value.
- Preserve exact form families, document designators, original markings, and source titles.
- Store a historical Roman-numeral form marking separately from any normalized `TL-*` classification.
- Clearance eligibility, compartment authorization, and need-to-know are distinct concepts.
- Narrative discoverability is not security. Every deployed route and file may be found directly.

## Locked decisions

- Archive metadata maps legacy form Level I to `TL-1`, II to `TL-2`, III to `TL-3`, IV to
  `TL-4`, and V to `TL-5`. The historical Roman-numeral marking remains stored and displayed
  verbatim; the normalized value never rewrites a source artifact.
- `TIRN` means **Trinity Institutional Records Network**. Its public archive interface is named
  **TIRN — Records Gateway**.
- The approved public research list is **Advanced Materials**, **Industrial Instrumentation**,
  **Environmental Analysis**, **Applied Physics**, **Field Sampling & Geological Research**,
  **Laboratory Safety Systems**, **Prototype Evaluation**, and **Contract Research**.

## Open decisions

Until the owner resolves them, treat these as working questions rather than canon:

- the precise relationship between “Trinity Laboratories” and “Trinity Labs, Inc.”;
- the website-era framing; and
- any newly invented named person, facility, program, or incident.

Do not rewrite historical source files to make an approved digital crosswalk appear original.

## Asset publication workflow

1. Keep the original source in `/_IgnoreThis/` unchanged.
2. Confirm that the exact item is authorized for use and that its rights are compatible.
3. Create a web-suitable derivative only when needed; preserve the original separately.
4. Add the derivative to a deliberate public path, not a bulk source dump.
5. Record provenance, rights, attribution, transformation, checksum, and public path in
   `data/asset-ledger.json`.
6. Add alternative text, a caption, and a source note appropriate to its narrative role.
7. Optimize images and documents while retaining a readable archival copy when publication rights
   allow it.

Duplicate files should have one canonical published copy. Externally sourced material with unclear
rights remains excluded even when it is narratively useful.

## Writing and presentation

The public site should communicate credible scientific and industrial competence. The records
system may reveal unsettling material through procedure, classification, omissions, and restrained
contradictions. Avoid constant glitches, overt horror decoration, or imitation of another fictional
archive's identity.

Every page should remain understandable without animation. Redactions and unlisted records may
support the story, but must not interfere with keyboard access, readable HTML, or direct links.
Fictional/static-project context belongs in repository documentation, not in the public website's
in-world presentation. Privacy disclosures should appear only when a public interaction actually
collects or transmits user data.
