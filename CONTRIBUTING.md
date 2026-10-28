# Contributing

## Keep the working tree tidy

Coverage, browser reports and CI benchmark/size reports live under the ignored
`.artifacts/` directory. `dist/` remains the package's build output.

```sh
pnpm clean:dry-run
pnpm clean
```

The cleaner removes known generated outputs, legacy report directories,
project-local caches and generated package tarballs. It retains installed
dependencies, source, tests, `.git`, environment files and IDE preferences.
Archived evidence under `docs/measurements/` is maintained documentation.
Rebuild before running checks that consume `dist/`. Generate fresh test reports
when needed; they are not source files to commit.

## Setup

Requirements:

- Node.js 24 for local development.
- pnpm 11.10.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

## Making changes

- Keep core request behavior small and stable.
- Prefer plugins for optional features.
- Add tests for every behavior change and regression.
- Preserve the zero-runtime-dependency policy.
- Do not export internal modules from the package root.
- Update the API, architecture, migration, security, or testing documentation
  when their contracts change.

User-visible changes require a Changesets entry:

```sh
pnpm changeset
```

Use an empty changeset only for changes that do not affect the published
package.

## Before opening a pull request

```sh
pnpm typecheck
pnpm test:coverage
pnpm test:examples
pnpm benchmark:types
pnpm test:release-workflow
pnpm build
pnpm test:package
pnpm test:security
pnpm audit:dependencies
```

Run `pnpm test:browser` when request transport, lifecycle, progress, or browser
behavior changes.

## Security

Do not open a public pull request for an undisclosed vulnerability. Follow
[SECURITY.md](SECURITY.md) for private reporting.
