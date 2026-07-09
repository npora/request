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

console.log(todo)
