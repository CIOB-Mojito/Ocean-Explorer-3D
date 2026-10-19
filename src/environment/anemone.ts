import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ClownfishHome, ClownfishObstacle } from '../clownfish/clownfish'

export const ANEMONE_SCALE = 1.5

const ANCHOR = new THREE.Vector3(4, 0, 2)
const BOUND_XZ = 14.5
const STATE_ORBIT_SPEED = 0.45
const HOME_CLEARANCE_Y = 0.85
const ENTRY_DISTANCE = 1.2
const EXIT_DISTANCE = 2.4
const HOME_CLAMP_XZ = 16
const HOME_MIN_Y = 1.0
const HOME_MAX_Y = 3.6

const ANGLE_OFFSETS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]

interface RockInfo {
  x: number
  z: number
  radius: number
  top: number
}

interface ConeInfo {
  x: number
  z: number
}

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

function collectRocks(scene: THREE.Scene): RockInfo[] {
  const rocks: RockInfo[] = []
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()

  scene.updateMatrixWorld(true)
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.IcosahedronGeometry)) return
    box.setFromObject(mesh)
    box.getSize(size)
    box.getCenter(center)
    rocks.push({
      x: center.x,
      z: center.z,
      radius: Math.max(size.x, size.z) / 2,
      top: box.max.y,
    })
  })

  return rocks
}

function collectCones(scene: THREE.Scene): ConeInfo[] {
  const cones: ConeInfo[] = []
  const center = new THREE.Vector3()

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.ConeGeometry)) return
    mesh.getWorldPosition(center)
    cones.push({ x: center.x, z: center.z })
  })

  return cones
}

function fits(
  x: number,
  z: number,
  rim: number,
  rocks: RockInfo[],
  chosenRock: RockInfo | null,
  cones: ConeInfo[],
): boolean {
  if (Math.abs(x) + rim > BOUND_XZ || Math.abs(z) + rim > BOUND_XZ) return false

  for (const rock of rocks) {
    if (rock === chosenRock) continue
    const dist = Math.hypot(x - rock.x, z - rock.z)
    if (dist < rock.radius + rim + 0.1) return false
  }

  const coneClearance = rim + 0.35
  for (const cone of cones) {
    if (Math.hypot(x - cone.x, z - cone.z) < coneClearance) return false
  }

  return true
}

function findFallbackSpot(
  rocks: RockInfo[],
  cones: ConeInfo[],
  rim: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number; dist: number } | null = null

  for (let x = -12; x <= 12; x += 1.5) {
    for (let z = -12; z <= 12; z += 1.5) {
      if (!fits(x, z, rim, rocks, null, cones)) continue
      const dist = Math.hypot(x - ANCHOR.x, z - ANCHOR.z)
      if (!best || dist < best.dist) best = { x, z, dist }
    }
  }

  return best
}

function clampHomePoint(point: THREE.Vector3): void {
  point.x = THREE.MathUtils.clamp(point.x, -HOME_CLAMP_XZ, HOME_CLAMP_XZ)
  point.z = THREE.MathUtils.clamp(point.z, -HOME_CLAMP_XZ, HOME_CLAMP_XZ)
  point.y = THREE.MathUtils.clamp(point.y, HOME_MIN_Y, HOME_MAX_Y)
}

export function chooseAnemoneSetup(
  scene: THREE.Scene,
  scale = ANEMONE_SCALE,
): AnemoneSetup {
  const rocks = collectRocks(scene)
  const cones = collectCones(scene)
  const rim = 1.05 * scale
  const anemoneRadius = 0.55 * scale

  let nearestRock: RockInfo | null = null
  let nearestDist = Infinity
  for (const rock of rocks) {
    const dist = Math.hypot(rock.x - ANCHOR.x, rock.z - ANCHOR.z)
    if (dist < nearestDist) {
      nearestRock = rock
      nearestDist = dist
    }
  }

  let x = ANCHOR.x
  let z = ANCHOR.z
  let dirX = 1
  let dirZ = 0

  if (nearestRock) {
    let outX = ANCHOR.x - nearestRock.x
    let outZ = ANCHOR.z - nearestRock.z
    const length = Math.hypot(outX, outZ)
    if (length < 1e-4) {
      outX = 1
      outZ = 0
    } else {
      outX /= length
      outZ /= length
    }
    dirX = outX
    dirZ = outZ

    const distance = nearestRock.radius + rim + 0.15
    let placed = false
    for (const offset of ANGLE_OFFSETS) {
      const cos = Math.cos(offset)
      const sin = Math.sin(offset)
      const dx = outX * cos - outZ * sin
      const dz = outX * sin + outZ * cos
      const px = nearestRock.x + dx * distance
      const pz = nearestRock.z + dz * distance
      if (fits(px, pz, rim, rocks, nearestRock, cones)) {
        x = px
        z = pz
        dirX = dx
        dirZ = dz
        placed = true
        break
      }
    }

    if (!placed) {
      const fallback = findFallbackSpot(rocks, cones, rim)
      if (fallback) {
        x = fallback.x
        z = fallback.z
      }
      const fx = x - nearestRock.x
      const fz = z - nearestRock.z
      const lengthToRock = Math.hypot(fx, fz)
      if (lengthToRock > 1e-4) {
        dirX = fx / lengthToRock
        dirZ = fz / lengthToRock
      }
    }
  }

  const position = new THREE.Vector3(x, 0, z)
  const center = new THREE.Vector3(x, HOME_CLEARANCE_Y * scale, z)
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

  const obstacles: ClownfishObstacle[] = rocks.map((rock) => ({
    x: rock.x,
    z: rock.z,
    radius: rock.radius,
    top: rock.top,
    clearance: 0.35,
    kind: 'rock',
  }))
  obstacles.push({
    x,
    z,
    radius: anemoneRadius,
    top: 0.75 * scale,
    clearance: 0.1,
    kind: 'anemone',
  })

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
