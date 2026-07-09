import type { Client } from '../client'

export interface Plugin {
  name: string

  install: (client: Client) => void
}
