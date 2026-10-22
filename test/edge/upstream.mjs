export default {
  async fetch(request) {
    switch (new URL(request.url).pathname) {
      case '/api/user': return Response.json({ id: 1, name: 'Npora' })
      case '/api/upload': return Response.json({
        received: (await request.arrayBuffer()).byteLength,
        contentType: request.headers.get('content-type')
      })
      case '/api/slow':
        await new Promise(resolve => setTimeout(resolve, 100))
        return Response.json({ ok: true })
      case '/api/events': return new Response('data: one\n\ndata: two\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
      case '/api/records': return new Response('{"name":"你好"}\n{"name":"worker"}\n', {
        headers: { 'content-type': 'application/x-ndjson' }
      })
      default: return new Response(null, { status: 404 })
    }
  }
}
