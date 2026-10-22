# 1.20.1 consumer bundle measurement

Measured on 2026-10-22 from clean commit
`6494ac4c1a67c4d9db6c3f10710addc4379dff50`, after rebuilding the distribution.
The report records version 1.20.1, Node.js 24.18.0, macOS arm64, esbuild
0.28.2, browser ESM targeting ES2020, and gzip level 9. Distribution and
lockfile SHA-256 hashes are included in the [JSON report](consumer.json).

| Application | Single bundle gzip bytes | All split chunks gzip bytes |
| --- | ---: | ---: |
| root: basic | 14,286 | 14,286 |
| core: basic | 14,287 | 14,287 |
| core + retry | 15,646 | 15,646 |
| core + cache | 20,792 | 20,792 |
| core + memory cache | 15,507 | 15,507 |
| root: retry + cache | 22,137 | 22,137 |
| core + retry + cache | 22,203 | 22,203 |

Every scenario emits one file with no lazy chunks. Existing consumer budgets
pass without changes. This snapshot measures bundled size; it does not measure
network throughput, startup latency, or browser compatibility.

## Reproduce

Check out the recorded commit and install its locked dependencies, then run:

```sh
pnpm build
pnpm benchmark:consumer-size -- --output package-size-results/consumer-1.20.1.json
pnpm benchmark:consumer-size:check package-size-results/consumer-1.20.1.json
```

The output path differs from this archived report so a local reproduction does
not overwrite the original evidence. Timestamps and machine metadata may vary.
