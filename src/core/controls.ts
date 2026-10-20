import * as THREE from 'three'
import type { World } from './scene'

export interface FreeControls {
  update(delta: number): void
  dispose(): void
}

const LOOK_SENSITIVITY = 0.0032
const MOVE_SPEED = 3.6
const CLIMB_SPEED = 2.4
const MOVE_SMOOTH = 10
const LOOK_SMOOTH = 16
const MAX_PITCH = 1.45
const JOY_DEADZONE = 0.12
const KNOB_TRAVEL = 0.6
const MIN_X = -15
const MAX_X = 15
const MIN_Z = -15
const MAX_Z = 15
const MIN_Y = 0.6
const MAX_Y = 12.0

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function createControls(world: World): FreeControls {
  const camera = world.camera
  camera.rotation.order = 'YXZ'
  camera.position.set(0, 2, 6)
  camera.lookAt(0, 2, 0)

  let yaw = camera.rotation.y
  let pitch = camera.rotation.x
  let targetYaw = yaw
  let targetPitch = pitch

  let moveX = 0
  let moveZ = 0
  let upHeld = false
  let downHeld = false

  const velocity = new THREE.Vector3()
  const desired = new THREE.Vector3()
  const position = camera.position

  const parent: HTMLElement = world.renderer.domElement.parentElement ?? document.body

  const lookLayer = document.createElement('div')
  lookLayer.className = 'look-layer'

  const joystick = document.createElement('div')
  joystick.className = 'joystick'
  const knob = document.createElement('div')
  knob.className = 'joystick-knob'
  joystick.appendChild(knob)

  const upButton = document.createElement('div')
  upButton.className = 'vbtn vbtn-up'
  upButton.textContent = '▲'
  const downButton = document.createElement('div')
  downButton.className = 'vbtn vbtn-down'
  downButton.textContent = '▼'

  parent.append(lookLayer, joystick, upButton, downButton)

  let lookPointer: number | null = null
  let lookX = 0
  let lookY = 0

  lookLayer.addEventListener('pointerdown', (event) => {
    if (lookPointer !== null) return
    lookPointer = event.pointerId
    lookX = event.clientX
    lookY = event.clientY
    lookLayer.setPointerCapture(event.pointerId)
  })

  lookLayer.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookPointer) return
    const dx = event.clientX - lookX
    const dy = event.clientY - lookY
    lookX = event.clientX
    lookY = event.clientY
    targetYaw -= dx * LOOK_SENSITIVITY
    targetPitch = clamp(targetPitch - dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH)
  })

  function endLook(event: PointerEvent): void {
    if (event.pointerId !== lookPointer) return
    lookPointer = null
  }
  lookLayer.addEventListener('pointerup', endLook)
  lookLayer.addEventListener('pointercancel', endLook)

  let joyPointer: number | null = null
  let joyCenterX = 0
  let joyCenterY = 0
  let joyMax = 1

  function updateJoystick(clientX: number, clientY: number): void {
    let dx = clientX - joyCenterX
    let dy = clientY - joyCenterY
    const length = Math.hypot(dx, dy)
    const travel = joyMax * KNOB_TRAVEL
    if (length > travel) {
      dx = (dx / length) * travel
      dy = (dy / length) * travel
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    const nx = dx / travel
    const ny = dy / travel
    moveX = Math.abs(nx) < JOY_DEADZONE ? 0 : nx
    moveZ = Math.abs(ny) < JOY_DEADZONE ? 0 : -ny
  }

  joystick.addEventListener('pointerdown', (event) => {
    if (joyPointer !== null) return
    event.stopPropagation()
    const rect = joystick.getBoundingClientRect()
    joyCenterX = rect.left + rect.width / 2
    joyCenterY = rect.top + rect.height / 2
    joyMax = rect.width / 2
    joyPointer = event.pointerId
    joystick.setPointerCapture(event.pointerId)
    updateJoystick(event.clientX, event.clientY)
  })

  joystick.addEventListener('pointermove', (event) => {
    if (event.pointerId !== joyPointer) return
    updateJoystick(event.clientX, event.clientY)
  })

  function endJoystick(event: PointerEvent): void {
    if (event.pointerId !== joyPointer) return
    joyPointer = null
    moveX = 0
    moveZ = 0
    knob.style.transform = 'translate(-50%, -50%)'
  }
  joystick.addEventListener('pointerup', endJoystick)
  joystick.addEventListener('pointercancel', endJoystick)

  function bindHold(element: HTMLElement, setHeld: (held: boolean) => void): void {
    element.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      element.setPointerCapture(event.pointerId)
      setHeld(true)
    })
    const release = (event: PointerEvent): void => {
      event.stopPropagation()
      setHeld(false)
    }
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
  }
  bindHold(upButton, (held) => { upHeld = held })
  bindHold(downButton, (held) => { downHeld = held })

  function clampPosition(point: THREE.Vector3): void {
    point.x = clamp(point.x, MIN_X, MAX_X)
    point.z = clamp(point.z, MIN_Z, MAX_Z)
    point.y = clamp(point.y, MIN_Y, MAX_Y)
  }

  function update(delta: number): void {
    const dt = Math.min(delta, 0.1)

    const lookK = 1 - Math.exp(-LOOK_SMOOTH * dt)
    yaw += (targetYaw - yaw) * lookK
    pitch += (targetPitch - pitch) * lookK
    camera.rotation.x = pitch
    camera.rotation.y = yaw
    camera.rotation.z = 0

    let inputX = moveX
    let inputZ = moveZ
    const inputLength = Math.hypot(inputX, inputZ)
    if (inputLength > 1) {
      inputX /= inputLength
      inputZ /= inputLength
    }
    const vertical = (upHeld ? 1 : 0) - (downHeld ? 1 : 0)

    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const forwardX = -sin
    const forwardZ = -cos
    const rightX = cos
    const rightZ = -sin

    desired.set(
      (forwardX * inputZ + rightX * inputX) * MOVE_SPEED,
      vertical * CLIMB_SPEED,
      (forwardZ * inputZ + rightZ * inputX) * MOVE_SPEED,
    )

    const moveK = 1 - Math.exp(-MOVE_SMOOTH * dt)
    velocity.x += (desired.x - velocity.x) * moveK
    velocity.y += (desired.y - velocity.y) * moveK
    velocity.z += (desired.z - velocity.z) * moveK

    position.x += velocity.x * dt
    position.y += velocity.y * dt
    position.z += velocity.z * dt

    clampPosition(position)
  }

  function dispose(): void {
    lookLayer.remove()
    joystick.remove()
    upButton.remove()
    downButton.remove()
  }

  return { update, dispose }
}
