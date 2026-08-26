# Deployment Runbook

Production is a statically generated Astro site deployed to Cloudflare Workers Static Assets from a
public GitHub repository. The canonical origin is `https://trinitylaboratories.org`.

The implementation uses Astro 7 with the compatible Starlight line. This is an intentional
security-driven update from the original Astro 6 proposal; it does not introduce server rendering or
change the static deployment model.

## Cost boundary

The operating target is $0: static assets, Workers Builds, and public-repository GitHub Actions must
remain within their current free allowances. Domain renewal is the expected recurring cost. Recheck
the official [Cloudflare static-asset limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
[Workers Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/),
and [GitHub Actions billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
before launch and periodically afterward. Do not enable a paid product, add-on, or overage without
the owner's explicit approval.

## Workers Builds configuration

Connect the GitHub repository from **Cloudflare Dashboard → Workers & Pages → Create application →
Import a repository**. Limit the Cloudflare GitHub App to this repository.

Use these settings:

| Setting                   | Value                                    |
| ------------------------- | ---------------------------------------- |
| Root directory            | `/`                                      |
| Production branch         | `main`                                   |
| Preview branch builds     | Enabled                                  |
| Build command             | `npm run cf:install && npm run cf:build` |
| Production deploy command | `npm run cf:deploy`                      |
| Preview deploy command    | `npm run cf:deploy`                      |
| Node version              | `24.19.0`                                |

The repository pins Node in `.node-version` and `package.json`. Also set the Workers Builds
environment variable `NODE_VERSION=24.19.0` so the build image and local tooling agree.
Set `SKIP_DEPENDENCY_INSTALL=1` in Workers Builds so Cloudflare does not run an implicit package
install before the repository's explicit, lockfile-based `npm run cf:install` step.

`npm run cf:build` validates the repository and then delegates to `scripts/build-site.mjs`. The build
sets `PUBLIC_INDEXABLE=true` only when an explicit override says so or the detected CI branch is
`main`. The preparation and built-site checks infer the same branch policy. `npm run cf:deploy`
deploys `main` normally and uploads any other branch as a named, non-production preview version.

Keep preview URLs public for review, but never indexable. A preview build must contain `noindex,
nofollow` metadata and a restrictive `robots.txt`. In production, corporate and released-record
routes may be indexed; `/portal/`, `/records/reports/`, and `/records/submissions/` remain excluded
through HTML metadata, response headers, and the sitemap filter. These are discovery controls, not
confidentiality. Do not add credentials or private records to any build—the generated site is public
regardless of robot policy.

The TIRN Filing Workstation is not deployed. `npm run record-desk` binds it to `127.0.0.1`; ignored
drafts and owner-only authorization material under `.authoring/` must remain outside Git and every
Cloudflare build context.

For a manual deployment using the same branch-aware behavior:

```powershell
. .\scripts\bootstrap.ps1
.\scripts\run-local.ps1 cf:install
.\scripts\run-local.ps1 deploy
```

On Linux or macOS, use `npm run cf:install` followed by `npm run deploy`. The repository install
wrapper delegates to `npm ci --ignore-scripts`, matching Workers Builds.

For an intentional production recovery outside Workers Builds, use
`.\scripts\run-local.ps1 deploy:production` on Windows or `npm run deploy:production` elsewhere.
That command explicitly sets the production and indexability environment; do not use it for a
preview branch. Production deployment still refuses an uncommitted, dirty, nonignored-untracked,
detached, unknown, or non-`main` Git state. A native Workers Build may use a detached checkout only
when its verified commit SHA exactly matches the `main` build environment. Use
`.\scripts\run-local.ps1 deploy:preview` on Windows or
`npm run deploy:preview` elsewhere when a local preview upload is intentional. The generic deploy
command remains branch-aware and never routes inferred preview output to production.

## Custom domain and redirect

After the first healthy production deployment, add `trinitylaboratories.org` under **Worker →
Settings → Domains & Routes → Add → Custom Domain**. Cloudflare should create the origin DNS record
and certificate for the apex hostname.

Create one **Rules → Redirect Rules → Single Redirect** for the alternate hostname:

| Setting               | Value                                   |
| --------------------- | --------------------------------------- |
| Match type            | Wildcard pattern                        |
| Request URL           | `https://www.trinitylaboratories.org/*` |
| Target URL            | `https://trinitylaboratories.org/${1}`  |
| Status                | `301 Permanent Redirect`                |
| Preserve query string | Enabled                                 |

`${1}` is Cloudflare's wildcard capture for the original path (the conceptual `${path}`). Ensure
`www` has a proxied Cloudflare DNS record so the redirect rule can receive requests. Verify both a
nested path and query string, for example:

```text
https://www.trinitylaboratories.org/records/?q=sample
→ https://trinitylaboratories.org/records/?q=sample
```

## Analytics boundary

Do not enable Cloudflare Web Analytics, Browser Insights, or Real User Monitoring (RUM) for this
zone. Cloudflare may enable RUM automatically for free-plan zones, which injects a
`static.cloudflareinsights.com` beacon into otherwise static HTML responses. In **Domain → Speed →
Real user monitoring**, select **Disable completely** and confirm that the dashboard reports RUM is
disabled for the zone.

After changing this setting, verify a fresh browser context loads the corporate site, TIRN search,
and a search result without a `data-cf-beacon` script, a `cloudflareinsights.com` request, or a POST
to `/cdn-cgi/rum`. Cloudflare edge request counts are an infrastructure property; no client-side
analytics, beacon, or visitor-storage feature is part of this site.

## GitHub protection checklist

Protect `main` in the repository settings:

- require changes to arrive through pull requests;
- require zero approving reviews initially, until collaborators are added;
- require the repository validation workflow to pass;
- require branches to be up to date before merging;
- require review conversations to be resolved;
- block force pushes and branch deletion; and
- leave the organization owner configured to bypass the rules for emergency recovery.

Keep GitHub Actions permissions read-only except for a workflow with a documented need. Cloudflare
deployment credentials should remain in Cloudflare's native Git integration, not GitHub Actions.

## Production health monitoring

`.github/workflows/production-health.yml` performs a read-only production check once per day and
also supports a manual **Run workflow** action. It checks the public deployment only: it has no
Cloudflare credential, receives no GitHub secret, cannot deploy or roll back, and keeps repository
permissions at `contents: read`.

The monitor uses the Node version pinned by `.node-version` and the repository's external verifier.
It requires successful HTTPS responses at the canonical apex, confirms the root HSTS policy, checks
every required route and canonical URL, validates production robots and sitemap behavior, confirms
controlled-route `noindex` headers and metadata, and verifies that `www` returns one permanent
redirect while preserving path and query.

Run the same check locally after an intentional production release or DNS/redirect change:

```powershell
.\scripts\run-local.ps1 verify:production
```

On Linux or macOS, run `npm run verify:production`. A failed scheduled check should be rerun once to
rule out a transient network failure. Treat a repeated failure as an operational incident: compare
the active Cloudflare deployment with the last green commit, preserve the failed workflow log, and
follow the rollback procedure below when a recent release caused the regression. GitHub's normal
workflow-failure notifications provide alerting without a paid monitoring service or write access.

## Release verification

For production, verify:

1. the Workers build and GitHub required checks succeeded for the same commit;
2. the manually dispatched **Production health** workflow passes after the deployment is active;
3. the apex returns HTTPS with the expected certificate;
4. `www` redirects once to the same path and query at the apex;
5. canonical URLs, sitemap, and `robots.txt` use the apex;
6. public pages, `/employee-access/`, `/portal/`, `/records/`, controlled-report presentation,
   search, downloads, and the custom 404 work;
7. a fresh browser context loads no analytics beacon or third-party request; and
8. employee and authorization controls make no request containing entered values, store only
   allowlisted generic session/grant state, and clear that state on termination; and
9. portal and controlled-record routes are absent from the production sitemap and return
   `X-Robots-Tag: noindex`.

## Rollback

In **Cloudflare Dashboard → Worker → Deployments**, select the most recent known-good production
version and use **Rollback**. Confirm the apex and critical routes immediately after rollback.

Then revert the faulty Git commit through a pull request. A dashboard rollback changes the active
Cloudflare version but does not repair `main`; without the Git revert, the next build can redeploy the
fault. Manually dispatch **Production health**, then run the full release-verification checklist
again after the corrective deployment.
