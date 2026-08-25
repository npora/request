---
'@npora/request': minor
---

Add tree-shakeable ESM and CommonJS subpath exports for the core client,
aggregate and individual official plugins, and MockAdapter testing utilities.
Keep the root entry point backward compatible while sharing internal chunks so
constructors and errors retain identity across entry points.
