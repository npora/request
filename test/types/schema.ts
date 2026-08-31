import {
  createClient,
  type NporaResponse,
  type StandardSchemaV1
} from '@npora/request'

interface User {
  id: number
  name: string
}

const userSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'type-test',
    validate(value) {
      return {
        value: value as User
      }
    }
  }
}

const request = createClient()

const inferredUser: Promise<User> = request.get('/user', {
  schema: userSchema
})
const inferredPost: Promise<User> = request.post('/user', {
  schema: userSchema,
  json: {
    name: 'Npora'
  }
})
const inferredQuery: Promise<User> = request.query('/user-query', {
  schema: userSchema,
  json: { name: 'Npora' }
})
const inferredQueryResponse: Promise<NporaResponse<User>> =
  request.queryResponse('/user-query', {
    schema: userSchema,
    json: { name: 'Npora' }
  })
const inferredRequest: Promise<User> = request.request({
  url: '/user',
  schema: userSchema
})
const inferredNativeRequest: Promise<User> = request.request(
  new Request('https://api.example.com/user'),
  { schema: userSchema }
)
const nativeResponse: Promise<NporaResponse<User>> = request.requestResponse(
  new Request('https://api.example.com/user'),
  { schema: userSchema }
)
const inferredResponse: Promise<NporaResponse<User>> = request.getResponse(
  '/user',
  {
    schema: userSchema
  }
)
const explicitLegacyType: Promise<User> = request.get<User>('/legacy')

// @ts-expect-error Response schemas are endpoint-specific, not client defaults.
createClient({ schema: userSchema })

// @ts-expect-error Response schemas are endpoint-specific, not child defaults.
request.extend({ schema: userSchema })

void inferredUser
void inferredPost
void inferredQuery
void inferredQueryResponse
void inferredRequest
void inferredNativeRequest
void nativeResponse
void inferredResponse
void explicitLegacyType
