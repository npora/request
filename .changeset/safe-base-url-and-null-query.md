---
'@npora/request': minor
---

Add `allowAbsoluteUrls` so clients can prevent absolute request URLs from
bypassing a configured `baseURL`, including URLs introduced by lifecycle
extensions. Serialize `null` query and form values as empty values while
continuing to omit `undefined`, matching the documented request contract.
