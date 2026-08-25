# Trinity Laboratories

The open-source website code for a fictional research institution, public corporate presence, and
static records archive.

> **Fiction notice:** Trinity Laboratories and its records are part of an interactive fiction
> project. The employee-access screen is theatrical, not authentication. Never enter a password
> used on another service.

The current release combines:

- a restrained public corporate website;
- a public studies register with browser-local interest and screening forms;
- a browser-local employee-access transition and staff portal;
- a searchable institutional records system under `/records/`, including a deliberately routine
  multi-decade technical archive and clearance-gated fictional personnel files; and
- a loopback-only Filing Workstation for preparing completed form records.

Everything deployed is public. Staff sessions, elevated grants, redactions, and unlisted records
are narrative devices, not security boundaries. Content that is truly withheld must remain outside
Git, the generated website, and every client-accessible asset.

Public study forms are simulations as well: they validate and reset in the browser without sending
or retaining participant information. They are not recruitment for real human-subject research.

## Architecture

- **Astro 7** generates static HTML.
- **Starlight** provides the records navigation and Pagefind-powered static search.
- **TypeScript and Astro content collections** validate structured record metadata.
- **Plain and scoped CSS** provide the visual system without a client framework.
- **Cloudflare Workers Static Assets** serves the generated `dist/` directory.
- **GitHub Actions** validates pull requests; Cloudflare Workers Builds handles previews and
  production deployment from `main`.
- **TIRN Filing Workstation** uses the pinned local Node runtime and repository content schemas; it
  binds only to `127.0.0.1` and has no hosted service.

The production origin is `https://trinitylaboratories.org`. No database, hosted CMS, real
authentication provider, or application server is required.

The initial architecture proposed Astro 6. The repository moved to Astro 7 before release because
the maintained Astro 6 line remained affected by published cross-site scripting advisories. The
static architecture and route design are otherwise unchanged.

## Local setup

This repository deliberately avoids machine-global project tooling. On Windows, start PowerShell in
the repository and dot-source the bootstrap script:

```powershell
. .\scripts\bootstrap.ps1
.\scripts\run-local.ps1 cf:install
.\scripts\run-local.ps1 dev
```

The script downloads the pinned official Node.js archive, verifies it against Node.js's published
SHA-256 manifest, stages and verifies the extracted runtime, and installs it at `.tools/node/`. It
then prepends that project-local installation to the current PowerShell process. The `.npmrc` file
also keeps npm's download cache under `.tools/`. On Windows,
the script marks `.tools/` and `node_modules/` with Dropbox's documented ignore attribute so these
large generated folders stay project-local without being synchronized.

The repository name intentionally begins with `#`, which Vite otherwise interprets as a URL
fragment on Windows. `scripts/run-local.ps1` gives only its child command a verified clean-path
alias, invokes the exact project-local npm executable, and removes the alias in `finally`. It
refuses to replace or remove any path or drive mapping whose type and target do not match what it
created. Use this launcher for local Windows npm scripts; GitHub Actions and Cloudflare builds use
ordinary npm commands because their clone paths do not contain `#`.

On another operating system, install the Node version in `.node-version` using an isolated version
manager, then run `npm ci`. Do not install project packages globally.

Useful commands:

| Windows command                                | Purpose                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `.\scripts\run-local.ps1 dev`                  | Start the local Astro development server                                    |
| `.\scripts\run-local.ps1 lint`                 | Lint Astro, TypeScript, and JavaScript source                               |
| `.\scripts\run-local.ps1 check`                | Run Astro and TypeScript diagnostics                                        |
| `.\scripts\run-local.ps1 test:unit`            | Run unit tests                                                              |
| `.\scripts\run-local.ps1 test:unit:coverage`   | Run unit tests with coverage                                                |
| `.\scripts\run-local.ps1 browser:install`      | Install Chromium under `.tools/` for browser tests                          |
| `.\scripts\run-local.ps1 test:e2e`             | Run Playwright browser tests                                                |
| `.\scripts\run-local.ps1 record-desk`          | Open the loopback-only TIRN Filing Workstation                              |
| `.\scripts\run-local.ps1 record-desk:validate` | Validate the machine-readable form definitions                              |
| `.\scripts\run-local.ps1 validate:submissions` | Validate publishable completed-form records                                 |
| `.\scripts\run-local.ps1 audit`                | Fail on high or critical dependency advisories                              |
| `.\scripts\run-local.ps1 build`                | Generate branch-aware static output in `dist/`                              |
| `.\scripts\run-local.ps1 build:production`     | Generate explicitly indexable production output in `dist/`                  |
| `.\scripts\run-local.ps1 validate`             | Run repository, asset, type, unit, build, deployment, and built-site checks |
| `.\scripts\run-local.ps1 cf:install`           | Reproduce the lockfile install used by Cloudflare Workers Builds            |
| `.\scripts\run-local.ps1 deploy:preview`       | Build, validate, and upload a non-indexable Cloudflare preview version      |
| `.\scripts\run-local.ps1 deploy:production`    | Intentionally build, validate, and deploy production from `main`            |

## Filing completed records

The Filing Workstation converts completed instances of approved Trinity form templates into
strict, reviewable JSON records. Local drafts stay under the ignored `.authoring/` directory. The
workstation never commits, pushes, merges, deploys, or transmits a response; publication still uses
a branch, pull request, green required checks, and merge to `main`.

Every response is explicitly marked as open, safe for a theatrical authorization reveal, or
withheld. Withheld responses contain no public value. A response marked for authorization must be
safe to publish because a reader can bypass any browser-only presentation control in a public
repository.

## Repository boundaries

`/_IgnoreThis/` is an intentionally untracked local reference library. It may contain private
working files, duplicated assets, and material whose publication rights have not been verified.
Never commit, modify, or publish it wholesale.

Only curated assets with a documented rights status may enter public paths. The authoritative asset
and rights inventory is `data/asset-ledger.json`; project canon and content rules are documented in
[`docs/canon-and-content.md`](docs/canon-and-content.md).

## Contributing and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request and
[`SECURITY.md`](SECURITY.md) before reporting a security or privacy issue. In particular, a change
that transmits or retains employee-gateway input is a security regression even though the gateway is
fictional.

## Licensing

- Source code is available under the [MIT License](LICENSE).
- Eligible original creative material identified in the asset ledger is licensed under
  [CC BY-NC-SA 4.0](CONTENT-LICENSE.md).
- Trinity names, logos, and brand identity remain reserved under [`TRADEMARKS.md`](TRADEMARKS.md).
- Third-party material retains its original terms; see
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Copyright © 2026 Trinity Laboratories contributors.
