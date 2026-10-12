---
"@npora/request": patch
---

Skip native body and query brand checks for ordinary records and primitive
values. This avoids exception construction while preparing form and query
requests.
