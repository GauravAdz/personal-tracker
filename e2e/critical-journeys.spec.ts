import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.describe('Critical V1 user journeys, offline durability, backup recovery, and mobile layout (T18)', () => {
  test('main workout journey: empty install, validation errors, create routine, log sets, reload, resume, finish, verify history and Home', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Home', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Start workout' }),
    ).toBeVisible()
    await expect(page.getByText('No completed workouts yet.')).toBeVisible()

    // Navigate to Workouts via primary CTA.
    await page.getByRole('link', { name: 'Start workout' }).click()
    await expect(
      page.getByRole('heading', { name: 'Workouts', level: 1 }),
    ).toBeVisible()

    // Validation error: blank routine name rejected.
    const createRegion = page.getByRole('region', { name: 'Create routine' })
    await createRegion.getByRole('button', { name: 'Save routine' }).click()
    await expect(
      page.getByText('Routine name must not be blank.'),
    ).toBeVisible()

    // Create a routine with Barbell Bench Press.
    await createRegion.getByLabel('Routine name').fill('Push Day E2E')
    await createRegion
      .getByLabel('Filter exercise picker')
      .fill('Barbell Bench Press')
    await createRegion
      .getByRole('button', { name: 'Add exercise to routine' })
      .click()
    await createRegion.getByRole('button', { name: 'Save routine' }).click()

    const startRoutineBtn = page.getByRole('button', {
      name: 'Start Push Day E2E',
    })
    await expect(startRoutineBtn).toBeVisible()
    await startRoutineBtn.click()

    const activeSection = page.getByRole('region', {
      name: 'Active workout session',
    })
    await expect(activeSection).toBeVisible()

    const logger = page.getByRole('region', {
      name: /Set logger for #1 Barbell Bench Press/i,
    })

    // Validation error: 0 reps rejected without creating a set row.
    const repsInput = logger.getByLabel(/Actual reps \(#1 Barbell Bench Press/i)
    await repsInput.fill('0')
    await logger
      .getByRole('button', { name: /Log set for #1 Barbell Bench Press/i })
      .click()
    await expect(logger.getByRole('alert')).toBeVisible()

    // Log 2 working sets (80 kg x 8, 80 kg x 9).
    const loadInput = logger.getByLabel(/Load kg \(#1 Barbell Bench Press/i)
    await loadInput.fill('80')
    await repsInput.fill('8')
    await logger
      .getByRole('button', { name: /Log set for #1 Barbell Bench Press/i })
      .click()
    await expect(logger.getByRole('status')).toContainText('Logged Set #1')

    await repsInput.fill('9')
    await logger
      .getByRole('button', { name: /Log set for #1 Barbell Bench Press/i })
      .click()
    await expect(logger.getByRole('status')).toContainText('Logged Set #2')

    // Reload browser and confirm active workout resumes with both sets intact.
    await page.reload()
    await expect(
      page.getByRole('region', { name: 'Active workout session' }),
    ).toBeVisible()
    const reloadedCompleted = page
      .getByRole('region', {
        name: /Set logger for #1 Barbell Bench Press/i,
      })
      .getByRole('list', {
        name: /Completed sets for #1 Barbell Bench Press/i,
      })
    await expect(reloadedCompleted.getByRole('listitem')).toHaveCount(2)

    // Return to Home and verify Resume workout CTA reflects active workout.
    await page.getByRole('link', { name: 'Home' }).click()
    const resumeLink = page.getByRole('link', { name: 'Resume workout' })
    await expect(resumeLink).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Workout call to action' }),
    ).toContainText('2 sets logged')

    // Resume, finish with confirmation, and verify session history + Home last workout.
    await resumeLink.click()
    await page.getByRole('button', { name: 'Finish workout' }).click()
    await page.getByRole('button', { name: 'Confirm finish workout' }).click()

    const historyRegion = page.getByRole('region', {
      name: 'Workout session history',
    })
    await expect(historyRegion).toContainText('Push Day E2E')
    await expect(historyRegion).toContainText('Completed')
    await expect(historyRegion).toContainText(
      'Sets logged: 2 working, 0 warm-up (2 total)',
    )

    await page.getByRole('link', { name: 'Home' }).click()
    await expect(
      page.getByRole('region', { name: 'Last workout summary' }),
    ).toContainText('Push Day E2E')
  })

  test('offline workout journey: start online after SW activation, log and reload offline, complete with zero data loss', async ({
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
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready
      }
    })
    await page.reload()
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
    )

    // Go to Workouts, create a 1-exercise routine, and start it.
    await page.getByRole('link', { name: 'Workouts' }).click()
    const createRegion = page.getByRole('region', { name: 'Create routine' })
    await createRegion.getByLabel('Routine name').fill('Offline Gym Session')
    await createRegion
      .getByRole('button', { name: 'Add exercise to routine' })
      .click()
    await createRegion.getByRole('button', { name: 'Save routine' }).click()
    await page
      .getByRole('button', { name: 'Start Offline Gym Session' })
      .click()
    await expect(
      page.getByRole('region', { name: 'Active workout session' }),
    ).toBeVisible()

    // Go completely offline, log a set, reload offline, and finish offline.
    await context.setOffline(true)

    const logBtn = page.getByRole('button', { name: /^Log set for #1/i })
    await logBtn.click()
    await expect(page.getByText(/Logged Set #1/)).toBeVisible()

    await page.reload()
    const reloadedActive = page.getByRole('region', {
      name: 'Active workout session',
    })
    await expect(reloadedActive).toBeVisible()
    await expect(reloadedActive).toContainText('1 set logged')

    await page.getByRole('button', { name: 'Finish workout' }).click()
    await page.getByRole('button', { name: 'Confirm finish workout' }).click()
    await expect(
      page.getByRole('region', { name: 'Workout session history' }),
    ).toContainText('Offline Gym Session')

    await context.setOffline(false)
    expect(externalRequests).toEqual([])
  })

  test('backup export, corrupt import rejection, and clean-state restore preserving all data', async ({
    baseURL,
    browser,
    page,
  }) => {
    // 1. Seed user data: body weight on Health and a routine on Workouts.
    await page.goto('/#/health')
    await page.getByLabel('Weight (kg)').fill('79.2')
    await page.getByLabel('Optional note').fill('Pre-backup check-in')
    await page.getByRole('button', { name: 'Log weight' }).click()
    await expect(page.getByText('Logged 79.2 kg')).toBeVisible()

    await page.getByRole('link', { name: 'Workouts' }).click()
    const createRegion = page.getByRole('region', { name: 'Create routine' })
    await createRegion.getByLabel('Routine name').fill('Restorable Routine')
    await createRegion
      .getByRole('button', { name: 'Add exercise to routine' })
      .click()
    await createRegion.getByRole('button', { name: 'Save routine' }).click()
    await expect(
      page.getByRole('button', { name: 'Start Restorable Routine' }),
    ).toBeVisible()

    // 2. Export backup JSON from Settings.
    await page.getByRole('link', { name: 'Settings' }).click()
    const [exportDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download backup JSON' }).click(),
    ])
    const downloadPath = await exportDownload.path()
    expect(downloadPath).toBeTruthy()
    const backupBytes = await readFile(downloadPath!)

    // 3. Attempt corrupt backup import -> rejected cleanly, existing data untouched.
    const fileInput = page.getByLabel('Select backup JSON file')
    await fileInput.setInputFiles({
      name: 'corrupt.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "format": "bad-format", "schemaVersion": 99 }'),
    })
    await expect(page.getByRole('alert')).toBeVisible()

    await page.getByRole('link', { name: 'Health' }).click()
    await expect(page.getByText('Pre-backup check-in')).toBeVisible()

    // 4. Open a brand-new clean browser context (empty install) and restore from exported backup JSON.
    const cleanContext = await browser.newContext(
      baseURL ? { baseURL } : undefined,
    )
    const cleanPage = await cleanContext.newPage()
    try {
      await cleanPage.goto('/#/settings')
      await expect(cleanPage.getByText('Never exported')).toBeVisible()

      await cleanPage.getByLabel('Select backup JSON file').setInputFiles({
        name: 'valid-backup.json',
        mimeType: 'application/json',
        buffer: backupBytes,
      })
      const preview = cleanPage.getByLabel('Backup preview')
      await expect(preview).toBeVisible()
      await expect(preview).toContainText('1 routines')
      await expect(preview).toContainText('1 body-weight entries')

      const [safetyDownload] = await Promise.all([
        cleanPage.waitForEvent('download'),
        preview
          .getByRole('button', {
            name: 'Step 1: Download current snapshot before restore',
          })
          .click(),
      ])
      expect(await safetyDownload.path()).toBeTruthy()

      await preview
        .getByLabel(/I have downloaded a backup of my current data/i)
        .check()
      await preview
        .getByLabel(/I confirm replacing all local data on this device/i)
        .check()
      await preview
        .getByRole('button', { name: 'Replace all data with backup' })
        .click()

      await expect(
        cleanPage.getByText(/Restore complete\. Replaced local database/i),
      ).toBeVisible()

      // 5. Verify restored records on Health and Workouts in the restored install.
      await cleanPage
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Health' })
        .click()
      await expect(cleanPage.getByText('Pre-backup check-in')).toBeVisible()

      await cleanPage
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Workouts' })
        .click()
      await expect(
        cleanPage.getByRole('button', { name: 'Start Restorable Routine' }),
      ).toBeVisible()
    } finally {
      await cleanContext.close()
    }
  })

  test('daily habits AM/PM independence, status update, and body-weight SVG/text trend on Health', async ({
    page,
  }) => {
    await page.goto('/#/health')

    // Add optional AM/PM habit example and mark AM Done, PM Skipped.
    await page
      .getByRole('button', { name: 'Add [Example] AM / PM Check-in' })
      .click()
    await page
      .getByRole('button', {
        name: 'Mark done: [Example] Daily AM / PM Routine — AM',
      })
      .click()
    await page
      .getByRole('button', {
        name: 'Skip: [Example] Daily AM / PM Routine — PM',
      })
      .click()

    const slotsList = page.getByRole('list', {
      name: 'Slots for [Example] Daily AM / PM Routine',
    })
    await expect(slotsList).toContainText('Done')
    await expect(slotsList).toContainText('Skipped')

    // Update PM from Skipped to Done (updates same row) and verify persistence across reload.
    await page
      .getByRole('button', {
        name: 'Mark done: [Example] Daily AM / PM Routine — PM',
      })
      .click()
    await expect(slotsList.getByText('Done', { exact: true })).toHaveCount(2)
    await page.reload()
    const reloadedSlots = page.getByRole('list', {
      name: 'Slots for [Example] Daily AM / PM Routine',
    })
    await expect(reloadedSlots.getByText('Done', { exact: true })).toHaveCount(
      2,
    )

    // Log two body-weight readings on the same day -> 1 of 7 days trend + SVG + accessible summary.
    const weightInput = page.getByLabel('Weight (kg)')
    await weightInput.fill('80.4')
    await page.getByRole('button', { name: 'Log weight' }).click()
    await expect(page.getByText('Logged 80.4 kg')).toBeVisible()

    await weightInput.fill('80.8')
    await page.getByRole('button', { name: 'Log weight' }).click()
    await expect(page.getByText('Logged 80.8 kg')).toBeVisible()

    await expect(
      page
        .getByRole('list', { name: 'Body-weight check-ins' })
        .getByRole('listitem'),
    ).toHaveCount(2)
    await expect(
      page.getByLabel('7-day body-weight text summary'),
    ).toContainText('1 of 7 days recorded')
    await expect(
      page.getByRole('img', { name: /1 of 7 days recorded/i }),
    ).toBeVisible()
  })

  test('mobile 360px layout has no horizontal overflow across all five routes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    for (const hashRoute of [
      '/',
      '/#/workouts',
      '/#/exercises',
      '/#/health',
      '/#/settings',
    ]) {
      await page.goto(hashRoute)
      const overflowPx = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(
        overflowPx,
        `Horizontal overflow on ${hashRoute}`,
      ).toBeLessThanOrEqual(0)
    }
  })
})
