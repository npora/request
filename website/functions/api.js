import { json } from './api/user.js'
export const onRequest = () => json({ error: 'Choose an /api/* endpoint' }, 404)
