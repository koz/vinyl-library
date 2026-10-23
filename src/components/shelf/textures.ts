import * as THREE from 'three'
import oakReferenceUrl from '../../assets/oak-fibers.jpg'
import { paintDisc } from './texture-paint'
import { prepareImages, paintSleeveImage } from './texture-worker'

export function coverProxyUrl(url: string): string {
  return `/api/cover?url=${encodeURIComponent(url)}`
}

export async function loadCoverBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(coverProxyUrl(url), { signal })
  if (!response.ok) throw new Error(`Cover request failed (${response.status})`)
  return response.blob()
}

function texture(image: ImageBitmap, color = false, maxAnisotropy = 1) {
  const result = new THREE.CanvasTexture(image)
  // ImageBitmap uploads ignore UNPACK_FLIP_Y. Apply the same orientation in UVs.
  result.flipY = false
  result.repeat.y = -1
  result.offset.y = 1
  if (color) result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = maxAnisotropy
  result.addEventListener('dispose', () => image.close())
  return result
}

type SurfaceMaps = Awaited<ReturnType<typeof prepareMaps>>
let surfaceMaps: SurfaceMaps | null = null
let preparing: Promise<void> | null = null

async function prepareMaps() {
  const images = await prepareImages()
  const anisotropy = new THREE.DataTexture(images.anisotropy.data, images.anisotropy.size, images.anisotropy.size)
  anisotropy.magFilter = THREE.LinearFilter
  anisotropy.minFilter = THREE.LinearFilter
  anisotropy.needsUpdate = true
  return {
    paper: { bump: texture(images.paperBump), roughness: texture(images.paperRoughness) },
    vinyl: {
      base: images.base,
      roughness: texture(images.roughness), normal: texture(images.normal), anisotropy,
    },
  }
}

/** Bake shared surfaces off the main thread before making the shelf interactive. */
export function prepareTextureMaps(): Promise<void> {
  return preparing ??= prepareMaps().then((maps) => { surfaceMaps = maps }).catch((error) => {
    preparing = null
    throw error
  })
}

export function getSleevePaperMaps() {
  if (!surfaceMaps) throw new Error('Shelf textures have not been prepared')
  return surfaceMaps.paper
}

export function getVinylMaps() {
  if (!surfaceMaps) throw new Error('Shelf textures have not been prepared')
  return surfaceMaps.vinyl
}

export async function createSleeveTexture(
  image: Blob | null,
  info: { id: number; artist: string; title: string },
  maxAnisotropy: number,
  size = 1024,
): Promise<THREE.CanvasTexture<ImageBitmap>> {
  return texture(await paintSleeveImage(image, info, size), true, maxAnisotropy)
}

export function createDiscTexture(cover: CanvasImageSource | null, maxAnisotropy: number) {
  const result = new THREE.CanvasTexture(paintDisc(cover, getVinylMaps().base))
  result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = maxAnisotropy
  return result
}

/** Keep the uploaded texture and its shader bindings while changing the centre label. */
export function updateDiscTexture(result: ReturnType<typeof createDiscTexture>, cover: CanvasImageSource | null) {
  result.image = paintDisc(cover, getVinylMaps().base)
  result.needsUpdate = true
}

// Oak is prepared once during loading, before any scroll or selection animation.
function canvas(width: number, height = width) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas is not available')
  return { element, context }
}

function seededRandom(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
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

/** Natural oak grain and knots from the supplied reference, with relief isolated from its lighting. */
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
