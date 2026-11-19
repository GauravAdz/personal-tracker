import { expect, test } from '@playwright/test'

test.describe('Installability and offline production shell', () => {
  test('activates service worker online, makes zero external requests, and reloads offline', async ({
    context,
    page,
  }) => {
    const externalRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.protocol.startsWith('http') &&
        url.origin !== 'http://127.0.0.1:4173'
      ) {
        externalRequests.push(request.url())
      }
    })

    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Home', level: 1 }),
    ).toBeVisible()

    // Verify installation metadata and web manifest.
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute('href')
    expect(manifestHref).toBeTruthy()
    const appleTouchHref = await page
      .locator('link[rel="apple-touch-icon"]')
      .getAttribute('href')
    expect(appleTouchHref).toContain('icons/apple-touch-icon.png')

    const manifestResponse = await page.request.get(
      manifestHref ?? '/manifest.webmanifest',
    )
    expect(manifestResponse.ok()).toBe(true)
    const manifestJson = (await manifestResponse.json()) as {
      display: string
      short_name: string
      icons: Array<{ sizes?: string; purpose?: string }>
    }
    expect(manifestJson.display).toBe('standalone')
    expect(manifestJson.short_name).toBe('Personal Tracker')
    expect(manifestJson.icons.some((icon) => icon.sizes === '192x192')).toBe(
      true,
    )
    expect(manifestJson.icons.some((icon) => icon.purpose === 'maskable')).toBe(
      true,
    )

    // Wait for Workbox service worker registration and active controller.
    const swActive = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const registration = await navigator.serviceWorker.ready
      return Boolean(registration.active)
    })
    expect(swActive).toBe(true)

    await page.reload()
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
    )

    // Go completely offline and verify full reload + route navigation work from SW precache.
    await context.setOffline(true)
    await page.reload()

    await expect(
      page.getByRole('heading', { name: 'Home', level: 1 }),
    ).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Settings', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Offline & persistent storage' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Backup & Restore' }),
    ).toBeVisible()

    await context.setOffline(false)
    expect(externalRequests).toEqual([])
  })

  test('prompts for service-worker update without auto-reloading the current session', async ({
    page,
  }) => {
    await page.goto('/#/workouts')
    await expect(
      page.getByRole('heading', { name: 'Workouts', level: 1 }),
    ).toBeVisible()

    await page.evaluate(() => {
      ;(window as Window & { __sessionSentinel?: string }).__sessionSentinel =
        'active-workout-untouched'
      window.dispatchEvent(new Event('personal-tracker:sw-update-available'))
    })

    const updateBanner = page.getByRole('complementary', {
      name: 'Application update status',
    })
    await expect(updateBanner).toBeVisible()
    await expect(
      updateBanner.getByRole('button', { name: 'Reload to update' }),
    ).toBeVisible()

    // Ensure no forced reload occurred while prompt is shown.
    const sentinel = await page.evaluate(
      () =>
        (window as Window & { __sessionSentinel?: string }).__sessionSentinel,
    )
    expect(sentinel).toBe('active-workout-untouched')

    await updateBanner.getByRole('button', { name: 'Postpone' }).click()
    await expect(updateBanner).toBeHidden()
  })
})
