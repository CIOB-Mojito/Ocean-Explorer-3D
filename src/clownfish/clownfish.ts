import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

export type ClownfishState = 'explore' | 'return' | 'stay' | 'leave'
export type ClownfishObstacleKind = 'anemone'

export interface ClownfishObstacle {
  x: number
  z: number
  radius: number
  top: number
  clearance: number
  kind: ClownfishObstacleKind
}

export interface ClownfishHome {
  center: THREE.Vector3
  entry: THREE.Vector3
  exit: THREE.Vector3
  orbitRadius: number
  orbitSpeed: number
  bobAmplitude: number
}

export interface Clownfish {
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  animations: Map<string, THREE.AnimationAction>
  current: THREE.AnimationAction | null
  speed: number
  target: THREE.Vector3
  desired: THREE.Vector3
  time: number
  phases: [number, number, number]
  home: ClownfishHome | null
  obstacles: ClownfishObstacle[]
  state: ClownfishState
  stateTime: number
  stateLimit: number
  orbitAngle: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
    marginXZ: number
    marginY: number
  }
}

const BASE_SPEED = 1.35
const MAX_TURN = 1.0
const TURN_EASE = 0.6
const PUSH_STRENGTH = 2.4
const MIN_SPEED_FACTOR = 0.45
const WALL_SLOWDOWN = 0.45
const MAX_CLIMB = 0.5
const WANDER_AMPLITUDE: [number, number, number] = [0.85, 0.45, 0.85]

const EXPLORE_MIN = 18
const EXPLORE_MAX = 35
const RETURN_TIMEOUT = 20
const STAY_MIN = 10
const STAY_MAX = 20
const LEAVE_TIMEOUT = 15
const STATE_TARGET_EASE = 3
const STAY_SPEED_FACTOR = 0.55
const ARRIVE_CENTER = 1.0
const ARRIVE_ENTRY = 1.2
const ARRIVE_EXIT = 1.2
const OBSTACLE_MARGIN = 0.6
const FISH_RADIUS = 0.3

const _lookHelper = new THREE.Object3D()
const _desiredQuat = new THREE.Quaternion()
const _facing = new THREE.Vector3()
const _toTarget = new THREE.Vector3()
const _wish = new THREE.Vector3()
const _push = new THREE.Vector3()
const _stateTarget = new THREE.Vector3()

function smoothNoise(t: number, phase: number): number {
  return (
    0.55 * Math.sin(t * 0.41 + phase) +
    0.3 * Math.sin(t * 0.97 + phase * 2.17) +
    0.15 * Math.sin(t * 1.73 + phase * 0.73)
  )
}

function computeWanderTarget(fish: Clownfish, out: THREE.Vector3): void {
  const b = fish.bounds
  const t = fish.time
  const p = fish.phases
  out.set(
    ((b.minX + b.maxX) / 2) + ((b.maxX - b.minX) / 2) * WANDER_AMPLITUDE[0] * smoothNoise(t, p[0]),
    ((b.minY + b.maxY) / 2) + ((b.maxY - b.minY) / 2) * WANDER_AMPLITUDE[1] * smoothNoise(t * 0.8, p[1]),
    ((b.minZ + b.maxZ) / 2) + ((b.maxZ - b.minZ) / 2) * WANDER_AMPLITUDE[2] * smoothNoise(t, p[2]),
  )
}

function updateWanderTarget(fish: Clownfish): void {
  computeWanderTarget(fish, fish.target)
}

function enterState(fish: Clownfish, state: ClownfishState): void {
  fish.state = state
  fish.stateTime = 0
  switch (state) {
    case 'explore':
      fish.stateLimit = EXPLORE_MIN + Math.random() * (EXPLORE_MAX - EXPLORE_MIN)
      break
    case 'return':
      fish.stateLimit = RETURN_TIMEOUT
      break
    case 'stay':
      fish.stateLimit = STAY_MIN + Math.random() * (STAY_MAX - STAY_MIN)
      break
    case 'leave':
      fish.stateLimit = LEAVE_TIMEOUT
      break
  }
}

function isObstacleActive(fish: Clownfish, obstacle: ClownfishObstacle): boolean {
  if (
    obstacle.kind === 'anemone' &&
    (fish.state === 'return' || fish.state === 'stay' || fish.state === 'leave')
  ) {
    return false
  }
  return fish.root.position.y - FISH_RADIUS <= obstacle.top
}

