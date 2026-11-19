import type { ID } from './models'

export function isCatalogSourceId(value: string): boolean {
  return value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
}

export function createId(): ID {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error(
      'Secure UUID generation is unavailable. Use HTTPS or localhost.',
    )
  }
  return globalThis.crypto.randomUUID()
}

export function catalogExerciseId(sourceId: string): ID {
  if (!isCatalogSourceId(sourceId)) {
    throw new Error('Invalid catalog source ID.')
  }
  return `fedb:${sourceId}`
}
