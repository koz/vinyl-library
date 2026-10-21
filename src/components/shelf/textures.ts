import * as THREE from 'three'
import { RECORD_RADIUS } from './layout'
import oakReferenceUrl from '../../assets/oak-fibers.jpg'

const LABEL_RATIO = 1 / 3

const COVER_SIZE = 1024
const DISC_SIZE = 1024
const ANISOTROPY_SIZE = 512

// Track gaps as fractions of the record radius. Grooves run from 0.40 to 0.965.
const GROOVES_START = 0.4
const GROOVES_END = 0.965
const TRACK_GAPS = [0.52, 0.63, 0.745, 0.86]
const GAP_WIDTH = 0.014
const ZONE_RAMP = 0.012

export function coverProxyUrl(url: string): string {
  return `/api/cover?url=${encodeURIComponent(url)}`
}

export async function loadCoverImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(coverProxyUrl(url), { signal })
  if (!response.ok) throw new Error(`Cover request failed (${response.status})`)
  return createImageBitmap(await response.blob())
}

// Seeded so each sleeve wears the same way every time it's drawn.
function seededRandom(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function canvas(width: number, height = width) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas is not available')
  return { element, context }
}

let grainCanvas: HTMLCanvasElement | null = null

function paperGrain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas
  const { element, context } = canvas(128)
  const image = context.createImageData(128, 128)
  const random = seededRandom(1948)
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (random() - 0.5) * 110
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value
    image.data[i + 3] = 255
  }
  context.putImageData(image, 0, 0)
  grainCanvas = element
  return element
}

type SleevePaperMaps = {
  bump: THREE.CanvasTexture
  roughness: THREE.CanvasTexture
}

let sleevePaperMaps: SleevePaperMaps | null = null

/** Shared uncoated paper relief: soft pulp variation, fine grain and short, irregular fibers. */
export function getSleevePaperMaps(): SleevePaperMaps {
  if (sleevePaperMaps) return sleevePaperMaps
  const random = seededRandom(1976)
  const surface = canvas(COVER_SIZE)
  const pulp = canvas(64)
  const pulpImage = pulp.context.createImageData(64, 64)
  for (let i = 0; i < pulpImage.data.length; i += 4) {
    const value = 112 + random() * 32
    pulpImage.data[i] = pulpImage.data[i + 1] = pulpImage.data[i + 2] = value
    pulpImage.data[i + 3] = 255
  }
  pulp.context.putImageData(pulpImage, 0, 0)
  surface.context.drawImage(pulp.element, 0, 0, COVER_SIZE, COVER_SIZE)
  surface.context.globalCompositeOperation = 'soft-light'
  surface.context.globalAlpha = 0.55
  surface.context.fillStyle = surface.context.createPattern(paperGrain(), 'repeat') ?? '#888'
  surface.context.fillRect(0, 0, COVER_SIZE, COVER_SIZE)
  surface.context.globalCompositeOperation = 'source-over'
  surface.context.globalAlpha = 1
  surface.context.lineCap = 'round'
  for (let i = 0; i < 9000; i++) {
    const x = random() * COVER_SIZE
    const y = random() * COVER_SIZE
    const angle = random() * Math.PI * 2
    const length = 2 + random() * 9
    surface.context.strokeStyle = random() < 0.5 ? 'rgba(65,65,65,0.13)' : 'rgba(205,205,205,0.16)'
    surface.context.lineWidth = 0.5 + random() * 0.7
    surface.context.beginPath()
    surface.context.moveTo(x, y)
    surface.context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    surface.context.stroke()
  }

  const roughness = canvas(COVER_SIZE)
  const roughImage = surface.context.getImageData(0, 0, COVER_SIZE, COVER_SIZE)
  for (let i = 0; i < roughImage.data.length; i += 4) {
    const value = 225 + (roughImage.data[i]! - 128) * 0.35
    roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] = value
  }
  roughness.context.putImageData(roughImage, 0, 0)
  // These are surface data, so keep the textures in their default linear color space.
  sleevePaperMaps = {
    bump: new THREE.CanvasTexture(surface.element),
    roughness: new THREE.CanvasTexture(roughness.element),
  }
  return sleevePaperMaps
}

