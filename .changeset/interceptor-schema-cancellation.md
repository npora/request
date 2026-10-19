---
"@npora/request": patch
---

Honor external cancellation while waiting for asynchronous request/response
interceptors and response or streaming-item schema validators, without requiring
a total timeout. Ignore late completions, observe late rejections, and prevent
later interceptors from running after cancellation. Keep the testing adapter
independent of streaming response parsers.
