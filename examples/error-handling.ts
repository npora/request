import {
  createClient,
  RequestError
} from '../src'

interface ErrorBody {
  message: string
}

const request = createClient({
  baseURL: 'https://api.example.com'
})

try {
  await request.get('/users/missing')
} catch (error) {
  if (error instanceof RequestError) {
    const requestError = error as RequestError<ErrorBody>

    console.error({
      code: requestError.code,
      status: requestError.status,
      message: requestError.data?.message
    })
  }
}
