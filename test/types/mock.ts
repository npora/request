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
  query: {
    active: true
  },
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
