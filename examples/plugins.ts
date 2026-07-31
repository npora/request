import {
  authPlugin,
  cachePlugin,
  circuitBreakerPlugin,
  createClient,
  loggerPlugin,
  retryPlugin,
  type RequestLogger
} from '../src'

interface Todo {
  userId: number
  id: number
  title: string
  completed: boolean
}

const logger: RequestLogger = {
  info(_message, entry) {
    console.log(JSON.stringify(entry))
  },
  error(_message, entry) {
    console.error(JSON.stringify(entry))
  }
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
    circuitBreakerPlugin({
      failureThreshold: 5,
      resetTimeout: 30000
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
    loggerPlugin({
      logger
    })
  )

const todo = await request.get<Todo>('/todos/1', {
  extensions: {
    cache: {
      enabled: true,
      ttl: 30000
    }
  }
})

console.log(todo)
