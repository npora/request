import {
  createClient,
  MockAdapter,
  retryPlugin
} from '../src'

interface User {
  id: number
  name: string
}

const adapter = new MockAdapter()

adapter
  .onGet('/users/1')
  .replyOnce(503, {
    message: 'busy'
  })
  .onGet('/users/1')
  .reply(200, {
    id: 1,
    name: 'Npora'
  })

const request = createClient({
  adapter
}).use(
  retryPlugin({
    retries: 1,
    delay: 0
  })
)

const user = await request.get<User>('/users/1')

console.log(user)
