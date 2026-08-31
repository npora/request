---
'@npora/request': patch
---

Consume Fetch HTTP error bodies once while populating bounded error data instead
of retaining a separately readable cloned stream, preventing ignored errors
from buffering an unread response branch while preserving native metadata.
