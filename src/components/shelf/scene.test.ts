import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { ShelfScene } from './scene'
import { RECORD_RADIUS } from './layout'
import { createSleeveGeometry } from './geometry'

type Selection = {
  sleeve: {
    group: THREE.Group
    tilt: number
    info: { id: number }
    element: { getBoundingClientRect: () => { left: number; bottom: number; width: number } }
  }
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
    update: (dt: number) => boolean
  }
  const selection: Selection = {
    sleeve: {
      group: new THREE.Group(),
      tilt: 0,
      info: { id: 1 },
      element: { getBoundingClientRect: () => ({ left: 210, bottom: 400, width: 180 }) },
    },
    stage: { getBoundingClientRect: () => ({ left: 300, bottom: 600, height: 400 }) },
    disc: new THREE.Mesh(new THREE.CylinderGeometry(RECORD_RADIUS, RECORD_RADIUS, 0.005)),
    open: true,
    travel: 0,
    slide: 0,
    speed: 0,
    angle: 0,
  }
  const frame = (pose = { x: -300, y: 0, z: 0, size: 180, rx: -0.06, ry: 0 }) => scene.updateSelection(
    selection,
    pose,
    1 / 60,
  )
  Object.assign(scene, {
    selection,
    sleeves: new Map([[selection.sleeve.element, selection.sleeve]]),
    planks: new Map(),
    hovered: null,
  })
  return { scene, selection, frame }
}

describe('hover tilt when pulling a sleeve forward', () => {
  for (const tilt of [0, 0.4, 1]) {
    it(`preserves the current hover tilt (${tilt}) until the sleeve clears the shelf`, () => {
      const { scene, selection } = animation()
      selection.sleeve.tilt = tilt
      const angle = -0.06 + tilt * 0.16
      for (let i = 0; i < 13; i++) {
        scene.update(1 / 60)
        expect(selection.sleeve.group.rotation.x).toBeCloseTo(angle, 10)
      }
      expect(selection.sleeve.group.position.z).toBeGreaterThan(80)
      for (let i = 0; i < 33; i++) scene.update(1 / 60)
      expect(selection.sleeve.group.rotation.x).toBeCloseTo(0, 10)
      expect(selection.sleeve.group.rotation.y).toBeCloseTo(-0.05, 10)
    })
  }
})

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

describe('sleeve clearance above the wooden shelf', () => {
  for (const [index, left] of [24, 237.8125].entries()) {
    for (const open of [true, false]) {
      it(`keeps record ${index + 1} clear of the plank when ${open ? 'opening' : 'returning'}`, () => {
        const { scene, selection, frame } = animation()
        // A tall viewport puts the preview below the top shelf, exposing the collision.
        Object.assign(scene, {
          width: 892,
          height: 1450,
          distance: 1450 / 2 / Math.tan(Math.PI / 12),
        })
        selection.stage.getBoundingClientRect = () => ({
          left: 58.078125, bottom: 887.25, height: 324.5,
        })
        selection.open = open
        selection.travel = open ? 0 : 1
        const pose = {
          x: left + 187.515625 / 2 - 892 / 2,
          y: 1450 / 2 - 358.15625,
          z: 0,
          size: 187.515625,
          rx: -0.06,
          ry: 0,
        }
        // Inset the top by half a pixel to allow contact at the resting pivot.
        const plank = new OBB(
          new THREE.Vector3(12 + 853 / 2 - 892 / 2, 1450 / 2 - 358.15625 - 8.25, -10),
          new THREE.Vector3(853 / 2, 7.75, 28),
        )
        const geometry = createSleeveGeometry()
        const sleeve = new OBB().fromBox3(geometry.boundingBox!)
        geometry.dispose()
        // Leave the final closing frame to the normal disposal path.
        for (let i = 0; i < 44; i++) {
          frame(pose)
          selection.sleeve.group.updateMatrixWorld(true)
          const bounds = sleeve.clone().applyMatrix4(selection.sleeve.group.matrixWorld)
          bounds.center.copy(sleeve.center).applyMatrix4(selection.sleeve.group.matrixWorld)
          expect(
            bounds.intersectsOBB(plank),
            `plank intersection at travel=${selection.travel}`,
          ).toBe(false)
        }
      })
    }
  }
})