// Printed paper, gently compressed folds and small patches of exposed cardboard.
function ageSleeve(context: CanvasRenderingContext2D, seed: number) {
  const size = context.canvas.width
  const random = seededRandom(seed)
  context.save()

  const { bump } = getSleevePaperMaps()
  context.globalCompositeOperation = 'soft-light'
  context.globalAlpha = 0.28
  context.drawImage(bump.image, 0, 0, size, size)

  // A little ink absorption also affects near-white artwork, where overlay grain disappears.
  context.globalCompositeOperation = 'multiply'
  context.globalAlpha = 0.07
  context.drawImage(bump.image, 0, 0, size, size)
  context.globalAlpha = 0.1
  context.fillStyle = '#e8e1d3'
  context.fillRect(0, 0, size, size)

  context.globalAlpha = 1
  const edge = size * 0.028
  const edgeAlpha = 0.075 + random() * 0.025
  const edges: [number, number, number, number][] = [
    [0, 0, 0, edge],
    [0, size, 0, size - edge],
    [0, 0, edge, 0],
    [size, 0, size - edge, 0],
  ]
  for (const [x0, y0, x1, y1] of edges) {
    const gradient = context.createLinearGradient(x0, y0, x1, y1)
    gradient.addColorStop(0, `rgba(94,81,62,${edgeAlpha})`)
    gradient.addColorStop(0.25, 'rgba(94,81,62,0.035)')
    gradient.addColorStop(0.65, 'rgba(94,81,62,0.008)')
    gradient.addColorStop(1, 'rgba(94,81,62,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }

  // Let the curved geometry define the rim; a drawn contour makes the fold look sharp.
  context.globalCompositeOperation = 'source-over'
  context.strokeStyle = 'rgba(235,226,207,0.3)'
  for (let i = 0; i < 55; i++) {
    context.save()
    context.translate(size / 2, size / 2)
    context.rotate(Math.floor(random() * 4) * Math.PI / 2)
    const x = (random() - 0.5) * size
    const y = -size / 2 + random() * 2
    context.lineWidth = 0.5 + random() * 1.3
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + 2 + random() * 12, y + random() * 1.5)
    context.stroke()
    context.restore()
  }
  context.restore()
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

function drawPlainSleeve(context: CanvasRenderingContext2D, artist: string, title: string) {
  const size = context.canvas.width
  const gradient = context.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#d3c3a5')
  gradient.addColorStop(1, '#bfac8a')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  context.fillStyle = '#3b352d'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
  context.font = `600 ${size * 0.075}px ${font}`
  const artistLines = wrapText(context, artist, size * 0.78)
  context.font = `400 ${size * 0.06}px ${font}`
  const titleLines = wrapText(context, title, size * 0.78)
  const lineHeight = size * 0.09
  let y = size / 2 - ((artistLines.length + titleLines.length - 1) * lineHeight) / 2
  context.font = `600 ${size * 0.075}px ${font}`
  for (const line of artistLines) {
    context.fillText(line, size / 2, y)
    y += lineHeight
  }
  context.font = `400 ${size * 0.06}px ${font}`
  for (const line of titleLines) {
    context.fillText(line, size / 2, y)
    y += lineHeight
  }
}

export function createSleeveTexture(
  image: ImageBitmap | null,
  info: { id: number; artist: string; title: string },
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const { element, context } = canvas(COVER_SIZE)
  if (image) {
    const scale = Math.max(COVER_SIZE / image.width, COVER_SIZE / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, (COVER_SIZE - width) / 2, (COVER_SIZE - height) / 2, width, height)
  } else {
    drawPlainSleeve(context, info.artist, info.title)
  }
  ageSleeve(context, info.id)

  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return texture
}

type Zone = { roughness: number; anisotropy: number }

// Real grooves are far finer than a pixel, and drawing them that fine makes the record shimmer as it
// moves. Soft bands a few pixels wide give the same sheen variation without aliasing.
const GROOVE_BANDS = 80

function bandNoise(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function grooveAt(f: number, bands = GROOVE_BANDS): number {
  const position = f * bands
  const index = Math.floor(position)
  const t = position - index
  const smooth = t * t * (3 - 2 * t)
  return bandNoise(index) + (bandNoise(index + 1) - bandNoise(index)) * smooth
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const mix = (a: Zone, b: Zone, t: number): Zone => ({
  roughness: a.roughness + (b.roughness - a.roughness) * t,
  anisotropy: a.anisotropy + (b.anisotropy - a.anisotropy) * t,
})

const LABEL: Zone = { roughness: 0.75, anisotropy: 0 }
const DEAD_WAX: Zone = { roughness: 0.29, anisotropy: 0.15 }
const LEAD_OUT: Zone = { roughness: 0.25, anisotropy: 0.2 }
const GAP: Zone = { roughness: 0.29, anisotropy: 0.4 }

// Surface of the record at `f`, the distance from the centre as a fraction of its radius.
// The groove sheen is kept fairly broad and every change is a soft ramp a few pixels wide:
// a razor-sharp highlight or one-pixel edges make the record shimmer as it slides.
function zoneAt(f: number): Zone {
  const grooves: Zone = { roughness: 0.34 + grooveAt(f) * 0.035, anisotropy: 0.9 }
  const gap = Math.max(...TRACK_GAPS.map((center) => 1 - smoothstep(0, GAP_WIDTH, Math.abs(f - center))))
  let zone = mix(grooves, GAP, gap)
  zone = mix(DEAD_WAX, zone, smoothstep(GROOVES_START - ZONE_RAMP, GROOVES_START, f))
  zone = mix(zone, LEAD_OUT, smoothstep(GROOVES_END, GROOVES_END + ZONE_RAMP, f))
  return mix(LABEL, zone, smoothstep(LABEL_RATIO - ZONE_RAMP / 2, LABEL_RATIO, f))
}

type VinylMaps = {
  base: HTMLCanvasElement
  roughness: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  anisotropy: THREE.DataTexture
}

let vinylMaps: VinylMaps | null = null

export function getVinylMaps(): VinylMaps {
  if (vinylMaps) return vinylMaps
  const random = seededRandom(33)
  const half = DISC_SIZE / 2

  // Pressed vinyl is almost black; its groove detail comes mostly from the reflection, not gray rings.
  const base = canvas(DISC_SIZE)
  const roughness = canvas(DISC_SIZE)
  const normal = canvas(DISC_SIZE)
  const baseImage = base.context.createImageData(DISC_SIZE, DISC_SIZE)
  const roughImage = roughness.context.createImageData(DISC_SIZE, DISC_SIZE)
  const normalImage = normal.context.createImageData(DISC_SIZE, DISC_SIZE)
  for (let y = 0; y < DISC_SIZE; y++) {
    for (let x = 0; x < DISC_SIZE; x++) {
      const dx = x + 0.5 - half
      const dy = y + 0.5 - half
      const radius = Math.hypot(dx, dy) || 1
      const f = radius / half
      const angle = Math.atan2(dy, dx)
      const zone = zoneAt(f)
      const recorded = smoothstep(GROOVES_START, GROOVES_START + ZONE_RAMP, f)
        * (1 - smoothstep(GROOVES_END - ZONE_RAMP, GROOVES_END, f))
      const fine = grooveAt(f, 173)
      // Slow changes in the pressing break up the otherwise perfectly circular sheen.
      const pressing = Math.sin(angle * 3 + f * 17) * Math.sin(angle * 5 - f * 9)
      const grain = random() - 0.5
      const shade = 7.6 + recorded * (grooveAt(f) * 0.85 + fine * 0.4 + pressing * 0.35) + grain * 0.8
      const i = (y * DISC_SIZE + x) * 4
      baseImage.data[i] = baseImage.data[i + 1] = baseImage.data[i + 2] = shade
      baseImage.data[i + 3] = 255
      roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] =
        (zone.roughness + recorded * (pressing * 0.023 + (fine - 0.5) * 0.025)) * 255
      roughImage.data[i + 3] = 255

      // Small radial slopes catch the light like grooves. Mipmapped normals let the fine
      // detail fade naturally at a distance rather than turning into moving white lines.
      const slope = recorded * (
        grooveAt(f + 1 / half) - grooveAt(f - 1 / half)
        + (grooveAt(f + 1 / half, 173) - grooveAt(f - 1 / half, 173)) * 0.45
      ) * 0.24
      const length = Math.hypot(slope, 1)
      normalImage.data[i] = 127.5 - dx / radius * slope / length * 127.5
      normalImage.data[i + 1] = 127.5 + dy / radius * slope / length * 127.5
      normalImage.data[i + 2] = 127.5 + 127.5 / length
      normalImage.data[i + 3] = 255
    }
  }
  base.context.putImageData(baseImage, 0, 0)
  roughness.context.putImageData(roughImage, 0, 0)
  normal.context.putImageData(normalImage, 0, 0)

  base.context.fillStyle = 'rgba(185,180,168,0.2)'
  for (let i = 0; i < 95; i++) {
    const angle = random() * Math.PI * 2
    const f = LABEL_RATIO + 0.02 + random() * (1 - LABEL_RATIO - 0.03)
    const r = 0.4 + random() * 0.8
    base.context.beginPath()
    base.context.arc(half + Math.cos(angle) * f * half, half + Math.sin(angle) * f * half, r, 0, Math.PI * 2)
    base.context.fill()
  }
  // Faint cleaning marks follow short arcs instead of looking like drawn full-circle track rings.
  for (let i = 0; i < 55; i++) {
    const angle = random() * Math.PI * 2
    const f = 0.43 + random() * 0.51
    base.context.strokeStyle = `rgba(155,155,150,${0.018 + random() * 0.025})`
    base.context.lineWidth = 0.6 + random() * 0.7
    base.context.beginPath()
    base.context.arc(
      half,
      half,
      f * half,
      angle,
      angle + 0.08 + random() * 0.55,
    )
    base.context.stroke()
  }

  // Broad, almost invisible handling marks disturb the reflected light without painting
  // fingerprints onto the artwork. Keep the paper label and outer rim untouched.
  roughness.context.save()
  roughness.context.beginPath()
  roughness.context.arc(half, half, half * 0.96, 0, Math.PI * 2)
  roughness.context.arc(half, half, half * GROOVES_START, 0, Math.PI * 2, true)
  roughness.context.clip()
  for (let i = 0; i < 7; i++) {
    const angle = random() * Math.PI * 2
    const radius = half * (0.52 + random() * 0.4)
    roughness.context.save()
    roughness.context.translate(half + Math.cos(angle) * radius, half + Math.sin(angle) * radius)
    roughness.context.rotate(angle + random())
    roughness.context.scale(1, 0.35 + random() * 0.3)
    const width = 35 + random() * 50
    const smudge = roughness.context.createRadialGradient(0, 0, 0, 0, 0, width)
    smudge.addColorStop(0, 'rgba(180,180,180,0.17)')
    smudge.addColorStop(0.5, 'rgba(180,180,180,0.07)')
    smudge.addColorStop(1, 'rgba(180,180,180,0)')
    roughness.context.fillStyle = smudge
    roughness.context.fillRect(-width, -width, width * 2, width * 2)
    roughness.context.restore()
  }
  roughness.context.restore()

  // Grooves are concentric, so the highlight stretches along circles: the tangent of each point.
  const data = new Uint8Array(ANISOTROPY_SIZE * ANISOTROPY_SIZE * 4)
  const aHalf = ANISOTROPY_SIZE / 2
  for (let y = 0; y < ANISOTROPY_SIZE; y++) {
    for (let x = 0; x < ANISOTROPY_SIZE; x++) {
      const dx = x + 0.5 - aHalf
      const dy = y + 0.5 - aHalf
      const length = Math.hypot(dx, dy) || 1
      const i = (y * ANISOTROPY_SIZE + x) * 4
      data[i] = (-dy / length) * 127.5 + 127.5
      data[i + 1] = (dx / length) * 127.5 + 127.5
      data[i + 2] = zoneAt(length / aHalf).anisotropy * 255
      data[i + 3] = 255
    }
  }
  const anisotropy = new THREE.DataTexture(data, ANISOTROPY_SIZE, ANISOTROPY_SIZE)
  anisotropy.magFilter = THREE.LinearFilter
  anisotropy.minFilter = THREE.LinearFilter
  anisotropy.needsUpdate = true

  vinylMaps = {
    base: base.element,
    roughness: new THREE.CanvasTexture(roughness.element),
    normal: new THREE.CanvasTexture(normal.element),
    anisotropy,
  }
  return vinylMaps
}

// The record's colour map: the shared vinyl surface with this release's cover as the centre label.
export function createDiscTexture(cover: CanvasImageSource | null, maxAnisotropy: number): THREE.CanvasTexture {
  const { base } = getVinylMaps()
  const { element, context } = canvas(DISC_SIZE)
  const half = DISC_SIZE / 2
  const labelRadius = half * LABEL_RATIO
  context.drawImage(base, 0, 0)

  context.save()
  context.beginPath()
  context.arc(half, half, labelRadius, 0, Math.PI * 2)
  context.clip()
  context.fillStyle = '#d8cfbf'
  context.fillRect(0, 0, DISC_SIZE, DISC_SIZE)
  if (cover) {
    context.drawImage(cover, half - labelRadius, half - labelRadius, labelRadius * 2, labelRadius * 2)
  }
  const shade = context.createRadialGradient(half, half, labelRadius * 0.85, half, half, labelRadius)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.35)')
  context.fillStyle = shade
  context.fillRect(0, 0, DISC_SIZE, DISC_SIZE)
  context.restore()

  const holeRadius = half * (0.0115 / RECORD_RADIUS)
  const hole = context.createRadialGradient(half, half, 0, half, half, holeRadius * 1.6)
  hole.addColorStop(0, '#050505')
  hole.addColorStop(0.62, '#0c0c0c')
  hole.addColorStop(0.64, 'rgba(0,0,0,0.4)')
  hole.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = hole
  context.beginPath()
  context.arc(half, half, holeRadius * 1.6, 0, Math.PI * 2)
  context.fill()

  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return texture
}

export type OakMaps = {
  color: THREE.CanvasTexture
  bump: THREE.CanvasTexture
  roughness: THREE.CanvasTexture
  endGrain: THREE.CanvasTexture
}

let oakMaps: Promise<OakMaps> | null = null

export function loadOakMaps(maxAnisotropy: number): Promise<OakMaps> {
  return oakMaps ??= createOakMaps(maxAnisotropy).catch((error) => {
    oakMaps = null
    throw error
  })
}

/** Fine, straight oak fibers from the supplied reference, with relief isolated from its lighting. */
async function createOakMaps(maxAnisotropy: number): Promise<OakMaps> {
  const image = new Image()
  image.src = oakReferenceUrl
  await image.decode()
  const size = 1024
  const color = canvas(size)
  color.context.translate(size / 2, size / 2)
  color.context.rotate(-Math.PI / 2)
  color.context.drawImage(image, -size / 2, -size / 2, size, size)
  color.context.resetTransform()

  const soft = canvas(size)
  soft.context.filter = 'blur(6px)'
  soft.context.drawImage(color.element, 0, 0)
  const pixels = color.context.getImageData(0, 0, size, size)
  const low = soft.context.getImageData(0, 0, size, size)
  const bump = canvas(size)
  const roughness = canvas(size)
  const bumpImage = bump.context.createImageData(size, size)
  const roughImage = roughness.context.createImageData(size, size)
  const average = [0, 0, 0]
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luminance = (pixels.data[i]! + pixels.data[i + 1]! * 2 + pixels.data[i + 2]!) / 4
    const local = (low.data[i]! + low.data[i + 1]! * 2 + low.data[i + 2]!) / 4
    const fiber = luminance - local
    bumpImage.data[i] = bumpImage.data[i + 1] = bumpImage.data[i + 2] = 128 + fiber * 0.75
    bumpImage.data[i + 3] = 255
    roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] = 218 - fiber * 0.25
    roughImage.data[i + 3] = 255
    for (let channel = 0; channel < 3; channel++) average[channel]! += pixels.data[i + channel]!
  }
  bump.context.putImageData(bumpImage, 0, 0)
  roughness.context.putImageData(roughImage, 0, 0)
  for (let channel = 0; channel < 3; channel++) average[channel]! /= size * size

  const end = canvas(512, 128)
  const endImage = end.context.createImageData(512, 128)
  const random = seededRandom(71)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 512; x++) {
      const radius = Math.hypot((x - 140) * 0.38, (y + 55) * 1.5)
      const shade = Math.sin(radius * 0.2 + Math.sin(y * 0.05) * 0.8) * 5 + (random() - 0.5) * 5
      const i = (y * 512 + x) * 4
      for (let channel = 0; channel < 3; channel++) endImage.data[i + channel] = average[channel]! * 0.94 + shade
      endImage.data[i + 3] = 255
    }
  }
  end.context.putImageData(endImage, 0, 0)

  const maps = {
    color: new THREE.CanvasTexture(color.element),
    bump: new THREE.CanvasTexture(bump.element),
    roughness: new THREE.CanvasTexture(roughness.element),
    endGrain: new THREE.CanvasTexture(end.element),
  }
  maps.color.colorSpace = maps.endGrain.colorSpace = THREE.SRGBColorSpace
  for (const map of Object.values(maps)) {
    map.anisotropy = maxAnisotropy
    map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping
  }
  return maps
}
