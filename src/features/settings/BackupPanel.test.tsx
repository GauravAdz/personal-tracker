import 'fake-indexeddb/auto'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportSnapshot } from '../../data/backup'
import { createDatabase, type PersonalTrackerDB } from '../../data/db'
import { saveBodyWeight, saveRoutine } from '../../data/repositories'
import { BackupPanel } from './BackupPanel'

const routineId = '11111111-1111-4111-8111-111111111111'
const itemOneId = '11111111-1111-4111-8111-111111111112'
const weightOneId = '22222222-2222-4222-8222-222222222221'
const weightTwoId = '22222222-2222-4222-8222-222222222222'
const fixedTime = '2026-10-27T10:30:00.000Z'

describe('BackupPanel', () => {
  let localDb: PersonalTrackerDB
  let remoteDb: PersonalTrackerDB

  beforeEach(() => {
    localDb = createDatabase(`panel-local-${crypto.randomUUID()}`)
    remoteDb = createDatabase(`panel-remote-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await localDb.delete()
    await remoteDb.delete()
  })

  it('displays the plaintext health-data warning, last export status, and downloads a backup JSON', async () => {
    const user = userEvent.setup()
    const downloads: Array<{ filename: string; content: string }> = []

    await saveBodyWeight(
      {
        id: weightOneId,
        weightKg: 76.5,
        occurredAt: fixedTime,
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
      },
      localDb,
    )

    render(
      <BackupPanel
        database={localDb}
        now={() => new Date(fixedTime)}
        onDownloadFile={(filename, content) =>
          downloads.push({ filename, content })
        }
      />,
    )

    expect(
      screen.getByRole('note', { name: 'Plaintext health-data warning' }),
    ).toBeVisible()
    expect(await screen.findByText('Never exported')).toBeVisible()
    expect(screen.getByText(/export a fresh backup JSON file/i)).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Download backup JSON' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Backup exported and downloaded',
    )
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.filename).toBe(
      'personal-tracker-backup-2026-10-27T10-30-00Z.json',
    )
    const parsed = JSON.parse(downloads[0]!.content) as {
      format: string
      schemaVersion: number
      exportedAt: string
    }
    expect(parsed.format).toBe('personal-tracker-backup')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe(fixedTime)

    expect(await screen.findByText(fixedTime)).toBeVisible()
  })

  it('rejects an invalid backup file with an alert and leaves local data unchanged', async () => {
    await saveBodyWeight(
      {
        id: weightOneId,
        weightKg: 76.5,
        occurredAt: fixedTime,
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
      },
      localDb,
    )

    render(
      <BackupPanel
        database={localDb}
        now={() => new Date(fixedTime)}
        onDownloadFile={vi.fn()}
      />,
    )
    await screen.findByText('Never exported')

    const fileInput = screen.getByLabelText('Select backup JSON file')
    const corruptFile = new File(
      ['{"format":"personal-tracker-backup","schemaVersion":99}'],
      'future.json',
      {
        type: 'application/json',
      },
    )
    fireEvent.change(fileInput, { target: { files: [corruptFile] } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unsupported backup schema version/i)
    expect(alert).toHaveTextContent(/No local data was modified/i)
    expect(
      screen.queryByRole('region', { name: 'Backup preview' }),
    ).not.toBeInTheDocument()
    expect(await localDb.bodyWeights.count()).toBe(1)
  })

  it('requires downloading current snapshot and checking both acknowledgements before replacing all data', async () => {
    const user = userEvent.setup()
    const downloads: string[] = []

    // Seed localDb with existing weightOneId (1 record).
    await saveBodyWeight(
      {
        id: weightOneId,
        weightKg: 76.5,
        occurredAt: fixedTime,
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
      },
      localDb,
    )

    // Seed remoteDb with routine + weightTwoId.
    await saveRoutine(
      {
        id: routineId,
        name: 'Push A',
        items: [
          {
            id: itemOneId,
            exerciseId: 'fedb:Barbell_Bench_Press',
            order: 0,
            workingSets: 3,
            repMin: 8,
            repMax: 12,
            restSeconds: 90,
          },
        ],
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      remoteDb,
    )
    await saveBodyWeight(
      {
        id: weightTwoId,
        weightKg: 75.1,
        occurredAt: '2026-10-25T08:00:00.000Z',
        localDate: '2026-10-25',
        timeZone: 'Europe/Vienna',
      },
      remoteDb,
    )
    const remoteSnapshot = await exportSnapshot(
      { exportedAt: '2026-10-26T09:00:00.000Z' },
      remoteDb,
    )

    render(
      <BackupPanel
        database={localDb}
        now={() => new Date(fixedTime)}
        onDownloadFile={(filename) => downloads.push(filename)}
      />,
    )
    await screen.findByText('Never exported')

    const fileInput = screen.getByLabelText('Select backup JSON file')
    const validFile = new File(
      [JSON.stringify(remoteSnapshot)],
      'imported-backup.json',
      { type: 'application/json' },
    )
    fireEvent.change(fileInput, { target: { files: [validFile] } })

    expect(
      await screen.findByText(/Backup preview \(imported-backup\.json\)/i),
    ).toBeVisible()
    expect(
      screen.getByText(/Will replace 1 existing local records/i),
    ).toBeVisible()
    expect(screen.getByText(/2026-10-20 to 2026-10-26/i)).toBeVisible()

    const safetyAckCheckbox = screen.getByRole('checkbox', {
      name: /I have downloaded a backup of my current data/i,
    })
    const replaceConfirmCheckbox = screen.getByRole('checkbox', {
      name: /I confirm replacing all local data/i,
    })
    const replaceButton = screen.getByRole('button', {
      name: 'Replace all data with backup',
    })

    // Both checkboxes and the Replace button are disabled before Step 1 download.
    expect(safetyAckCheckbox).toBeDisabled()
    expect(replaceConfirmCheckbox).toBeDisabled()
    expect(replaceButton).toBeDisabled()

    await user.click(
      screen.getByRole('button', {
        name: 'Step 1: Download current snapshot before restore',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Safety backup downloaded/i,
    )
    expect(downloads).toHaveLength(1)
    expect(safetyAckCheckbox).toBeEnabled()
    expect(replaceConfirmCheckbox).toBeEnabled()
    expect(replaceButton).toBeDisabled()

    await user.click(safetyAckCheckbox)
    expect(replaceButton).toBeDisabled()

    await user.click(replaceConfirmCheckbox)
    expect(replaceButton).toBeEnabled()

    await user.click(replaceButton)

    expect(
      await screen.findByText(
        /Restore complete\. Replaced local database with 3 records from backup\./i,
      ),
    ).toBeVisible()
    expect(await localDb.bodyWeights.get(weightOneId)).toBeUndefined()
    expect((await localDb.bodyWeights.get(weightTwoId))?.weightKg).toBe(75.1)
    expect((await localDb.routines.get(routineId))?.name).toBe('Push A')
  })

  it('requests persistent storage and displays denied/unsupported fallback explanations', async () => {
    const user = userEvent.setup()
    const deniedStorage = {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    }

    const { rerender } = render(
      <BackupPanel
        database={localDb}
        now={() => new Date(fixedTime)}
        onDownloadFile={vi.fn()}
        storageManager={deniedStorage}
      />,
    )

    expect(
      await screen.findByText(/Best-effort \(not yet marked persistent\)/i),
    ).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Request persistent storage' }),
    )
    expect(deniedStorage.persist).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Denied by browser/i)).toBeVisible()
    expect(
      screen.getByRole('note', {
        name: 'Persistent storage fallback explanation',
      }),
    ).toHaveTextContent(/Your browser declined persistent storage/i)

    const grantedStorage = {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(true),
    }
    rerender(
      <BackupPanel
        database={localDb}
        now={() => new Date(fixedTime)}
        onDownloadFile={vi.fn()}
        storageManager={grantedStorage}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'Request persistent storage' }),
    )
    expect(
      await screen.findByText(
        /Granted \(protected from automatic browser eviction\)/i,
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Request persistent storage' }),
    ).not.toBeInTheDocument()
  })
})
