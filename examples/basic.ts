import { createClient } from '../src'

async function main() {
  const request = createClient({
    baseURL: 'https://jsonplaceholder.typicode.com'
  })

  const data = await request.get('/todos/1')

  console.log(data)
}

main()