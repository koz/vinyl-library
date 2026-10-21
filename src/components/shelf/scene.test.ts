import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'
import { RECORD_RADIUS } from './layout'

type Selection = {
  sleeve: { group: THREE.Group }
  stage: { getBoundingClientRect: () => { left: number; bottom: number; height: number } }
  disc: THREE.Mesh
  open: boolean
  travel: number
  slide: number
  speed: number
  angle: number
}

function animation() {
  // Exercise the production animation with real three.js transforms, without a GPU or DOM.
  const scene = Object.assign(Object.create(ShelfScene.prototype), {
    reducedMotion: { matches: false },
    width: 1200,
    height: 800,
    distance: 1500,
    scrim: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()),
  }) as {
    updateSelection: (selection: Selection, pose: object, dt: number) => boolean
  }
  const selection: Selection = {
    sleeve: { group: new THREE.Group() },
    stage: { getBoundingClientRect: () => ({ left: 300, bottom: 600, height: 400 }) },
    disc: new THREE.Mesh(new THREE.CylinderGeometry(RECORD_RADIUS, RECORD_RADIUS, 0.005)),
    open: true,
    travel: 0,
    slide: 0,
    speed: 0,
    angle: 0,
  }
  const frame = () => scene.updateSelection(
    selection,
    { x: -300, y: 0, z: 0, size: 180, rx: -0.06, ry: 0 },
    1 / 60,
  )
  return { selection, frame }
}

function expectContainedRecordHidden(selection: Selection) {
  const rightEdge = selection.disc.position.x + RECORD_RADIUS
  if (rightEdge <= 0.5) expect(selection.disc.visible).toBe(false)
}

describe('record occlusion during shelf animations', () => {
  it('keeps the record hidden until its edge clears the sleeve when opening', () => {
    const { selection, frame } = animation()
    for (let i = 0; i < 110; i++) {
      frame()
      expectContainedRecordHidden(selection)
    }
    expect(selection.slide).toBe(1)
    expect(selection.disc.visible).toBe(true)
  })

  it('hides the record as soon as it is fully tucked in when closing', () => {
    const { selection, frame } = animation()
    selection.travel = selection.slide = 1
    selection.open = false
    // Stop before selection disposal; cover the slide and the start of the return journey.
    for (let i = 0; i < 50; i++) {
      frame()
      expectContainedRecordHidden(selection)
    }
    expect(selection.slide).toBe(0)
    expect(selection.travel).toBeLessThan(1)
    expect(selection.disc.visible).toBe(false)
  })
})
