import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type SchoolState = 'roam' | 'pause'

export interface SchoolObstacle {
  x: number
  z: number
  radius: number
  top: number
  clearance: number
}

export interface SchoolBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface SchoolFish {
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  action: THREE.AnimationAction | null
  velocity: THREE.Vector3
  speedFactor: number
  phases: [number, number, number]
  pauseOffset: THREE.Vector3
  scale: number
}

export interface School {
  root: THREE.Group
  fish: SchoolFish[]
  obstacles: SchoolObstacle[]
  bounds: SchoolBounds
  target: THREE.Vector3
  center: THREE.Vector3
  anchor: THREE.Vector3
  state: SchoolState
  stateTime: number
  stateLimit: number
  time: number
}

export interface SchoolOptions {
  count?: number
  scale?: number
  obstacles?: SchoolObstacle[]
  bounds?: SchoolBounds
}

export const DEFAULT_SCHOOL_BOUNDS: SchoolBounds = {
  minX: -13,
  maxX: 13,
  minY: 1.2,
  maxY: 3.4,
  minZ: -13,
  maxZ: 13,
}

const DEFAULT_COUNT = 8
const DEFAULT_SCALE = 1.2

const MAX_FORCE = 3.2
const MAX_SPEED = 1.25
const MIN_SPEED = 0.12
const TURN_EASE = 4.5
const MAX_STEP = 0.1

const SEPARATION_RADIUS = 1.25
const SEPARATION_WEIGHT = 8.0
const COHESION_WEIGHT = 0.85
const ALIGNMENT_WEIGHT = 0.8
const SEEK_WEIGHT = 1.25
const PAUSE_SEEK_WEIGHT = 0.5
const WANDER_WEIGHT = 0.55
const PAUSE_WANDER_WEIGHT = 1.0
const OBSTACLE_WEIGHT = 4.5
const OBSTACLE_MARGIN = 0.8
const BOUND_WEIGHT = 4.5
const BOUND_MARGIN = 1.4
const FISH_RADIUS = 0.28

const ROAM_MIN = 8
const ROAM_MAX = 16
const PAUSE_MIN = 4
const PAUSE_MAX = 8

const _accel = new THREE.Vector3()
const _toTarget = new THREE.Vector3()
const _toCenter = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _wander = new THREE.Vector3()
const _bound = new THREE.Vector3()
const _stateTarget = new THREE.Vector3()
const _centerSum = new THREE.Vector3()
const _avgVelocity = new THREE.Vector3()
const _avgVelocityNorm = new THREE.Vector3()
const _faceDir = new THREE.Vector3()
const _desiredQuat = new THREE.Quaternion()
const _lookHelper = new THREE.Object3D()

function smoothNoise(t: number, phase: number): number {
  return (
    0.55 * Math.sin(t * 0.41 + phase) +
    0.3 * Math.sin(t * 0.97 + phase * 2.17) +
    0.15 * Math.sin(t * 1.73 + phase * 0.73)
  )
}

function randomStateLimit(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function faceDirection(root: THREE.Object3D, direction: THREE.Vector3): void {
  if (direction.lengthSq() < 1e-8) return
  _faceDir.copy(direction).normalize()
  _lookHelper.position.set(0, 0, 0)
  _lookHelper.lookAt(_faceDir)
  root.quaternion.copy(_lookHelper.quaternion)
}

function clampToBounds(point: THREE.Vector3, bounds: SchoolBounds): THREE.Vector3 {
  point.x = THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX)
  point.y = THREE.MathUtils.clamp(point.y, bounds.minY, bounds.maxY)
  point.z = THREE.MathUtils.clamp(point.z, bounds.minZ, bounds.maxZ)
  return point
}

