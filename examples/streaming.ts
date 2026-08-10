import {
  createClient,
  type ServerSentEvent
} from '../src'

interface AuditRecord {
  id: number
  action: string
}

const request = createClient({
  baseURL: 'https://api.example.com'
})

const events: AsyncIterable<ServerSentEvent> = await request.sse('/events')

for await (const event of events) {
  console.log(event.event, event.data)
}

const records = await request.ndjson<AuditRecord>('/audit.ndjson')

for await (const record of records) {
  console.log(record.id, record.action)
}
