# Trinity Laboratories Agent Instructions

These instructions apply to the entire repository unless a more specific `AGENTS.md` narrows the
scope further.

## Repository boundary

- Work only inside this repository and only in the paths assigned for the current task.
- Multiple agents may work concurrently. Inspect existing changes before editing, preserve work you
  do not own, and do not reformat unrelated files.
- Do not read from, install into, or modify another project to obtain tools or dependencies.
- Install project-specific runtimes and downloaded tools under the ignored `.tools/` directory.
  Install JavaScript packages locally in `node_modules/`; never use global package installation for
  this project.

## Protected local material

- `/_IgnoreThis/` is the owner's private, local reference library. Never rename, move, delete,
  modify, format, publish, or commit anything in it.
- Import material from `/_IgnoreThis/` only when the owner or task explicitly authorizes the exact
  item. Copy an approved derivative into a public project path; do not relocate the source.
- Before publishing an asset, record its provenance, rights status, transformation, and public path
  in `data/asset-ledger.json`. Unclear rights are a blocker, not permission to publish.

## Canon and safety

- Follow `docs/canon-and-content.md`. Preserve supplied names, codes, titles, classifications, and
  the distinction between information classification and physical-access authority.
- Do not silently reconcile contradictory sources or present proposed lore as established canon.
- This is a static fictional experience. Do not add real authentication, a credential API, a
  database, or server-side session handling unless the owner explicitly changes the architecture.
- The employee gateway and authorization console may transiently validate fictional credentials in
  local browser memory. They must never transmit, persist, log, or reflect raw entered values.
  `sessionStorage` may contain only allowlisted generic state such as an accepted-session flag,
  information-level and endorsement enums, grant scope, and expiry time. It must never contain a
  badge identifier, entered credential, justification, document response, or reusable secret.
- Browser-side authorization is presentation, not a security boundary. Content marked as safe for a
  theatrical reveal may be discoverable in public source. Truly withheld content must not enter the
  repository, generated site, Pagefind output, or client-accessible assets.
- Local authoring services must bind only to `127.0.0.1`, keep drafts under ignored local paths, and
  leave all commits, pushes, merges, and deployments to the normal reviewed Git workflow.

## Quality bar

- Keep the public site and records archive responsive, keyboard-accessible, print-aware where
  appropriate, and usable with reduced motion.
- Keep production output static. Add client-side JavaScript only when it supports a concrete
  interaction.
- Run the relevant checks before handoff and report anything that could not be run.
