import {
  MockAdapter,
  type MockReply,
  type MockReplyHandler,
  type MockRequestMatcher,
  type MockResponseOptions,
  type MockRoute,
  type MockURLMatcher,
  type RequestConfig
} from '@npora/request'

const matcher: MockRequestMatcher = {
  url: /^\/users\//,
  searchParams: new URLSearchParams([
    ['active', 'true']
  ]),
  headers: {
    authorization: 'Bearer token'
  }
}
const url: MockURLMatcher = '/users/1'
const options: MockResponseOptions = {
  delay: 10,
  headers: {
    'x-mock': 'true'
  }
}
const handler: MockReplyHandler<{ ok: boolean }> = config => {
  const reply: MockReply<{ ok: boolean }> = {
    status: config.method === 'GET' ? 200 : 201,
    data: {
      ok: true
    }
  }

  return reply
}
const adapter = new MockAdapter()
const route: MockRoute = adapter.onGet(matcher)

route.reply(handler)
adapter.onPost(url).replyOnce(201, { ok: true }, options)
adapter.onPut('/users/1').networkErrorOnce()
adapter.onDelete('/users/1').timeoutOnce()

const history: readonly RequestConfig[] = adapter.history

void history


// Recording is explicit and remains available from the testing-only entrypoint.
import { FetchAdapter } from '@npora/request/core'
import type { MockRecordOptions, MockRecording, MockRecordingStats } from '@npora/request/testing'
const recordingOptions: MockRecordOptions = {
  adapter: new FetchAdapter(), maxEntries: 10, maxRecordSize: 65536,
  transform(value) { return value.matcher.url === '/skip' ? undefined : value }
}
const recorder = new MockAdapter({ record: recordingOptions })
const recordings: readonly MockRecording[] = recorder.recordings
const stats: MockRecordingStats = recorder.recordingStats
const script: string = recorder.exportMocks()
recorder.clearRecordings()
void [recordings, stats, script]
// @ts-expect-error transforms are synchronous
new MockAdapter({ record: { adapter: new FetchAdapter(), transform: async value => value } })
