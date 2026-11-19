import console from 'node:console'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const MIN_CURATED_EXERCISES = 60
export const MAX_CURATED_EXERCISES = 100
export const FALLBACK_IMAGE_PATH = 'exercises/placeholder.svg'

const BODYWEIGHT_EQUIPMENT_LABELS = new Set([
  '',
  'none',
  'body only',
  'bodyweight',
])

const DIAGRAM_GROUPS = {
  chest: {
    title: 'Horizontal Press / Fly',
    startLabel: 'Start: Eccentric / Loaded Position',
    endLabel: 'End: Concentric / Extended Position',
    accent: '#215b3c',
  },
  back: {
    title: 'Vertical & Horizontal Pull',
    startLabel: 'Start: Extended Hang / Reach',
    endLabel: 'End: Peak Contraction / Row',
    accent: '#276749',
  },
  shoulders: {
    title: 'Overhead Press & Deltoid Raise',
    startLabel: 'Start: Shoulder-Level Setup',
    endLabel: 'End: Overhead / Elevated Position',
    accent: '#2b6cb0',
  },
  arms: {
    title: 'Elbow Flexion & Extension',
    startLabel: 'Start: Neutral Arm Setup',
    endLabel: 'End: Full Flexion / Lockout',
    accent: '#2f855a',
  },
  legs: {
    title: 'Squat, Hinge & Lower-Body Drive',
    startLabel: 'Start: Braced Stance',
    endLabel: 'End: Full Hip & Knee Extension',
    accent: '#215b3c',
  },
  core: {
    title: 'Trunk Stability & Flexion',
    startLabel: 'Start: Braced Neutral Spine',
    endLabel: 'End: Controlled Core Engagement',
    accent: '#38a169',
  },
}

export function isValidSourceId(value) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  )
}

export function isValidLocalAssetPath(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^\/?[A-Za-z0-9_./-]+$/.test(value)
  ) {
    return false
  }
  const trimmed = value.startsWith('/') ? value.slice(1) : value
  return trimmed
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function selectDiagramGroup(primaryMuscles, category) {
  const firstMuscle = primaryMuscles[0] ?? ''
  if (firstMuscle === 'chest') return 'chest'
  if (['lats', 'middle back', 'traps'].includes(firstMuscle)) return 'back'
  if (firstMuscle === 'shoulders') return 'shoulders'
  if (['biceps', 'triceps', 'forearms'].includes(firstMuscle)) return 'arms'
  if (firstMuscle === 'abdominals' || category === 'stretching') return 'core'
  return 'legs'
}

function normalizeStringList(items, fieldName) {
  if (!Array.isArray(items)) {
    throw new Error(`Expected array for ${fieldName}.`)
  }
  const result = []
  const seen = new Set()
  for (const raw of items) {
    if (typeof raw !== 'string') {
      throw new Error(`Expected string elements in ${fieldName}.`)
    }
    const normalized = raw.trim().toLowerCase()
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

export function normalizeUpstreamExercise(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Upstream exercise entry must be an object.')
  }

  const sourceId = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!isValidSourceId(sourceId)) {
    throw new Error(`Invalid upstream exercise sourceId "${String(raw.id)}".`)
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) {
    throw new Error(`Exercise "${sourceId}" has a blank name.`)
  }

  const category =
    typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : ''
  if (!category) {
    throw new Error(`Exercise "${sourceId}" has a blank category.`)
  }

  const primaryMuscles = normalizeStringList(
    raw.primaryMuscles,
    `${sourceId}.primaryMuscles`,
  )
  if (primaryMuscles.length === 0) {
    throw new Error(
      `Exercise "${sourceId}" must have at least one primary muscle.`,
    )
  }

  const primarySet = new Set(primaryMuscles)
  const secondaryMuscles = normalizeStringList(
    raw.secondaryMuscles ?? [],
    `${sourceId}.secondaryMuscles`,
  ).filter((muscle) => !primarySet.has(muscle))

  let equipment = null
  if (raw.equipment !== null && raw.equipment !== undefined) {
    if (typeof raw.equipment !== 'string') {
      throw new Error(`Exercise "${sourceId}" has invalid equipment type.`)
    }
    const cleaned = raw.equipment.trim().toLowerCase()
    equipment = BODYWEIGHT_EQUIPMENT_LABELS.has(cleaned) ? null : cleaned
  }

  if (!Array.isArray(raw.instructions)) {
    throw new Error(`Exercise "${sourceId}" instructions must be an array.`)
  }
  const instructions = raw.instructions
    .map((step) => (typeof step === 'string' ? step.trim() : ''))
    .filter((step) => step.length > 0)
  if (instructions.length === 0) {
    throw new Error(
      `Exercise "${sourceId}" must include at least one instruction step.`,
    )
  }

  // License gate (Architecture §5A): upstream third-party .jpg photos are not
  // bundled without verified per-photo rights; use self-created local SVG diagrams
  // or empty imagePaths (which falls back to public/exercises/placeholder.svg).
  const diagramGroup = selectDiagramGroup(primaryMuscles, category)
  const imagePaths =
    raw.mediaAuditStatus === 'text-only-fallback'
      ? []
      : [`exercises/${diagramGroup}/0.svg`, `exercises/${diagramGroup}/1.svg`]

  for (const imgPath of imagePaths) {
    if (!isValidLocalAssetPath(imgPath)) {
      throw new Error(`Invalid local image path "${imgPath}" on ${sourceId}.`)
    }
  }

  return {
    id: `fedb:${sourceId}`,
    sourceId,
    name,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    instructions,
    category,
    imagePaths,
  }
}

