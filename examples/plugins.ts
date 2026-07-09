import {
  authPlugin,
  cachePlugin,
  createClient,
  loggerPlugin,
  retryPlugin
} from '../src'

interface Todo {
  userId: number
  id: number
  title: string
  completed: boolean
}

const request = createClient({
  baseURL: 'https://jsonplaceholder.typicode.com',
  timeout: 5000
})
  .use(
    retryPlugin({
      retries: 2,
      delay: 300
    })
  )
  .use(
    cachePlugin()
  )
  .use(
    authPlugin({
      token: ''
    })
  )
  .use(
    loggerPlugin()
  )

const todo = await request.get<Todo>('/todos/1', {
  cache: {
    enabled: true,
    ttl: 30000
  }
})

console.log(todo)
