# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| 0.x | No |

Security fixes are released for the latest 1.x version. Upgrade to the newest
patch before reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not disclose vulnerabilities in public issues, discussions, pull requests,
or logs.

Use GitHub's **Report a vulnerability** action on the repository Security page
when private vulnerability reporting is available. Include:

- Affected versions and runtime.
- A minimal reproduction.
- Expected and observed impact.
- Any known workaround.
- Whether the issue has been disclosed elsewhere.

If private reporting is unavailable, open a public issue asking maintainers for
a private security contact without including vulnerability details.

Reports will be evaluated privately. Maintainers will coordinate validation,
fixes, release timing, and disclosure with the reporter when practical.

## Scope

Examples of in-scope reports include:

- Credential or sensitive-data disclosure caused by the library.
- Request smuggling or header injection caused by request construction.
- Cross-user cache disclosure under default behavior.
- Prototype pollution or unsafe configuration merging.
- Authentication refresh behavior that exposes or misroutes credentials.
- Published package or release-pipeline integrity issues.

Application-level SSRF policy, server CORS/TLS configuration, malicious custom
plugins/adapters, and vulnerabilities in unsupported versions are normally out
of scope unless the library violates its documented security boundary.