export function prepareExerciseCatalog(upstreamBundle) {
  if (
    typeof upstreamBundle !== 'object' ||
    upstreamBundle === null ||
    typeof upstreamBundle.pinnedCommitSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(upstreamBundle.pinnedCommitSha)
  ) {
    throw new Error(
      'Upstream bundle requires a 40-character hex pinnedCommitSha.',
    )
  }

  if (!Array.isArray(upstreamBundle.exercises)) {
    throw new Error('Upstream bundle requires an exercises array.')
  }

  const count = upstreamBundle.exercises.length
  if (count < MIN_CURATED_EXERCISES || count > MAX_CURATED_EXERCISES) {
    throw new Error(
      `Curated catalog must contain ${MIN_CURATED_EXERCISES}–${MAX_CURATED_EXERCISES} exercises; received ${count}.`,
    )
  }

  const seenIds = new Set()
  const normalized = upstreamBundle.exercises.map((raw) => {
    const entry = normalizeUpstreamExercise(raw)
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate catalog exercise ID "${entry.id}".`)
    }
    seenIds.add(entry.id)
    return entry
  })

  normalized.sort((left, right) => left.id.localeCompare(right.id))

  const canonicalInputJson = JSON.stringify(upstreamBundle)
  const canonicalOutputJson = JSON.stringify(normalized, null, 2) + '\n'
  const inputSha256 = crypto
    .createHash('sha256')
    .update(canonicalInputJson)
    .digest('hex')
  const outputSha256 = crypto
    .createHash('sha256')
    .update(canonicalOutputJson)
    .digest('hex')

  const shortCommit = upstreamBundle.pinnedCommitSha.slice(0, 12)
  const provenance = {
    sourceRepository:
      upstreamBundle.repository ??
      'https://github.com/yuhonas/free-exercise-db',
    pinnedCommitSha: upstreamBundle.pinnedCommitSha,
    catalogVersion: `fedb-${shortCommit}`,
    upstreamMetadataLicense: upstreamBundle.upstreamLicense ?? 'Unlicense',
    mediaLicensePolicy:
      'Upstream third-party photographs excluded under Architecture §5A license gate; replaced with self-created CC0/Unlicense SVG movement diagrams and local placeholder fallback.',
    fallbackImagePath: FALLBACK_IMAGE_PATH,
    exerciseCount: normalized.length,
    inputSha256,
    outputSha256,
  }

  return {
    exercises: normalized,
    provenance,
    canonicalOutputJson,
  }
}

export function createPositionSvg({ title, phaseLabel, phaseIndex, accent }) {
  const barY = phaseIndex === 0 ? 156 : 96
  const limbY = phaseIndex === 0 ? 168 : 112
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="${title} — ${phaseLabel}">
  <rect width="320" height="240" rx="16" fill="#151c18" />
  <rect x="16" y="16" width="288" height="208" rx="12" fill="#1c2620" stroke="#3e5043" stroke-width="2" />
  <text x="32" y="46" fill="#edf2ed" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${title}</text>
  <text x="32" y="68" fill="#a0d9ac" font-family="system-ui, sans-serif" font-size="12">${phaseLabel}</text>
  <line x1="64" y1="192" x2="256" y2="192" stroke="#3e5043" stroke-width="4" stroke-linecap="round" />
  <circle cx="160" cy="${limbY - 22}" r="14" fill="#edf2ed" />
  <line x1="160" y1="${limbY - 8}" x2="160" y2="188" stroke="#edf2ed" stroke-width="8" stroke-linecap="round" />
  <line x1="96" y1="${barY}" x2="224" y2="${barY}" stroke="${accent}" stroke-width="8" stroke-linecap="round" />
  <rect x="84" y="${barY - 16}" width="14" height="32" rx="4" fill="#a0d9ac" />
  <rect x="222" y="${barY - 16}" width="14" height="32" rx="4" fill="#a0d9ac" />
</svg>
`
}

export function createPlaceholderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="Exercise illustration placeholder">
  <rect width="320" height="240" rx="16" fill="#151c18" />
  <rect x="16" y="16" width="288" height="208" rx="12" fill="#1c2620" stroke="#3e5043" stroke-width="2" />
  <text x="160" y="116" text-anchor="middle" fill="#edf2ed" font-family="system-ui, sans-serif" font-size="15" font-weight="600">Text-guided exercise</text>
  <text x="160" y="140" text-anchor="middle" fill="#b3c0b5" font-family="system-ui, sans-serif" font-size="12">Follow the step-by-step form instructions below</text>
</svg>
`
}

export function createLicenseMarkdown(provenance) {
  return `# Exercise Catalog & Media Provenance

## Upstream Metadata Source
- **Dataset:** \`yuhonas/free-exercise-db\` (${provenance.sourceRepository})
- **Pinned Commit SHA:** \`${provenance.pinnedCommitSha}\`
- **Catalog Version ID:** \`${provenance.catalogVersion}\`
- **Curated Exercise Count:** ${provenance.exerciseCount}
- **Upstream Repository License:** ${provenance.upstreamMetadataLicense} (Public Domain dedication)
- **Normalized Output SHA-256:** \`${provenance.outputSha256}\`

## Image License Audit & Replacement Gate (Architecture §5A)
Although \`yuhonas/free-exercise-db\` declares **The Unlicense** at the repository level, its upstream \`.jpg\` photographs do not carry per-image photographer releases. Under Architecture §5A:

1. **No upstream third-party photographs are redistributed** in this application bundle.
2. **Self-created SVG diagrams (\`public/exercises/<group>/0.svg\` and \`1.svg\`):** All bundled start/end movement diagrams and \`public/exercises/placeholder.svg\` are generated deterministically by \`scripts/prepare-exercises.mjs\` as original geometric vector illustrations dedicated to the public domain (**CC0 1.0 / The Unlicense**).
3. **Offline guarantee:** Every catalog entry resolves either to local self-created SVG diagrams in \`public/exercises/\` or to the local fallback \`${provenance.fallbackImagePath}\`. No runtime network requests or external CDNs are used.
`
}

export function runPrepareExercises({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
} = {}) {
  const rawPath = path.join(rootDir, 'src/data/seed/upstream-curated-raw.json')
  const outExercisesPath = path.join(rootDir, 'src/data/seed/exercises.json')
  const outProvenancePath = path.join(rootDir, 'src/data/seed/provenance.json')
  const publicExercisesDir = path.join(rootDir, 'public/exercises')

  const upstreamBundle = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  const { exercises, provenance, canonicalOutputJson } =
    prepareExerciseCatalog(upstreamBundle)

  fs.mkdirSync(path.dirname(outExercisesPath), { recursive: true })
  fs.writeFileSync(outExercisesPath, canonicalOutputJson)
  fs.writeFileSync(
    outProvenancePath,
    JSON.stringify(provenance, null, 2) + '\n',
  )

  fs.mkdirSync(publicExercisesDir, { recursive: true })
  fs.writeFileSync(
    path.join(publicExercisesDir, 'placeholder.svg'),
    createPlaceholderSvg(),
  )
  fs.writeFileSync(
    path.join(publicExercisesDir, 'LICENSE.md'),
    createLicenseMarkdown(provenance),
  )

  for (const [groupKey, groupMeta] of Object.entries(DIAGRAM_GROUPS)) {
    const groupDir = path.join(publicExercisesDir, groupKey)
    fs.mkdirSync(groupDir, { recursive: true })
    fs.writeFileSync(
      path.join(groupDir, '0.svg'),
      createPositionSvg({
        title: groupMeta.title,
        phaseLabel: groupMeta.startLabel,
        phaseIndex: 0,
        accent: groupMeta.accent,
      }),
    )
    fs.writeFileSync(
      path.join(groupDir, '1.svg'),
      createPositionSvg({
        title: groupMeta.title,
        phaseLabel: groupMeta.endLabel,
        phaseIndex: 1,
        accent: groupMeta.accent,
      }),
    )
  }

  return { exercises, provenance }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectExecution) {
  const { provenance } = runPrepareExercises()
  console.log(
    `Prepared ${provenance.exerciseCount} exercises (${provenance.catalogVersion}) from commit ${provenance.pinnedCommitSha}.`,
  )
}
