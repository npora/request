import { createClient } from '../src'

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

const todo = await request.get<Todo>('/todos/1')
const response = await request.getResponse<Todo>('/todos/1')

const adminRequest = request.extend({
  baseURL: 'https://jsonplaceholder.typicode.com/admin',
  headers: {
    'x-client': 'admin'
  }
})

console.log(todo)
console.log(response.status, response.headers)
void adminRequest
