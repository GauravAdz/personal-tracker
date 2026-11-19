import 'fake-indexeddb/auto'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import {
  archiveHabitDefinition,
  listHabitLogsForHabit,
  RecordNotFoundError,
} from '../../data/repositories'
import { DailyHabits } from './DailyHabits'

describe('DailyHabits — generic scheduled habits, independent slots, rollover, and archive (T14)', () => {
  let testDb: PersonalTrackerDB

  beforeEach(() => {
    testDb = createDatabase(`daily-habits-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('creates custom habits, logs two same-day slots independently, updates same row on repeated tap, supports undo, and survives reload', async () => {
    const user = userEvent.setup()
    let currentTime = new Date('2026-10-27T07:15:00.000Z')

    const { unmount } = render(
      <DailyHabits
        database={testDb}
        now={() => currentTime}
        timeZone="Europe/Vienna"
      />,
    )

    // Empty state offers optional AM/PM example without clinical dosing claims.
    expect(await screen.findByText(/No active daily habits yet/i)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Add [Example] AM / PM Check-in' }),
    ).toBeVisible()

    // Create a custom habit with AM, PM, and a custom Midday slot + optional quantity label.
    await user.click(screen.getByRole('button', { name: 'New habit' }))
    const createRegion = screen.getByRole('region', { name: 'Create habit' })

    await user.type(
      within(createRegion).getByLabelText('Habit name'),
      'Hydration Check',
    )
    await user.type(
      within(createRegion).getByLabelText('Optional quantity label'),
      'glasses',
    )
    await user.click(
      within(createRegion).getByRole('button', { name: 'Add slot' }),
    )
    await user.type(
      within(createRegion).getByLabelText('Slot 3 label'),
      'Midday',
    )
    await user.type(
      within(createRegion).getByLabelText('Slot 3 time (HH:MM)'),
      '13:30',
    )

    await user.click(
      within(createRegion).getByRole('button', { name: 'Save habit' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created habit "Hydration Check".',
    )

    // Mark AM done with quantity 2.
    const amQuantityInput = screen.getByLabelText(
      'Quantity for Hydration Check — AM',
    )
    await user.type(amQuantityInput, '2')
    await user.click(
      screen.getByRole('button', { name: 'Mark done: Hydration Check — AM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "Hydration Check — AM" as done for 2026-10-27.',
    )

    const logsAfterFirstTap = await testDb.habitLogs.toArray()
    expect(logsAfterFirstTap).toHaveLength(1)
    const amLogId = logsAfterFirstTap[0]!.id
    expect(logsAfterFirstTap[0]).toMatchObject({
      localDate: '2026-10-27',
      timeZone: 'Europe/Vienna',
      status: 'done',
      occurredAt: '2026-10-27T07:15:00.000Z',
      quantity: 2,
    })

    // Repeated tap on AM updates the SAME row (no duplicate created).
    currentTime = new Date('2026-10-27T07:20:00.000Z')
    await user.clear(amQuantityInput)
    await user.type(amQuantityInput, '3')
    await user.click(
      screen.getByRole('button', { name: 'Mark done: Hydration Check — AM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "Hydration Check — AM" as done for 2026-10-27.',
    )

    const logsAfterRepeatTap = await testDb.habitLogs.toArray()
    expect(logsAfterRepeatTap).toHaveLength(1)
    expect(logsAfterRepeatTap[0]!.id).toBe(amLogId)
    expect(logsAfterRepeatTap[0]!.occurredAt).toBe('2026-10-27T07:20:00.000Z')
    expect(logsAfterRepeatTap[0]!.quantity).toBe(3)

    // Mark PM skipped independently without altering AM.
    currentTime = new Date('2026-10-27T19:05:00.000Z')
    await user.click(
      screen.getByRole('button', { name: 'Skip: Hydration Check — PM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "Hydration Check — PM" as skipped for 2026-10-27.',
    )
    expect(await testDb.habitLogs.count()).toBe(2)

    // Reload component and verify both independent slot logs survive.
    unmount()
    render(
      <DailyHabits
        database={testDb}
        now={() => currentTime}
        timeZone="Europe/Vienna"
      />,
    )

    const slotsList = await screen.findByRole('list', {
      name: 'Slots for Hydration Check',
    })
    expect(within(slotsList).getByText('Done')).toBeVisible()
    expect(within(slotsList).getByText('Skipped')).toBeVisible()
    expect(within(slotsList).getByText(/3 glasses/)).toBeVisible()

    // Undo PM leaves AM intact.
    await user.click(
      screen.getByRole('button', { name: 'Undo: Hydration Check — PM' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Cleared check-in for "Hydration Check — PM" on 2026-10-27.',
    )
    expect(await testDb.habitLogs.count()).toBe(1)
    expect((await testDb.habitLogs.toArray())[0]!.id).toBe(amLogId)
  })

  it('handles IANA time zones, midnight date rollover, day navigation, and preserves history on archive/restore', async () => {
    const user = userEvent.setup()
    // 23:30 UTC on Oct 27 is 00:30 on Oct 28 in Europe/Vienna (UTC+1).
    let currentTime = new Date('2026-10-27T23:30:00.000Z')

    render(
      <DailyHabits
        database={testDb}
        now={() => currentTime}
        timeZone="Europe/Vienna"
      />,
    )

    expect(await screen.findByLabelText('Calendar date')).toHaveValue(
      '2026-10-28',
    )

    // Seed optional AM/PM example template.
    await user.click(
      await screen.findByRole('button', {
        name: 'Add [Example] AM / PM Check-in',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Added optional \[Example\] Daily AM \/ PM Routine/i,
    )

    // Log AM on 2026-10-28.
    await user.click(
      screen.getByRole('button', {
        name: 'Mark done: [Example] Daily AM / PM Routine — AM',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked "[Example] Daily AM / PM Routine — AM" as done for 2026-10-28.',
    )

    // Rollover across midnight to 2026-10-29 in Europe/Vienna when window regains focus.
    currentTime = new Date('2026-10-28T23:15:00.000Z')
    fireEvent.focus(window)
    expect(screen.getByLabelText('Calendar date')).toHaveValue('2026-10-29')
    // 2026-10-29 has no logs yet.
    await waitFor(() => {
      expect(screen.getAllByText('Not logged')).toHaveLength(2)
    })

    // Navigate back to 2026-10-28 -> previous day's log is present.
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByLabelText('Calendar date')).toHaveValue('2026-10-28')
    expect(await screen.findByText('Done')).toBeVisible()

    // Archive habit -> removed from active list, history preserved in DB and UI.
    const [habit] = await testDb.habits.toArray()
    await user.click(
      screen.getByRole('button', {
        name: 'Archive [Example] Daily AM / PM Routine',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Historical check-ins are preserved/i,
    )

    const preservedLogs = await listHabitLogsForHabit(habit!.id, testDb)
    expect(preservedLogs).toHaveLength(1)
    expect(preservedLogs[0]!.localDate).toBe('2026-10-28')

    const archivedHistory = screen.getByRole('region', {
      name: 'Archived habit history for 2026-10-28',
    })
    expect(archivedHistory).toHaveTextContent('[Example] Daily AM / PM Routine')
    expect(archivedHistory).toHaveTextContent('Done')

    // Show archived habits and restore it.
    await user.click(
      screen.getByRole('button', { name: 'Show archived habits (1)' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Restore [Example] Daily AM / PM Routine',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Restored "[Example] Daily AM / PM Routine" to active daily habits.',
    )
    expect(
      screen.getByRole('list', {
        name: 'Slots for [Example] Daily AM / PM Routine',
      }),
    ).toBeVisible()
  })

  it('rejects invalid habit inputs, blocks removing a slot with logged history, and throws on missing archive target', async () => {
    const user = userEvent.setup()
    const nowDate = new Date('2026-10-27T09:00:00.000Z')

    render(
      <DailyHabits
        database={testDb}
        now={() => nowDate}
        timeZone="America/Los_Angeles"
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'New habit' }))
    const createRegion = screen.getByRole('region', { name: 'Create habit' })

    // Blank habit name rejected.
    await user.click(
      within(createRegion).getByRole('button', { name: 'Save habit' }),
    )
    expect(within(createRegion).getByRole('alert')).toBeVisible()
    expect(await testDb.habits.count()).toBe(0)

    // Invalid HH:MM slot time rejected.
    await user.type(
      within(createRegion).getByLabelText('Habit name'),
      'Mobility',
    )
    const slot1Time = within(createRegion).getByLabelText('Slot 1 time (HH:MM)')
    await user.clear(slot1Time)
    await user.type(slot1Time, '25:99')
    await user.click(
      within(createRegion).getByRole('button', { name: 'Save habit' }),
    )
    expect(within(createRegion).getByRole('alert')).toBeVisible()
    expect(await testDb.habits.count()).toBe(0)

    // Fix time and save validly.
    await user.clear(slot1Time)
    await user.type(slot1Time, '08:30')
    await user.click(
      within(createRegion).getByRole('button', { name: 'Save habit' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created habit "Mobility".',
    )

    // Log AM slot, then attempt to edit Mobility and remove Slot 1 (AM) -> blocked to protect history.
    await user.click(
      screen.getByRole('button', { name: 'Mark done: Mobility — AM' }),
    )
    await screen.findByText('Done')

    await user.click(screen.getByRole('button', { name: 'Edit Mobility' }))
    const editRegion = screen.getByRole('region', { name: 'Edit habit' })
    await user.click(
      within(editRegion).getByRole('button', { name: 'Remove slot 1' }),
    )
    await user.click(
      within(editRegion).getByRole('button', { name: 'Save changes' }),
    )
    expect(within(editRegion).getByRole('alert')).toHaveTextContent(
      /Cannot remove a slot that already has logged history/i,
    )

    // Archiving a nonexistent habit throws RecordNotFoundError.
    await expect(
      archiveHabitDefinition(
        '99999999-9999-4999-8999-999999999999',
        true,
        nowDate.toISOString(),
        testDb,
      ),
    ).rejects.toThrow(RecordNotFoundError)
  })
})
