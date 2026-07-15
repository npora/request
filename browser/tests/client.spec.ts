import {
  expect,
  test
} from '@playwright/test'

interface User {
  id: number
  name: string
}

interface BrowserRequestClient {
  get<T>(url: string): Promise<T>
}

interface BrowserWindow extends Window {
  nporaRequest?: BrowserRequestClient
  nporaReady?: boolean
  nporaError?: string
}

test(
  'should send a GET request in the browser',
  async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <title>
            Npora Request Browser Test
          </title>
        </head>

        <body>
          <main>
            <h1>
              Npora Request Browser Test
            </h1>
          </main>

          <script type="module">
            try {
              const {
                createClient
              } = await import(
                'http://127.0.0.1:4173/dist/index.js'
              )

              window.nporaRequest = createClient({
                baseURL:
                  'http://127.0.0.1:4173/api'
              })

              window.nporaReady = true
            } catch (error) {
              window.nporaError =
                error instanceof Error
                  ? error.message
                  : String(error)
            }
          </script>
        </body>
      </html>
    `)

    await page.waitForFunction(() => {
      const browserWindow =
        window as BrowserWindow

      return (
        browserWindow.nporaReady === true ||
        typeof browserWindow.nporaError ===
        'string'
      )
    })

    const initializationError =
      await page.evaluate(() => {
        const browserWindow =
          window as BrowserWindow

        return browserWindow.nporaError
      })

    expect(
      initializationError
    ).toBeUndefined()

    const user =
      await page.evaluate(async () => {
        const browserWindow =
          window as BrowserWindow

        if (!browserWindow.nporaRequest) {
          throw new Error(
            'Npora request client is unavailable'
          )
        }

        return browserWindow.nporaRequest.get<User>(
          '/user'
        )
      })

    expect(user).toEqual({
      id: 1,
      name: 'Npora'
    })
  }
)
