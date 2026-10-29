export { DemoState } from '../functions/api/user.js'
export default {
  fetch() { return new Response('Demo state is available through a Durable Object binding only.', { status: 404 }) }
}
