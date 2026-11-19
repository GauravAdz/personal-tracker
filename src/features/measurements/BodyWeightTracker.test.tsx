import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  deleteBodyWeight,
  RecordNotFoundError,
  saveBodyWeight,
} from '../../data/repositories'
import { GymWorkspace } from '../gym/GymWorkspace'
import { BodyWeightTracker } from './BodyWeightTracker'

describe('BodyWeightTracker — check-ins, 7-day SVG/text trend, persistence, and pre-workout prompt (T15)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`body-weight-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('logs multiple check-ins per day, collapses only for the 7-day trend without counting missing days as zero, renders accessible SVG/text summary, and persists edits/deletions across reload', async () => {
    const user = userEvent.setup()

    // Seed an earlier check-in within the 7-day window (2026-10-24: 79.1 kg).
    await saveBodyWeight(
      {
        weightKg: 79.1,
        occurredAt: '2026-10-24T07:00:00.000Z',
        localDate: '2026-10-24',
        timeZone: 'Europe/Vienna',
        note: 'Baseline',
      },
      testDb,
    )

    let currentTime = new Date('2026-10-27T06:30:00.000Z')
    const { unmount } = render(
      <BodyWeightTracker
        database={testDb}
        now={() => currentTime}
        timeZone="Europe/Vienna"
      />,
    )

    // Wait for initial seeded entry to load (1 of 7 days).
    expect(await screen.findByText(/Note: Baseline/)).toBeVisible()
    expect(
      screen.getByLabelText('7-day body-weight text summary'),
    ).toHaveTextContent('1 of 7 days recorded')

    // Log first check-in today (80.5 kg at 06:30 UTC).
    const weightInput = screen.getByLabelText('Weight (kg)')
    const noteInput = screen.getByLabelText('Optional note')
    await user.type(weightInput, '80.5')
    await user.type(noteInput, 'Morning')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Logged 80.5 kg for 2026-10-27.',
    )

    // Log second check-in today (80.9 kg at 18:00 UTC) -> both check-ins stay in list,
    // while trend uses latest (80.9 kg) with 2026-10-24 (79.1 kg) => 2 of 7 days, avg 80 kg!
    currentTime = new Date('2026-10-27T18:00:00.000Z')
    await user.type(weightInput, '80.9')
    await user.type(noteInput, 'Evening')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Logged 80.9 kg for 2026-10-27.',
    )

    const list = screen.getByRole('list', { name: 'Body-weight check-ins' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)

    const summary = screen.getByLabelText('7-day body-weight text summary')
    expect(summary).toHaveTextContent('2 of 7 days recorded')
    expect(summary).toHaveTextContent('7-day average 80 kg')

    const chart = screen.getByRole('img', { name: /2 of 7 days recorded/i })
    expect(chart).toBeVisible()

    // Edit the 80.9 kg check-in to 81.1 kg and verify reload persistence.
    await user.click(
      screen.getByRole('button', { name: 'Edit 80.9 kg on 2026-10-27' }),
    )
    const editWeight = screen.getByLabelText('Edit weight (kg)')
    await user.clear(editWeight)
    await user.type(editWeight, '81.1')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Updated check-in on 2026-10-27 to 81.1 kg.',
    )

    // Unmount and remount to verify persistence across reload.
    unmount()
    render(
      <BodyWeightTracker
        database={testDb}
        now={() => currentTime}
        timeZone="Europe/Vienna"
      />,
    )

    const reloadedList = await screen.findByRole('list', {
      name: 'Body-weight check-ins',
    })
    expect(within(reloadedList).getAllByRole('listitem')).toHaveLength(3)
    expect(
      screen.getByLabelText('7-day body-weight text summary'),
    ).toHaveTextContent('7-day average 80.1 kg')

    // Delete the 81.1 kg check-in -> today falls back to 80.5 kg (avg (79.1 + 80.5)/2 = 79.8 kg).
    await user.click(
      screen.getByRole('button', { name: 'Delete 81.1 kg on 2026-10-27' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Deleted 81.1 kg check-in from 2026-10-27.',
    )
    expect(within(reloadedList).getAllByRole('listitem')).toHaveLength(2)
    expect(
      screen.getByLabelText('7-day body-weight text summary'),
    ).toHaveTextContent('7-day average 79.8 kg')
  })

  it('handles empty state, rejects invalid weights, and throws on missing delete target', async () => {
    const user = userEvent.setup()
    render(
      <BodyWeightTracker
        database={testDb}
        now={() => new Date('2026-10-27T08:00:00.000Z')}
        timeZone="Europe/Vienna"
      />,
    )

    expect(
      await screen.findByText('No body-weight check-ins logged yet.'),
    ).toBeVisible()
    expect(
      screen.getByText(/No body-weight check-ins recorded in the last 7/i),
    ).toBeVisible()
    expect(
      screen.getByLabelText('7-day body-weight text summary'),
    ).toHaveTextContent('0 of 7 days recorded')

    const weightInput = screen.getByLabelText('Weight (kg)')
    await user.type(weightInput, '0')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(await testDb.bodyWeights.count()).toBe(0)

    await user.clear(weightInput)
    await user.type(weightInput, '-12')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(await testDb.bodyWeights.count()).toBe(0)

    await expect(
      deleteBodyWeight('99999999-9999-4999-8999-999999999999', testDb),
    ).rejects.toThrow(RecordNotFoundError)
  })

  it('offers a skippable pre-workout body-weight prompt in GymWorkspace when enabled without blocking workout start', async () => {
    const user = userEvent.setup()
    const nowDate = new Date('2026-10-27T09:00:00.000Z')

    // 1. Enable the optional pre-workout prompt in BodyWeightTracker.
    const { unmount } = render(
      <BodyWeightTracker
        database={testDb}
        now={() => nowDate}
        timeZone="Europe/Vienna"
      />,
    )
    const toggle = await screen.findByLabelText(
      'Offer skippable weight check-in before starting a workout',
    )
    await user.click(toggle)
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Pre-workout weight check-in prompt enabled/i,
    )
    unmount()

    // 2. Open GymWorkspace -> Start empty workout offers skippable prompt; user skips it.
    render(
      <GymWorkspace
        database={testDb}
        catalog={[]}
        now={() => nowDate}
        timeZone="Europe/Vienna"
      />,
    )
    await user.click(
      await screen.findByRole('button', { name: 'Start empty workout' }),
    )
    const prompt = await screen.findByRole('region', {
      name: 'Pre-workout body-weight check-in',
    })
    await user.click(
      within(prompt).getByRole('button', { name: 'Skip & start workout' }),
    )

    expect(
      await screen.findByRole('region', { name: 'Active workout session' }),
    ).toBeVisible()
    expect(await testDb.bodyWeights.count()).toBe(0)

    // Finish the empty workout so we can test saving weight on the next workout start.
    await user.click(screen.getByRole('button', { name: 'Finish workout' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm finish workout' }),
    )
    await screen.findByRole('button', { name: 'Start empty workout' })

    // 3. Start empty workout again -> log 78.6 kg and start workout.
    await user.click(
      screen.getByRole('button', { name: 'Start empty workout' }),
    )
    const secondPrompt = await screen.findByRole('region', {
      name: 'Pre-workout body-weight check-in',
    })
    await user.type(
      within(secondPrompt).getByLabelText('Pre-workout weight (kg)'),
      '78.6',
    )
    await user.click(
      within(secondPrompt).getByRole('button', {
        name: 'Save weight & start workout',
      }),
    )

    expect(
      await screen.findByRole('region', { name: 'Active workout session' }),
    ).toBeVisible()
    const weights = await testDb.bodyWeights.toArray()
    expect(weights).toHaveLength(1)
    expect(weights[0]).toMatchObject({
      weightKg: 78.6,
      localDate: '2026-10-27',
      timeZone: 'Europe/Vienna',
    })
  })
})