function updateRefugeState(fish: Clownfish, dt: number): void {
  const home = fish.home
  if (!home) return
  const pos = fish.root.position
  fish.stateTime += dt

  switch (fish.state) {
    case 'explore': {
      computeWanderTarget(fish, _stateTarget)
      if (fish.stateTime >= fish.stateLimit) enterState(fish, 'return')
      break
    }
    case 'return': {
      const entryDist = Math.hypot(pos.x - home.entry.x, pos.z - home.entry.z)
      _stateTarget.copy(entryDist <= ARRIVE_ENTRY ? home.center : home.entry)
      if (pos.distanceTo(home.center) <= ARRIVE_CENTER || fish.stateTime >= fish.stateLimit) {
        fish.orbitAngle = Math.atan2(pos.z - home.center.z, pos.x - home.center.x)
        enterState(fish, 'stay')
        _stateTarget.copy(pos)
      }
      break
    }
    case 'stay': {
      fish.orbitAngle += home.orbitSpeed * dt
      _stateTarget.set(
        home.center.x + Math.cos(fish.orbitAngle) * home.orbitRadius,
        home.center.y + Math.sin(fish.time * 1.1) * home.bobAmplitude,
        home.center.z + Math.sin(fish.orbitAngle) * home.orbitRadius,
      )
      if (fish.stateTime >= fish.stateLimit) enterState(fish, 'leave')
      break
    }
    case 'leave': {
      _stateTarget.copy(home.exit)
      const exitDist = Math.hypot(pos.x - home.exit.x, pos.z - home.exit.z)
      if (exitDist <= ARRIVE_EXIT || fish.stateTime >= fish.stateLimit) {
        enterState(fish, 'explore')
      }
      break
    }
  }

  const ease = 1 - Math.exp(-STATE_TARGET_EASE * dt)
  fish.target.lerp(_stateTarget, ease)
}

function addObstaclePush(fish: Clownfish, out: THREE.Vector3): number {
  const pos = fish.root.position
  let strength = 0

  for (const obstacle of fish.obstacles) {
    if (!isObstacleActive(fish, obstacle)) continue
    const dx = pos.x - obstacle.x
    const dz = pos.z - obstacle.z
    const dist = Math.hypot(dx, dz)
    const hardDist = obstacle.radius + FISH_RADIUS + obstacle.clearance
    const range = hardDist + OBSTACLE_MARGIN
    if (dist >= range || dist < 1e-4) continue
    const overlap = Math.min(1, (range - dist) / OBSTACLE_MARGIN)
    if (pos.y >= obstacle.top) {
      out.y += overlap
    } else {
      const nx = dx / dist
      const nz = dz / dist
      out.x += nx * overlap
      out.z += nz * overlap

      const targetX = fish.target.x - pos.x
      const targetZ = fish.target.z - pos.z
      if (targetX * nx + targetZ * nz < 0) {
        let tangentX = -nz
        let tangentZ = nx
        if (tangentX * targetX + tangentZ * targetZ < 0) {
          tangentX = -tangentX
          tangentZ = -tangentZ
        }
        out.x += tangentX * overlap
        out.z += tangentZ * overlap
      }
    }
    strength = Math.max(strength, overlap)
  }

  return strength
}

function resolveObstacles(fish: Clownfish): void {
  const pos = fish.root.position

  for (const obstacle of fish.obstacles) {
    if (!isObstacleActive(fish, obstacle)) continue
    const dx = pos.x - obstacle.x
    const dz = pos.z - obstacle.z
    const dist = Math.hypot(dx, dz)
    const hardDist = obstacle.radius + FISH_RADIUS + obstacle.clearance
    if (dist >= hardDist) continue

    const verticalCorrection = obstacle.top + FISH_RADIUS - pos.y
    const horizontalCorrection = hardDist - dist
    if (verticalCorrection < horizontalCorrection) {
      pos.y = obstacle.top + FISH_RADIUS
      continue
    }

    if (dist < 1e-4) {
      pos.x = obstacle.x + hardDist
      pos.z = obstacle.z
    } else {
      const scale = hardDist / dist
      pos.x = obstacle.x + dx * scale
      pos.z = obstacle.z + dz * scale
    }
  }
}

function addWallPush(p: number, lo: number, hi: number, margin: number, axis: number, out: THREE.Vector3): number {
  if (p < lo + margin) {
    const w = Math.min(1, (lo + margin - p) / margin)
    const s = w * w
    if (axis === 0) out.x += s
    else if (axis === 1) out.y += s
    else out.z += s
    return w
  }
  if (p > hi - margin) {
    const w = Math.min(1, (p - (hi - margin)) / margin)
    const s = w * w
    if (axis === 0) out.x -= s
    else if (axis === 1) out.y -= s
    else out.z -= s
    return w
  }
  return 0
}

