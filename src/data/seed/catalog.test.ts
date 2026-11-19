import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_CURATED_EXERCISES,
  MIN_CURATED_EXERCISES,
  normalizeUpstreamExercise,
  prepareExerciseCatalog,
  type UpstreamExerciseBundle,
} from '../../../scripts/prepare-exercises.mjs'
import { catalogExerciseSchema } from '../validation'
import {
  EXERCISE_CATALOG,
  EXERCISE_CATALOG_BY_ID,
  EXERCISE_CATALOG_PROVENANCE,
  EXERCISE_FALLBACK_IMAGE_PATH,
  resolveExerciseImagePaths,
  SEEDED_CATALOG_VERSION,
} from './index'
import rawUpstreamBundle from './upstream-curated-raw.json'

const projectRoot = path.resolve(import.meta.dirname, '../../..')
const publicDir = path.join(projectRoot, 'public')

describe('Offline exercise catalog import and provenance (T06)', () => {
  it('bundles 60–100 unique, schema-valid exercises with stable fedb: IDs', () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(
      MIN_CURATED_EXERCISES,
    )
    expect(EXERCISE_CATALOG.length).toBeLessThanOrEqual(MAX_CURATED_EXERCISES)
    expect(EXERCISE_CATALOG.length).toBe(
      EXERCISE_CATALOG_PROVENANCE.exerciseCount,
    )

    const ids = new Set<string>()
    const sourceIds = new Set<string>()

    for (const exercise of EXERCISE_CATALOG) {
      expect(catalogExerciseSchema.parse(exercise)).toEqual(exercise)
      expect(exercise.id).toBe(`fedb:${exercise.sourceId}`)
      expect(ids.has(exercise.id)).toBe(false)
      expect(sourceIds.has(exercise.sourceId)).toBe(false)
      ids.add(exercise.id)
      sourceIds.add(exercise.sourceId)
    }

    expect(EXERCISE_CATALOG_BY_ID.size).toBe(EXERCISE_CATALOG.length)
  })

  it('runs deterministically and matches the committed seed JSON and SHA-256 provenance', () => {
    const firstRun = prepareExerciseCatalog(
      rawUpstreamBundle as UpstreamExerciseBundle,
    )
    const secondRun = prepareExerciseCatalog(
      rawUpstreamBundle as UpstreamExerciseBundle,
    )

    expect(firstRun.canonicalOutputJson).toBe(secondRun.canonicalOutputJson)
    expect(firstRun.provenance).toEqual(secondRun.provenance)
    expect(firstRun.provenance).toEqual(EXERCISE_CATALOG_PROVENANCE)
    expect(firstRun.exercises).toEqual(EXERCISE_CATALOG)

    const diskExercises = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'src/data/seed/exercises.json'),
        'utf8',
      ),
    ) as unknown
    expect(firstRun.exercises).toEqual(diskExercises)
  })

  it('normalizes bodyweight equipment, deduplicates muscles, and rejects invalid upstream data', () => {
    const normalized = normalizeUpstreamExercise({
      id: 'Pushups',
      name: '  Pushups ',
      equipment: 'Body Only',
      primaryMuscles: ['Chest', 'chest'],
      secondaryMuscles: ['Chest', 'Triceps', 'triceps', 'Shoulders'],
      instructions: ['  Start in plank. ', '', 'Push back up.  '],
      category: ' Strength ',
      images: ['Pushups/0.jpg', 'Pushups/1.jpg'],
      mediaAuditStatus: 'self-created-svg',
    })

    expect(normalized).toEqual({
      id: 'fedb:Pushups',
      sourceId: 'Pushups',
      name: 'Pushups',
      equipment: null,
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps', 'shoulders'],
      instructions: ['Start in plank.', 'Push back up.'],
      category: 'strength',
      imagePaths: ['exercises/chest/0.svg', 'exercises/chest/1.svg'],
    })

    expect(() =>
      normalizeUpstreamExercise({
        id: 'Invalid Space ID',
        name: 'Invalid',
        primaryMuscles: ['chest'],
        instructions: ['Step 1'],
        category: 'strength',
      }),
    ).toThrow(/Invalid upstream exercise sourceId/)

    expect(() =>
      prepareExerciseCatalog({
        pinnedCommitSha: 'not-a-sha',
        exercises: [],
      }),
    ).toThrow(/40-character hex pinnedCommitSha/)

    expect(() =>
      prepareExerciseCatalog({
        pinnedCommitSha: EXERCISE_CATALOG_PROVENANCE.pinnedCommitSha,
        exercises: (
          rawUpstreamBundle as UpstreamExerciseBundle
        ).exercises.slice(0, 10),
      }),
    ).toThrow(/Curated catalog must contain 60–100 exercises/)
  })

  it('resolves all exercise image paths and fallback placeholder to local SVG assets without external URLs', () => {
    const fallbackFile = path.join(publicDir, EXERCISE_FALLBACK_IMAGE_PATH)
    expect(fs.existsSync(fallbackFile)).toBe(true)
    expect(fs.readFileSync(fallbackFile, 'utf8')).toContain('<svg')

    let hasDirectImages = false
    let hasFallbackOnly = false

    for (const exercise of EXERCISE_CATALOG) {
      if (exercise.imagePaths.length === 0) {
        hasFallbackOnly = true
      } else {
        hasDirectImages = true
      }

      const resolvedPaths = resolveExerciseImagePaths(exercise)
      expect(resolvedPaths.length).toBeGreaterThanOrEqual(1)

      for (const relativeAssetPath of resolvedPaths) {
        expect(relativeAssetPath).not.toMatch(/^https?:/i)
        const fullPath = path.join(publicDir, relativeAssetPath)
        expect(fs.existsSync(fullPath)).toBe(true)
        const svgContent = fs.readFileSync(fullPath, 'utf8')
        expect(svgContent).toContain('<svg')
      }
    }

    expect(hasDirectImages).toBe(true)
    expect(hasFallbackOnly).toBe(true)
  })

  it('documents upstream commit SHA, catalog version, and media license provenance', () => {
    expect(EXERCISE_CATALOG_PROVENANCE.pinnedCommitSha).toMatch(
      /^[0-9a-f]{40}$/,
    )
    expect(SEEDED_CATALOG_VERSION).toBe(
      `fedb-${EXERCISE_CATALOG_PROVENANCE.pinnedCommitSha.slice(0, 12)}`,
    )

    const licensePath = path.join(publicDir, 'exercises/LICENSE.md')
    expect(fs.existsSync(licensePath)).toBe(true)
    const licenseText = fs.readFileSync(licensePath, 'utf8')
    expect(licenseText).toContain(EXERCISE_CATALOG_PROVENANCE.pinnedCommitSha)
    expect(licenseText).toContain(SEEDED_CATALOG_VERSION)
    expect(licenseText).toContain('Unlicense')
  })
})
