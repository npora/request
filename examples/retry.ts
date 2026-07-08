import { createClient } from '../src'

async function main() {
  const request = createClient({
    baseURL: 'https://jsonplaceholder.typicode.com',
    retry: {
      retries: 2,
      delay: attempt => attempt * 300
    }
  })

  const data = await request.get('/todos/1')

  console.log(data)
}

main()
