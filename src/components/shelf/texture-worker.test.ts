import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paint = vi.hoisted(() => ({ prepareImages: vi.fn(), bakeSleeveImage: vi.fn() }))
vi.mock('./texture-paint', () => paint)

class TextureWorker {
  static instances: TextureWorker[] = []
  onmessage: ((event: { data: object }) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { TextureWorker.instances.push(this) }
  reply(index: number, result: unknown) {
    const request = this.postMessage.mock.calls[index]![0] as { id: number }
    this.onmessage?.({ data: { id: request.id, result } })
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  TextureWorker.instances = []
  vi.stubGlobal('Worker', TextureWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterEach(() => vi.unstubAllGlobals())

describe('texture preparation outside the interaction thread', () => {
  it('routes shared surfaces and concurrent covers through one worker, matching out-of-order replies', async () => {
    const { prepareImages, paintSleeveImage } = await import('./texture-worker')
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const cover = new Blob(['encoded cover'])
    const shared = prepareImages()
    const first = paintSleeveImage(cover, { id: 1, artist: 'First', title: 'One' })
    const second = paintSleeveImage(null, { id: 2, artist: 'Second', title: 'Two' })
    expect(TextureWorker.instances).toHaveLength(1)
    const worker = TextureWorker.instances[0]!
    expect(worker.postMessage.mock.calls.map(([request]) => request.type)).toEqual(['prepare', 'sleeve', 'sleeve'])
    expect(decode).not.toHaveBeenCalled()
    expect(worker.postMessage.mock.calls[1]![0].image).toBe(cover)
    expect(paint.prepareImages).not.toHaveBeenCalled()
    expect(paint.bakeSleeveImage).not.toHaveBeenCalled()
    const maps = {}, firstImage = {}, secondImage = {}
    worker.reply(2, secondImage)
    worker.reply(0, maps)
    worker.reply(1, firstImage)
    await expect(shared).resolves.toBe(maps)
    await expect(first).resolves.toBe(firstImage)
    await expect(second).resolves.toBe(secondImage)
  })

  it('settles every pending request and falls back if the worker cannot run', async () => {
    const maps = {}
    paint.prepareImages.mockResolvedValue(maps)
    const { prepareImages } = await import('./texture-worker')
    const first = prepareImages(), second = prepareImages()
    const worker = TextureWorker.instances[0]!
    worker.onerror?.()
    await expect(first).resolves.toBe(maps)
    await expect(second).resolves.toBe(maps)
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(prepareImages()).resolves.toBe(maps)
    expect(TextureWorker.instances).toHaveLength(1)
  })
})