function pickRoamTarget(
  bounds: SchoolBounds,
  obstacles: SchoolObstacle[],
  center: THREE.Vector3,
  out: THREE.Vector3,
): void {
  let bestScore = -Infinity
  let found = false

  for (let attempt = 0; attempt < 12; attempt++) {
    const x = THREE.MathUtils.lerp(bounds.minX + 2, bounds.maxX - 2, Math.random())
    const y = THREE.MathUtils.lerp(bounds.minY + 0.3, bounds.maxY - 0.3, Math.random())
    const z = THREE.MathUtils.lerp(bounds.minZ + 2, bounds.maxZ - 2, Math.random())

    let clear = true
    for (const obstacle of obstacles) {
      if (y - FISH_RADIUS > obstacle.top) continue
      const dist = Math.hypot(x - obstacle.x, z - obstacle.z)
      if (dist < obstacle.radius + FISH_RADIUS + obstacle.clearance + 0.9) {
        clear = false
        break
      }
    }
    if (!clear) continue

    const dist = Math.hypot(x - center.x, y - center.y, z - center.z)
    const score = dist * (0.75 + Math.random() * 0.5)
    if (score > bestScore) {
      bestScore = score
      out.set(x, y, z)
      found = true
    }
  }

  if (!found) out.copy(center)
  clampToBounds(out, bounds)
}

function addBoundPush(
  p: number,
  lo: number,
  hi: number,
  margin: number,
  axis: number,
  out: THREE.Vector3,
): void {
  if (p < lo + margin) {
    const w = Math.min(1, (lo + margin - p) / margin)
    const s = w * w
    if (axis === 0) out.x += s
    else if (axis === 1) out.y += s
    else out.z += s
  } else if (p > hi - margin) {
    const w = Math.min(1, (p - (hi - margin)) / margin)
    const s = w * w
    if (axis === 0) out.x -= s
    else if (axis === 1) out.y -= s
    else out.z -= s
  }
}

function enterPause(school: School): void {
  school.state = 'pause'
  school.stateTime = 0
  school.stateLimit = randomStateLimit(PAUSE_MIN, PAUSE_MAX)
  school.anchor.copy(school.center)
  clampToBounds(school.anchor, school.bounds)

  const count = school.fish.length
  for (let i = 0; i < count; i++) {
    const fish = school.fish[i]
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.6
    const radius = Math.random() * 1.5
    fish.pauseOffset.set(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 0.5,
      Math.sin(angle) * radius,
    )
  }
}

function enterRoam(school: School): void {
  school.state = 'roam'
  school.stateTime = 0
  school.stateLimit = randomStateLimit(ROAM_MIN, ROAM_MAX)
  pickRoamTarget(school.bounds, school.obstacles, school.center, school.target)
}

export async function loadSchool(
  scene: THREE.Scene,
  path = '/models/pez_cardumen.glb',
  options: SchoolOptions = {},
): Promise<School> {
  const count = Math.max(1, Math.floor(options.count ?? DEFAULT_COUNT))
  const baseScale = options.scale ?? DEFAULT_SCALE
  const obstacles = options.obstacles ?? []
  const bounds = options.bounds ?? DEFAULT_SCHOOL_BOUNDS

  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(path)
  const template = gltf.scene
  const clip = gltf.animations.find((animation) => animation.name === 'Swim') ?? gltf.animations[0]

  template.updateMatrixWorld(true)
  template.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
  })

  const root = new THREE.Group()
  root.name = 'School'
  scene.add(root)

  const schoolCenter = new THREE.Vector3(0, (bounds.minY + bounds.maxY) / 2 + 0.4, 0)
  clampToBounds(schoolCenter, bounds)

  const fish: SchoolFish[] = []
  for (let i = 0; i < count; i++) {
    const clone = cloneSkeleton(template) as THREE.Group
    clone.name = `SchoolFish_${i}`

    const scale = baseScale * (0.94 + Math.random() * 0.12)
    clone.scale.setScalar(scale)

    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25
    const radius = 1.15 + Math.random() * 0.9
    const y = schoolCenter.y + (Math.random() - 0.5) * 0.4
    clone.position.set(
      Math.cos(angle) * radius,
      THREE.MathUtils.clamp(y, bounds.minY + 0.2, bounds.maxY - 0.2),
      Math.sin(angle) * radius,
    )

    const velocity = new THREE.Vector3(
      Math.cos(angle + Math.PI / 2),
      (Math.random() - 0.5) * 0.15,
      Math.sin(angle + Math.PI / 2),
    ).multiplyScalar(0.5 + Math.random() * 0.3)
    faceDirection(clone, velocity)

    let mixer: THREE.AnimationMixer | null = null
    let action: THREE.AnimationAction | null = null
    if (clip) {
      mixer = new THREE.AnimationMixer(clone)
      action = mixer.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.timeScale = 0.85 + Math.random() * 0.3
      action.reset()
      action.time = Math.random() * clip.duration
      action.play()
    }

    root.add(clone)
    fish.push({
      root: clone,
      mixer,
      action,
      velocity,
      speedFactor: 0.9 + Math.random() * 0.2,
      phases: [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ],
      pauseOffset: new THREE.Vector3(),
      scale,
    })
  }

  const school: School = {
    root,
    fish,
    obstacles,
    bounds,
    target: new THREE.Vector3(),
    center: new THREE.Vector3(schoolCenter.x, schoolCenter.y, schoolCenter.z),
    anchor: new THREE.Vector3(schoolCenter.x, schoolCenter.y, schoolCenter.z),
    state: 'roam',
    stateTime: 0,
    stateLimit: randomStateLimit(6, 12),
    time: Math.random() * 100,
  }
  pickRoamTarget(bounds, obstacles, school.center, school.target)

  return school
}

