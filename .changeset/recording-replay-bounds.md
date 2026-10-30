---
"@npora/request": patch
---

Validate recorded response metadata against the native Response constructor so
invalid status text is skipped rather than exported as an unusable fixture.
Reject arrays that already exceed the record budget before enumerating their
elements, preserving the original transport result in both cases.
