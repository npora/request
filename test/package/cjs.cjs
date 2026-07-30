const assert = require('node:assert/strict')
const {
  createClient,
  MockAdapter
} = require('@npora/request')

async function main() {
  const adapter = new MockAdapter()

  adapter.on('/smoke', config => {
    return {
      format: 'cjs',
      method: config.method
    }
  })

  const request = createClient({
    adapter
  })
  const data = await request.get('/smoke')

  assert.deepEqual(data, {
    format: 'cjs',
    method: 'GET'
  })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
