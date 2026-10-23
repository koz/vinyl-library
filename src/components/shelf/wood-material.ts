import * as THREE from 'three'
import { materialReference, mix } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { GetWoodPreset, WoodNodeMaterial } from 'three/examples/jsm/materials/WoodNodeMaterial.js'
import type { OakMaps } from './textures'

const WORLD_SCALE = 0.001
const OAK_FINISH = { brightness: 1.4, warmth: 0.3, grainScale: 2.55, roughness: 0.7, relief: 0 }
let oakColorNode: Node<'vec3'> | undefined

/** Selected natural oak finish, with independent grain placement for each shelf. */
export function createWoodMaterial(maps: OakMaps, nodes: boolean, offset: number) {
  const { color, bump, roughness, endGrain: endMap } = maps
  const { brightness, warmth, grainScale, roughness: surfaceRoughness, relief } = OAK_FINISH
  const tint = new THREE.Color().setRGB(
    brightness * (1 + warmth * 0.14),
    brightness,
    brightness * (1 - warmth * 0.18),
  )
  const material = nodes ? new WoodNodeMaterial({
    ...GetWoodPreset('white_oak', 'matte'),
    darkGrainColor: '#9a7049',
    lightGrainColor: '#c6a77f',
    centerSize: 0.3,
    ringBias: 0.55,
    ringThickness: 1 / 85,
    splotchIntensity: 0.18,
    fineWarpScale: 22,
    cellScale: 1100,
  }) : new THREE.MeshStandardMaterial()
  material.map = color
  material.bumpMap = bump
  material.roughnessMap = roughness
  material.envMapIntensity = 0.4
  material.roughness = nodes ? surfaceRoughness : Math.min(1, surfaceRoughness / 0.85)
  material.bumpScale = relief * (nodes ? 1 : 0.22 / 0.32) * WORLD_SCALE
  if (material instanceof WoodNodeMaterial) {
    const wood = material as WoodNodeMaterial & { colorNode: Node<'vec3'> }
    // Share the graph, but resolve texture and tint from the material being drawn.
    oakColorNode ??= mix(wood.colorNode, (materialReference('map', 'texture') as unknown as Node<'vec4'>).rgb, 0.9)
      .mul(materialReference('color', 'color') as unknown as Node<'vec3'>)
    wood.colorNode = oakColorNode
    material.customProgramCacheKey = () => wood.colorNode.getCacheKey().toString()
  }
  material.color.copy(tint)
  const end = new THREE.MeshStandardMaterial({
    map: endMap, color: tint,
    roughness: Math.min(1, surfaceRoughness / 0.85 * 0.9), envMapIntensity: 0.3,
  })
  return {
    material: nodes ? material : [end, end, material, material, material, material],
    // Per-plank UVs preserve independent placement without duplicating GPU textures.
    grain: { scale: grainScale, offset },
    setDimensions(width: number, height: number, depth: number) {
      if (!(material instanceof WoodNodeMaterial)) return
      material.transformationMatrix.set(
        0, 0, depth / 400 * grainScale, 0.65 + offset * 0.35,
        0, height / 400 * grainScale, 0, 0.28 + offset * 0.18,
        width / 80 * grainScale, 0, 0, offset * 3,
        0, 0, 0, 1,
      )
    },
    dispose() {
      material.dispose()
      end.dispose()
    },
  }
}
