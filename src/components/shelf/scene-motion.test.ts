import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'

type Pose = { x: number; y: number; z: number; size: number; rx: number; ry: number }

function preview(reducedMotion = false) {
  const element = {} as HTMLElement
  const sleeve = { element, group: new THREE.Group(), front: new THREE.MeshStandardMaterial(),
    texture: new THREE.CanvasTexture(), nearby: true }
  const selection = { sleeve, disc: new THREE.Mesh(), material: new THREE.MeshPhysicalMaterial(),
    open: true, travel: 0, slide: 0, speed: 0, angle: 0, onClosed: null as (() => void) | null,
    artworkAbort: new AbortController(), artwork: null,
    stage: { getBoundingClientRect: () => ({ left: 200, bottom: 600, height: 400 }) } }
  const scene = Object.assign(Object.create(ShelfScene.prototype), {
    selection, reducedMotion: { matches: reducedMotion }, width: 1440, height: 900, distance: 1680,
    scrim: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()),
    tracked: new Map([[element, {}]]), placeholder: new THREE.DataTexture(), requestRender: vi.fn(),
  }) as { selection: typeof selection | null; close: (onClosed: () => void) => void;
    updateSelection: (value: typeof selection, pose: Pose, dt: number) => boolean }
  const pose = { x: 200, y: 40, z: 0, size: 220, rx: -.06, ry: 0 }
  const advance = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds && scene.selection; elapsed += 1 / 60)
      scene.updateSelection(selection, pose, 1 / 60)
  }
  return { scene, selection, advance, pose }
}

describe('record preview motion', () => {
  it('completes the sleeve travel and disc reveal within 700ms', () => {
    const { selection, advance } = preview()
    advance(.7)
    expect(selection.travel).toBe(1)
    expect(selection.slide).toBe(1)
    expect(selection.disc.visible).toBe(true)
  })

  it('returns an open record and unlocks the dialog within 600ms', () => {
    const { scene, selection, advance } = preview()
    advance(.7)
    const closed = vi.fn()
    scene.close(closed)
    advance(.6)
    expect(scene.selection).toBeNull()
    expect(selection.slide).toBe(0)
    expect(selection.travel).toBe(0)
    expect(closed).toHaveBeenCalledOnce()
  })

  it('can reverse an opening sleeve immediately without waiting for the reveal', () => {
    const { scene, selection, advance } = preview()
    advance(.15)
    expect(selection.travel).toBeGreaterThan(0)
    expect(selection.slide).toBe(0)
    const closed = vi.fn()
    scene.close(closed)
    expect(selection.artworkAbort.signal.aborted).toBe(true)
    advance(.2)
    expect(scene.selection).toBeNull()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('opens and closes in one frame with reduced motion enabled', () => {
    const { scene, selection, advance } = preview(true)
    advance(1 / 60)
    expect(selection.travel).toBe(1)
    expect(selection.slide).toBe(1)
    expect(selection.speed).toBe(0)
    const closed = vi.fn()
    scene.close(closed)
    advance(1 / 60)
    expect(scene.selection).toBeNull()
    expect(closed).toHaveBeenCalledOnce()
  })
})
