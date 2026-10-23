import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'

vi.mock('three/webgpu', async (original) => ({
  ...await original<typeof import('three/webgpu')>(),
  PMREMGenerator: class {
    fromScene() { return { texture: new THREE.Texture() } }
    dispose() {}
  },
}))

afterEach(() => vi.unstubAllGlobals())

function viewport() {
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let notifyResize!: () => void
  let painted = false
  const canvas = { clientWidth: 402, clientHeight: 714 }
  const renderer = {
    backend: {}, shadowMap: {}, setPixelRatio: vi.fn(), dispose: vi.fn(),
    // Changing the drawing-buffer size clears the WebGL canvas immediately.
    setSize: vi.fn(() => { painted = false }),
    render: vi.fn(() => { painted = true }),
  }
  vi.stubGlobal('window', {
    devicePixelRatio: 3, matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {},
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#e0e0e0' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback }
    observe() {}
    disconnect() {}
  })
  const Scene = ShelfScene as unknown as new (...args: unknown[]) => ShelfScene
  const scene = new Scene(canvas, renderer, {}, null)
  function frame(time = 16) {
    const next = frames.entries().next().value!
    frames.delete(next[0])
    next[1](time)
  }
  frame()
  renderer.setSize.mockClear()
  renderer.render.mockClear()
  return { scene, canvas, renderer, frame, notifyResize, painted: () => painted }
}

describe('Safari toolbar viewport resizing', () => {
  it('keeps the previous shelf frame painted between a resize notification and the next animation frame', () => {
    const view = viewport()
    expect(view.painted()).toBe(true)
    view.canvas.clientHeight = 760
    view.notifyResize()
    // ResizeObserver runs after rAF, before paint. Clearing here exposes a blank canvas.
    expect(view.painted()).toBe(true)
    view.frame()
    expect(view.renderer.setSize).toHaveBeenCalledWith(402, 760, false)
    expect(view.painted()).toBe(true)
    view.scene.dispose()
  })

  it('coalesces toolbar resize notifications and redraws the final buffer in the same frame', () => {
    const view = viewport()
    view.canvas.clientHeight = 730
    view.notifyResize()
    view.canvas.clientHeight = 760
    view.notifyResize()
    view.frame()
    expect(view.renderer.setSize).toHaveBeenCalledTimes(1)
    expect(view.renderer.setSize).toHaveBeenCalledWith(402, 760, false)
    expect(view.renderer.render).toHaveBeenCalledOnce()
    expect(view.painted()).toBe(true)
    view.scene.dispose()
  })

  it('does not clear the drawing buffer for an unchanged viewport', () => {
    const view = viewport()
    view.notifyResize()
    view.frame()
    expect(view.renderer.setSize).not.toHaveBeenCalled()
    expect(view.painted()).toBe(true)
    view.scene.dispose()
  })
})
