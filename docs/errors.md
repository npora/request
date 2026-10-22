# Handle request failures

## Map schema issues to form fields

The optional helper keeps form-specific code out of the core entry:

```ts
import { isSchemaValidationError } from '@npora/request/core'
import { toFormErrors } from '@npora/request/schema-errors'

try {
  await api.get('/user', { schema: userSchema })
} catch (error) {
  if (!isSchemaValidationError(error)) throw error
  const { fieldErrors, formErrors } = toFormErrors(error.issues)
  // fieldErrors['users.0.name'] contains every message for that field.
  // Choose fieldErrors['users.0.name']?.[0] for a single-message UI.
}
```

The result is `{ formErrors: string[], fieldErrors: Record<string, string[]> }`.
Paths accept Standard Schema primitive keys and `{ key }` segments. Literal
dots and backslashes are escaped, so `['a.b']` maps to `a\\.b`, while `['a', 'b']`
maps to `a.b`. Duplicate messages are preserved in issue order. Missing/empty
paths and paths containing symbols become form-level errors. The field map
has a null prototype so keys such as `__proto__` are safe.

This maps validator issues; it does not infer a server's form-error protocol
from an arbitrary HTTP error body or introduce request-body validation.

Start by narrowing an unknown caught value with `isRequestError()`. An
application interceptor, hook, or custom adapter may throw an ordinary Error or
another value. Do not assume every failure has HTTP status or response data.
Generics describe data types; they do not validate an error payload at runtime.

```ts
import { isRequestError } from '@npora/request/core'

try {
  await api.get('/profile')
} catch (error) {
  if (!isRequestError(error)) throw error
  if (error.code === 'ABORT_ERROR') return
  if (error.code === 'HTTP_ERROR' && error.status === 404) {
    showMissingProfile()
    return
  }
  reportFailure(error.toJSON())
}
```

`ABORT_ERROR` often represents an expected view or session teardown. Decide
whether to notify the user based on the owning action rather than treating every
cancellation as a generic service failure. `error.status` is optional;
`SCHEMA_ERROR`, for example, can carry status 200 because the server response
succeeded but failed validation.

## Decide what to do

| Code | Meaning and application action |
| --- | --- |
| `CONFIG_ERROR` | Invalid request configuration. Fix the caller; repeating it is not recovery. |
| `HTTP_ERROR` | Rejected HTTP status. Inspect status and validated payload; handle expected 404 or authentication failure explicitly. |
| `NETWORK_ERROR` | Transport failure without an accepted response. Offer recovery appropriate to the request's replay safety. |
| `TIMEOUT_ERROR` | An attempt or total deadline expired. Stop waiting and respect the operation's remaining time budget. |
| `ABORT_ERROR` | The caller or owning scope cancelled the operation. Usually stop quietly. |
| `PARSER_ERROR` | Buffered or streamed content could not be consumed or parsed. Check the format; interrupted streams can also produce this code. |
| `SCHEMA_ERROR` | A response or stream item failed runtime validation. Inspect schema issues and fix the contract rather than retrying unchanged data. |
| `REQUEST_TOO_LARGE` | The outgoing body exceeds the configured limit. Reduce the input or intentionally change the limit. |
| `RESPONSE_TOO_LARGE` | Received bytes exceed the configured limit. Stop consumption; use a bounded export/download workflow if appropriate. |
| `CIRCUIT_OPEN` | The local circuit breaker blocked a failing upstream. Use application fallback and allow its recovery policy to operate. |
| `CONCURRENCY_LIMIT` | The local concurrency queue is full or its wait expired. Reduce work, coalesce requests, or revisit queue bounds. |
| `RATE_LIMIT` | The local rate-limit queue rejected or timed out a request. Reduce the attempted request rate or provide deliberate delayed recovery. |

