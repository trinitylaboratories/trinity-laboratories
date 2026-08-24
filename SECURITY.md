# Security Policy

## Supported version

Security and privacy fixes target the latest code on `main`. Until the first tagged release, older
commits are not maintained as supported versions.

## Reporting privately

Use GitHub's private vulnerability reporting flow from the repository's **Security** tab. Do not open
a public issue for a vulnerability, exposed secret, or privacy defect. Include reproduction steps,
affected routes, browser or environment details, and the smallest safe proof of impact.

If private vulnerability reporting is not enabled, open a public issue containing no sensitive
details and ask a maintainer to establish a private channel.

Do not include a real password, access token, personal information, or private source document in a
report.

## Project-specific security boundaries

This is a static interactive-fiction site. The employee gateway is not authentication and internal
record URLs are intentionally public. The following are nevertheless treated as security or privacy
defects:

- employee-gateway input is transmitted, retained, logged, hashed, analyzed, placed in a URL, or
  rendered after submission;
- an analytics, session-replay, or third-party script runs on the gateway;
- cross-site scripting, unsafe HTML handling, dependency compromise, or exposed deployment secrets;
- publication of an unapproved private source or an asset with incompatible rights; or
- documentation that represents narrative concealment as real access control.

Reports are acknowledged as promptly as maintainer availability allows. Maintainers will validate
the report, coordinate a fix and disclosure timeline, and credit reporters who request attribution
when it is safe to do so.
