# No-Actions release

The owner approved replacing GitHub Actions with local release tests and native Cloudflare builds.
Pull request #21 published the public-site polish and removed the four workflow files. Production
commit `d79a5692d008444bcec271323eec7c228fc60810` passed Cloudflare's build and the local external
production verifier. Six live browser tests checked all six corporate pages at 360, 768, 1024,
1440, and 1920 pixels, loaded images, the footer credit, and the homepage's eight research links.
All six passed. The earlier full local browser suite passed all 1,133 tests.

Dependabot subsequently started managed updater jobs despite repository Actions being disabled.
GitHub documents that these jobs bypass Actions disablement. To honor the runner-free policy,
automatic security updates are now disabled and the version-update configuration is removed.
Read-only advisory alerts and existing secret-scanning/push protection are unchanged. CodeQL
default setup is not configured. Historical runs and earlier workflow files are retained in GitHub
and Git history; nothing needs to be erased to stop future automation.

Repository validation rejects both Actions workflows and Dependabot updater configurations.
Cloudflare remains the only required remote build check, tied to its GitHub app. Pull-request,
conversation-resolution, up-to-date-branch, no-force-push, and no-deletion protections remain.
Dependency fixes, license review, full browser testing, and production-health checks are local
release responsibilities, as described in the deployment runbook. No paid feature is introduced.

On this Windows checkout, Prettier must run from the physical repository path and coverage uses
`--maxWorkers=1` to avoid a parallel temp-file cleanup lock. Local Git object writes also encountered
permission errors; the first cleanup commit was created through GitHub's Git API after verifying
every changed blob against the local Git hash. Fetching that exact commit reconciled the local
checkout without changing directory permissions or discarding files.
