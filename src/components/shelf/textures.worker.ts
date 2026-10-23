import { bakeSleeveImage, prepareImages, type SleevePaintInfo } from './texture-paint'

type Request = { id: number } & (
  | { type: 'prepare' }
  | { type: 'sleeve'; image: Blob | null; info: SleevePaintInfo; size: number }
)

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.type === 'prepare') {
      const result = await prepareImages()
      self.postMessage({ id: data.id, result }, { transfer: [
        result.paperBump, result.paperRoughness, result.base, result.roughness, result.normal,
        result.anisotropy.data.buffer,
      ] })
    } else {
      const result = await bakeSleeveImage(data.image, data.info, data.size)
      self.postMessage({ id: data.id, result }, { transfer: [result] })
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Texture preparation failed' })
  }
}
