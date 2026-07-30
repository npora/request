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
    await page.goto('/')

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
