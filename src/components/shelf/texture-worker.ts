import { bakeSleeveImage, prepareImages as prepareImagesOnMain, type PreparedImages, type SleevePaintInfo } from './texture-paint'

type Job = { resolve: (value: unknown) => void; reject: (error: Error) => void }
let worker: Worker | null = null
let unavailable = false
let nextId = 0
const pending = new Map<number, Job>()

function getWorker(): Worker | null {
  if (unavailable || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./textures.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id)
      if (!job) return
      pending.delete(data.id)
      if (data.error) job.reject(new Error(data.error))
      else job.resolve(data.result)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      unavailable = true
      for (const job of pending.values()) job.reject(new Error('Texture worker failed'))
      pending.clear()
    }
    return worker
  } catch {
    unavailable = true
    return null
  }
}

function request<T>(type: 'prepare' | 'sleeve', payload: object, fallback: () => Promise<T>): Promise<T> {
  const target = getWorker()
  if (!target) return fallback()
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve: (value) => resolve(value as T), reject })
    try {
      // Blobs can be shared with the worker without decoding or copying pixels on this thread.
      target.postMessage({ id, type, ...payload })
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  }).catch(fallback)
}

export function prepareImages(): Promise<PreparedImages> {
  return request('prepare', {}, prepareImagesOnMain)
}

export function paintSleeveImage(image: Blob | null, info: SleevePaintInfo, size = 1024): Promise<ImageBitmap> {
  return request('sleeve', { image, info, size }, () => bakeSleeveImage(image, info, size))
}
