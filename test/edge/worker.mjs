import { runRuntimeContract } from '../runtime-contract.mjs'

export default {
  async fetch(_request, env) {
    try {
      const result = await runRuntimeContract('https://upstream.test', (input, init) => env.UPSTREAM.fetch(input, init))
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: String(error), stack: error.stack }, { status: 500 })
    }
  }
}