export function updateSchool(school: School, delta: number): void {
  const dt = Math.min(delta, MAX_STEP)
  if (dt <= 0) return

  school.time += dt
  school.stateTime += dt

  const fishList = school.fish
  const count = fishList.length
  if (count === 0) return

  _centerSum.set(0, 0, 0)
  _avgVelocity.set(0, 0, 0)
  for (const fish of fishList) {
    _centerSum.add(fish.root.position)
    _avgVelocity.add(fish.velocity)
  }
  school.center.copy(_centerSum).divideScalar(count)

  const avgSpeed = _avgVelocity.length()
  if (avgSpeed > 1e-5) {
    _avgVelocityNorm.copy(_avgVelocity).divideScalar(avgSpeed)
  } else {
    _avgVelocityNorm.set(0, 0, 1)
  }

  if (school.state === 'roam' && school.stateTime >= school.stateLimit) {
    enterPause(school)
  } else if (school.state === 'pause' && school.stateTime >= school.stateLimit) {
    enterRoam(school)
  }

  const paused = school.state === 'pause'

  for (const fish of fishList) {
    const pos = fish.root.position

    if (paused) {
      _stateTarget.set(
        school.anchor.x + fish.pauseOffset.x + Math.sin(school.time * 0.42 + fish.phases[0]) * 0.35,
        school.anchor.y + fish.pauseOffset.y + Math.sin(school.time * 0.55 + fish.phases[1]) * 0.12,
        school.anchor.z + fish.pauseOffset.z + Math.cos(school.time * 0.38 + fish.phases[2]) * 0.35,
      )
      clampToBounds(_stateTarget, school.bounds)
    } else {
      _stateTarget.copy(school.target)
    }

    _accel.set(0, 0, 0)

    _toTarget.subVectors(_stateTarget, pos)
    const targetDist = _toTarget.length()
    if (targetDist > 0.05) {
      _toTarget.divideScalar(targetDist)
      const seek = paused ? PAUSE_SEEK_WEIGHT : SEEK_WEIGHT
      const distFactor = Math.min(1, targetDist / (paused ? 1.2 : 2.5))
      _accel.addScaledVector(_toTarget, seek * distFactor)
    }

    _toCenter.subVectors(school.center, pos)
    const centerDist = _toCenter.length()
    if (centerDist > 0.05) {
      _toCenter.divideScalar(centerDist)
      _accel.addScaledVector(_toCenter, COHESION_WEIGHT * Math.min(1, centerDist / 4))
    }

    if (avgSpeed > 0.05) {
      _accel.addScaledVector(_avgVelocityNorm, paused ? ALIGNMENT_WEIGHT * 0.45 : ALIGNMENT_WEIGHT)
    }

    for (const other of fishList) {
      if (other === fish) continue
      _sep.subVectors(pos, other.root.position)
      const dist = _sep.length()
      if (dist < SEPARATION_RADIUS && dist > 1e-4) {
        const weight = 1 - dist / SEPARATION_RADIUS
        _accel.addScaledVector(_sep.divideScalar(dist), SEPARATION_WEIGHT * weight)
      }
    }

    _wander.set(
      smoothNoise(school.time * 0.62, fish.phases[0]),
      smoothNoise(school.time * 0.48, fish.phases[1]) * 0.55,
      smoothNoise(school.time * 0.57, fish.phases[2]),
    )
    _accel.addScaledVector(_wander, paused ? PAUSE_WANDER_WEIGHT : WANDER_WEIGHT)

    for (const obstacle of school.obstacles) {
      if (pos.y - FISH_RADIUS > obstacle.top) continue

      const dx = pos.x - obstacle.x
      const dz = pos.z - obstacle.z
      const dist = Math.hypot(dx, dz)
      const range = obstacle.radius + FISH_RADIUS + obstacle.clearance + OBSTACLE_MARGIN
      if (dist >= range || dist < 1e-4) continue

      const weight = Math.min(1, (range - dist) / OBSTACLE_MARGIN)
      const nx = dx / dist
      const nz = dz / dist
      _accel.x += nx * OBSTACLE_WEIGHT * weight
      _accel.z += nz * OBSTACLE_WEIGHT * weight

      const targetX = _stateTarget.x - pos.x
      const targetZ = _stateTarget.z - pos.z
      if (targetX * nx + targetZ * nz < 0) {
        let tangentX = -nz
        let tangentZ = nx
        if (tangentX * targetX + tangentZ * targetZ < 0) {
          tangentX = -tangentX
          tangentZ = -tangentZ
        }
        _accel.x += tangentX * OBSTACLE_WEIGHT * 0.7 * weight
        _accel.z += tangentZ * OBSTACLE_WEIGHT * 0.7 * weight
      }
    }

    _bound.set(0, 0, 0)
    addBoundPush(pos.x, school.bounds.minX, school.bounds.maxX, BOUND_MARGIN, 0, _bound)
    addBoundPush(pos.y, school.bounds.minY, school.bounds.maxY, BOUND_MARGIN, 1, _bound)
    addBoundPush(pos.z, school.bounds.minZ, school.bounds.maxZ, BOUND_MARGIN, 2, _bound)
    _accel.addScaledVector(_bound, BOUND_WEIGHT)

    if (_accel.lengthSq() > MAX_FORCE * MAX_FORCE) {
      _accel.setLength(MAX_FORCE)
    }

    fish.velocity.addScaledVector(_accel, dt)

    let speed = fish.velocity.length()
    const maxSpeed = MAX_SPEED * fish.speedFactor * (paused ? 0.55 : 1)
    if (speed > maxSpeed) {
      fish.velocity.multiplyScalar(maxSpeed / speed)
      speed = maxSpeed
    } else if (speed < MIN_SPEED) {
      if (speed > 1e-4) {
        fish.velocity.multiplyScalar(MIN_SPEED / speed)
      } else {
        fish.root.getWorldDirection(_faceDir)
        fish.velocity.copy(_faceDir).multiplyScalar(MIN_SPEED)
      }
    }

    pos.addScaledVector(fish.velocity, dt)
    clampToBounds(pos, school.bounds)

    _faceDir.copy(fish.velocity)
    if (_faceDir.lengthSq() > 1e-6) {
      _faceDir.normalize()
      _lookHelper.position.set(0, 0, 0)
      _lookHelper.lookAt(_faceDir)
      _desiredQuat.copy(_lookHelper.quaternion)
      fish.root.quaternion.slerp(_desiredQuat, 1 - Math.exp(-TURN_EASE * dt))
    }

    if (fish.mixer) {
      fish.mixer.update(dt)
    }
  }
}
