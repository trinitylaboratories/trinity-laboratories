# Contributing

Thank you for helping build Trinity Laboratories. Contributions should preserve the project's
institutional tone, static architecture, safety guarantees, and documented canon boundaries.

## Before starting

1. Read `AGENTS.md` and `docs/canon-and-content.md`.
2. Search existing issues and pull requests before opening overlapping work.
3. Keep your changes narrowly scoped. Do not reformat or rewrite unrelated files.
4. Never modify or commit `/_IgnoreThis/`.

For substantial new features or lore, open a proposal first. Canon decisions, new named personnel,
new facilities, new incidents, and changes to established codes require owner approval.

## Development environment

Use the Node version pinned in `.node-version`. Windows contributors can use the repository-local,
checksum-verifying bootstrap:

```powershell
. .\scripts\bootstrap.ps1
.\scripts\run-local.ps1 cf:install
```

On Linux or macOS, use the pinned Node/npm versions and run `npm run cf:install`. The install
wrapper always delegates to `npm ci --ignore-scripts`; do not replace it with an implicit or
lifecycle-enabled install.

All JavaScript dependencies must remain local to this repository. Do not require contributors to
install a project-specific package globally.

Before submitting a code change, run:

```powershell
.\scripts\run-local.ps1 validate
```

On Linux or macOS, run `npm run validate`. On Windows, run
`.\scripts\run-local.ps1 browser:install` and `.\scripts\run-local.ps1 test:e2e` when changing
navigation, responsive behavior, the employee gateway, search, or another browser-visible
interaction. The equivalent non-Windows commands are `npm run browser:install` and
`npm run test:e2e`.

## Content and asset contributions

- Preserve exact supplied form codes, titles, classification terms, and physical-access terms.
- Keep original document markings separate from normalized website metadata.
- Label proposals and placeholders; do not promote them to established canon silently.
- Add searchable HTML or Markdown alongside scans when practical.
- Before adding any media or downloadable document, add or update its entry in
  `data/asset-ledger.json` with source, creator, rights, transformation, checksum, and public path.
- Do not publish an item with unknown or incompatible rights.

Original media and downloadable documents accepted under the content license must be identified in
the asset ledger. Original published prose in the source paths listed in `CONTENT-LICENSE.md` is
covered by that file's path-based grant. By contributing code, you agree to license that code under
MIT. By contributing eligible original creative content, you agree to license it under CC BY-NC-SA
4.0. No contribution grants rights to Trinity trademarks.

## Employee-gateway and authorization safety

The gateway is a local theatrical transition only. Changes must preserve all of these invariants:

- the interaction uses fictional non-credential fields and never presents a password field or asks
  for a real-world password;
- no submitted value leaves the browser;
- no submitted value is logged, hashed, analyzed, placed in a URL, retained in storage, or rendered
  after submission;
- only allowlisted generic session and expiring grant state may be stored;
- badge identifiers, entered codes, authorization credentials, purposes, and document responses may
  never be retained;
- transient local validation and credential comparison may occur only in browser memory; and
- direct `/records/` links continue to work.

Do not add analytics, session replay, third-party scripts, or real authentication to that route.

Browser-only authorization is bypassable presentation. Content marked for an authorization reveal
must be safe for the public repository. A withheld response must contain no plaintext value in Git,
the generated site, public assets, or Pagefind output.

## Filing completed records

Use the loopback-only Filing Workstation described in `docs/record-desk.md`. Keep drafts and
owner-only credentials under ignored `.authoring/` paths. Review the deterministic public JSON diff
before committing, and never bypass form-definition, submission, canon, rights, or public-safety
validation. The workstation must not commit, push, merge, or deploy on a contributor's behalf.

## Pull requests

Describe the user-visible change, affected routes or records, validation performed, and any canon or
licensing decision involved. Include screenshots for visual changes and note reduced-motion,
keyboard, narrow-screen, and print behavior when relevant.

Keep generated output, `node_modules/`, local tools, credentials, and private reference material out
of commits.