export async function loadClownfish(
  scene: THREE.Scene,
  path = '/models/pez_payaso.glb',
  options: {
    scale?: number
    position?: THREE.Vector3
    rotation?: THREE.Euler
    home?: ClownfishHome | null
    obstacles?: ClownfishObstacle[]
  } = {},
): Promise<Clownfish> {
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
  loader.setDRACOLoader(draco)

  const gltf = await loader.loadAsync(path)
  const root = gltf.scene

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial
        sm.side = THREE.FrontSide
      }
    }
  })

  const scale = options.scale ?? 1
  root.scale.setScalar(scale)
  if (options.position) root.position.copy(options.position)
  if (options.rotation) root.rotation.copy(options.rotation)

  scene.add(root)

  const mixer = new THREE.AnimationMixer(root)
  const animations = new Map<string, THREE.AnimationAction>()
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    animations.set(clip.name, action)
  }

  let current: THREE.AnimationAction | null = null
  const swim = animations.get('Swim') || animations.get('swim')
  const idle = animations.get('Idle') || animations.get('idle')
  if (swim) {
    swim.reset().play()
    current = swim
  } else if (idle) {
    idle.reset().play()
    current = idle
  }

  const fish: Clownfish = {
    root,
    mixer,
    animations,
    current,
    speed: 1,
    target: root.position.clone(),
    desired: new THREE.Vector3(0, 0, 1),
    time: Math.random() * 100,
    phases: [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ],
    home: options.home ?? null,
    obstacles: options.obstacles ?? [],
    state: 'explore',
    stateTime: 0,
    stateLimit: EXPLORE_MIN + Math.random() * (EXPLORE_MAX - EXPLORE_MIN),
    orbitAngle: 0,
    bounds: {
      minX: -17,
      maxX: 17,
      minY: 0.8,
      maxY: 3.8,
      minZ: -17,
      maxZ: 17,
      marginXZ: 2.2,
      marginY: 1.1,
    },
  }

  root.updateMatrixWorld(true)
  root.getWorldDirection(fish.desired)
  updateWanderTarget(fish)

  return fish
}

export function updateClownfish(fish: Clownfish, delta: number): void {
  const dt = Math.min(delta, 0.25)
  fish.time += dt
  if (fish.home) {
    updateRefugeState(fish, dt)
  } else {
    updateWanderTarget(fish)
  }

  const b = fish.bounds
  const pos = fish.root.position

  _toTarget.subVectors(fish.target, pos)
  const dist = _toTarget.length()
  if (dist > 1e-4) {
    _wish.copy(_toTarget).divideScalar(dist)
    _wish.y = THREE.MathUtils.clamp(_wish.y, -MAX_CLIMB, MAX_CLIMB)
  } else {
    _wish.set(0, 0, 0)
  }

  _push.set(0, 0, 0)
  let wallW = addWallPush(pos.x, b.minX, b.maxX, b.marginXZ, 0, _push)
  wallW = Math.max(wallW, addWallPush(pos.y, b.minY, b.maxY, b.marginY, 1, _push))
  wallW = Math.max(wallW, addWallPush(pos.z, b.minZ, b.maxZ, b.marginXZ, 2, _push))
  wallW = Math.max(wallW, addObstaclePush(fish, _push))
  _wish.addScaledVector(_push, PUSH_STRENGTH)

  if (_wish.lengthSq() > 1e-8) {
    _wish.normalize()
  } else {
    _wish.set(0, 0, 1)
  }
  fish.desired.copy(_wish)

  _lookHelper.position.set(0, 0, 0)
  _lookHelper.lookAt(_wish)
  _desiredQuat.copy(_lookHelper.quaternion)

  const angle = fish.root.quaternion.angleTo(_desiredQuat)
  const step = MAX_TURN * dt * Math.min(1, angle / TURN_EASE)
  if (step > 0) fish.root.quaternion.rotateTowards(_desiredQuat, step)

  fish.root.getWorldDirection(_facing)
  const align = Math.max(0, _facing.dot(_wish))
  const pace = 0.92 + 0.08 * Math.sin(fish.time * 0.63 + fish.phases[0] * 1.7)
  const stateSpeed = fish.home && fish.state === 'stay' ? STAY_SPEED_FACTOR : 1
  const speedNow =
    BASE_SPEED *
    fish.speed *
    pace *
    (MIN_SPEED_FACTOR + (1 - MIN_SPEED_FACTOR) * align) *
    (1 - WALL_SLOWDOWN * wallW) *
    stateSpeed
  pos.addScaledVector(_facing, speedNow * dt)

  resolveObstacles(fish)

  pos.x = THREE.MathUtils.clamp(pos.x, b.minX + 0.1, b.maxX - 0.1)
  pos.y = THREE.MathUtils.clamp(pos.y, b.minY + 0.1, b.maxY - 0.1)
  pos.z = THREE.MathUtils.clamp(pos.z, b.minZ + 0.1, b.maxZ - 0.1)

  if (fish.mixer) {
    const beat = THREE.MathUtils.clamp(
      speedNow / (BASE_SPEED * Math.max(fish.speed, 1e-3)),
      0.55,
      1.15,
    )
    fish.mixer.update(dt * beat)
  }
}

export function playClownfishAnimation(fish: Clownfish, name: string, fade = 0.35): void {
  const next = fish.animations.get(name)
  if (!next || next === fish.current) return
  next.reset().play()
  if (fish.current) {
    fish.current.crossFadeTo(next, fade, false)
  }
  fish.current = next
}