A server HTTP 429 is `HTTP_ERROR` with `status === 429`; `RATE_LIMIT` describes
local queue admission. The rate-limit plugin can also coordinate server-directed
cooldowns. See [rate-limit options](configuration.md#extensionsratelimit).

If the auth plugin is installed, it may recover from 401 before the error reaches
the caller. A final authentication failure belongs to the application's session
policy; avoid starting an unbounded refresh loop in a catch block. See
[authentication](workflows.md#refresh-authentication-tokens).

## Keep retries deliberate

Retry is opt-in. Installing `retryPlugin()` without a `retries` value performs
zero retries. Request `extensions.retry` configures an installed plugin; it does
not install one. Start with safe reads and a finite operation budget:

```ts
import { createClient } from '@npora/request/core'
import { retryPlugin } from '@npora/request/plugins/retry'

const api = createClient({ timeout: 3000, totalTimeout: 8000 })
  .use(retryPlugin({ retries: 2, delay: 200, jitter: true }))
```

Do not retry a write solely because it timed out: the server may already have
committed it. Check method policy, body replayability, and the server's
idempotency contract. A timeout or network failure does not prove that no side
effect occurred. If an application query layer retries complete calls too,
attempt counts can multiply. Choose the owning layer deliberately.

`timeout` bounds each attempt; `totalTimeout` also includes hooks, retry delays,
parsing, interceptors, and stream consumption. A final error after retries is
still one of the documented error codes; there is no separate retry-exhausted
error class. See [retry options](configuration.md#extensionsretry).

## Catch failures while consuming streams

Getting an iterable does not mean its body has completed successfully. Catch
around iteration as well as request creation:

```ts
try {
  const records = await api.ndjson('/export', {
    signal: viewSignal,
    maxResponseSize: 10 * 1024 * 1024
  })
  for await (const record of records) renderRecord(record)
} catch (error) {
  if (!isRequestError(error)) throw error
  if (error.code !== 'ABORT_ERROR') reportFailure(error.toJSON())
}
```

Previously yielded items remain observed when a later item fails. Decide how the
UI marks a partial result; do not silently present it as a complete export.
Breaking out of iteration cancels the reader. Use explicit SSE reconnection only
when the application's event protocol supports replay/resumption; generic HTTP
retry does not resume already-consumed stream items.

Lazy SSE/NDJSON and returned ReadableStream failures can happen after the request
promise and pipeline error interceptors have completed. A request-level error
interceptor does not catch these later failures; keep the catch around iteration
or reader operations. ReadableStreams and these iterators are single-consumer
resources. Merely inspecting an already parsed JSON `error.data` object does not
consume a stream. Reading `error.response.raw` or iterating stream-valued data
does consume it, so assign one owner to that operation.

Abort signals and request deadlines discard queued stream data and release the
library's reader/timer resources without waiting for a source's pending cleanup
promise. Source cancellation is still requested and late cancellation failures
are observed. This does not make an uncooperative custom source finish its own
external cleanup, or change the native promise contract of an explicit reader
`cancel()` call.

## Log selected metadata

`error.toJSON()` includes name, message, code, and optional status, omitting
config, response bodies, and causes. Messages still follow your redaction policy.
Avoid spreading or directly logging the entire error. Use `error.data` for HTTP
error payloads; Fetch error bodies are consumed once and `error.response.raw`
is not guaranteed to remain separately readable. Error bodies have a default
10 MiB parsing cap, so metadata can be available while payload data is absent.

The cap omits an oversized buffered error payload instead of returning truncated
JSON. It does not limit successful downloads or all streaming responses; configure
`maxResponseSize` explicitly where a total byte limit is required. Prefer bounded
server diagnostics and a request identifier over raising the error cap merely
to retrieve a large stack trace.

Run the [offline error-handling example](../examples/errors.ts):

```sh
node --import tsx examples/errors.ts
```

It checks real FetchAdapter failures, schema rejection, caller cancellation,
local rate-limit admission, and preservation of application errors. It needs no
external server, schema library, or credentials.
