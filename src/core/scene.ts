import * as THREE from 'three'

export interface World {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
}

export function createWorld(container: HTMLElement): World {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2e93ad)
  scene.fog = new THREE.FogExp2(0x2e93ad, 0.022)

  const camera = new THREE.PerspectiveCamera(
    55,
    container.clientWidth / container.clientHeight,
    0.1,
    200,
  )
  camera.position.set(0, 4, 12)
  camera.lookAt(0, 1, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  container.appendChild(renderer.domElement)

  addLights(scene)

  return { scene, camera, renderer }
}

function addLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0x78aed6, 1.0)
  scene.add(ambient)

  const hemisphere = new THREE.HemisphereLight(0xa8e2ff, 0x6e7a4e, 0.75)
  scene.add(hemisphere)

  const directional = new THREE.DirectionalLight(0xeaf6ff, 1.3)
  directional.position.set(4, 12, 6)
  scene.add(directional)
}

export function handleResize(world: World, container: HTMLElement): void {
  const width = container.clientWidth
  const height = container.clientHeight
  world.camera.aspect = width / height
  world.camera.updateProjectionMatrix()
  world.renderer.setSize(width, height)
}
