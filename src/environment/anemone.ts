import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ClownfishHome, ClownfishObstacle } from '../clownfish/clownfish'

export const ANEMONE_SCALE = 1.5

const ANCHOR = new THREE.Vector3(4, 0, 2)
const STATE_ORBIT_SPEED = 0.45
const HOME_CLEARANCE_Y = 0.85
const ENTRY_DISTANCE = 1.2
const EXIT_DISTANCE = 2.4
const HOME_CLAMP_XZ = 16
const HOME_MIN_Y = 1.0
const HOME_MAX_Y = 3.6

export interface AnemonePlacement {
  position: THREE.Vector3
  rotationY: number
}

export interface AnemoneSetup {
  placement: AnemonePlacement
  home: ClownfishHome
  obstacles: ClownfishObstacle[]
}

export interface Anemone {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  update: (delta: number) => void
}

function clampHomePoint(point: THREE.Vector3): void {
  point.x = THREE.MathUtils.clamp(point.x, -HOME_CLAMP_XZ, HOME_CLAMP_XZ)
  point.z = THREE.MathUtils.clamp(point.z, -HOME_CLAMP_XZ, HOME_CLAMP_XZ)
  point.y = THREE.MathUtils.clamp(point.y, HOME_MIN_Y, HOME_MAX_Y)
}

export function chooseAnemoneSetup(scale = ANEMONE_SCALE): AnemoneSetup {
  const anemoneRadius = 0.55 * scale
  const dirX = 1
  const dirZ = 0
  const position = new THREE.Vector3(ANCHOR.x, 0, ANCHOR.z)
  const center = new THREE.Vector3(ANCHOR.x, HOME_CLEARANCE_Y * scale, ANCHOR.z)
  const entry = new THREE.Vector3(
    center.x + dirX * ENTRY_DISTANCE * scale,
    center.y,
    center.z + dirZ * ENTRY_DISTANCE * scale,
  )
  const exit = new THREE.Vector3(
    center.x + dirX * EXIT_DISTANCE * scale,
    center.y + 0.1 * scale,
    center.z + dirZ * EXIT_DISTANCE * scale,
  )
  clampHomePoint(center)
  clampHomePoint(entry)
  clampHomePoint(exit)

  const home: ClownfishHome = {
    center,
    entry,
    exit,
    orbitRadius: anemoneRadius,
    orbitSpeed: STATE_ORBIT_SPEED,
    bobAmplitude: 0.1 * scale,
  }

  const obstacles: ClownfishObstacle[] = [
    {
      x: position.x,
      z: position.z,
      radius: anemoneRadius,
      top: 0.75 * scale,
      clearance: 0.1,
      kind: 'anemone',
    },
  ]

  return {
    placement: {
      position,
      rotationY: Math.atan2(dirX, dirZ),
    },
    home,
    obstacles,
  }
}

export async function loadAnemone(
  scene: THREE.Scene,
  path: string,
  placement: AnemonePlacement,
  scale = ANEMONE_SCALE,
): Promise<Anemone> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(path)
  const root = gltf.scene

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
  })

  root.position.copy(placement.position)
  root.rotation.set(0, placement.rotationY, 0)
  root.scale.setScalar(scale)
  scene.add(root)

  const mixer = new THREE.AnimationMixer(root)
  const clip =
    gltf.animations.find((animation) => animation.name === 'Sway') ??
    gltf.animations[0]
  if (clip) {
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
  }

  return {
    root,
    mixer,
    update: (delta: number) => {
      mixer.update(Math.min(delta, 0.1))
    },
  }
}
