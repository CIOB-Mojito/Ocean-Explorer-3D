import './style.css'
import { createWorld, handleResize, type World } from './core/scene'
import { createControls } from './core/controls'
import { createAquariumEnvironment } from './environment/aquarium'
import { loadClownfish, updateClownfish, type Clownfish } from './clownfish/clownfish'
import * as THREE from 'three'

const app = document.querySelector<HTMLElement>('#app')
if (!app) {
  throw new Error('No se encontró el elemento #app')
}

const world: World = createWorld(app)
world.scene.add(createAquariumEnvironment())

const controls = createControls(world)

let clownfish: Clownfish | null = null
loadClownfish(world.scene, '/models/pez_payaso.glb', {
  scale: 1.6,
  position: new THREE.Vector3(0, 2, 0),
  rotation: new THREE.Euler(0, Math.PI / 2, 0),
}).then((cf) => {
  clownfish = cf
  clownfish.speed = 1.0
})

const clock = new THREE.Clock()
function animate(): void {
  const delta = clock.getDelta()
  controls.update(delta)
  if (clownfish) {
    updateClownfish(clownfish, delta)
  }
  world.renderer.render(world.scene, world.camera)
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

const resize = () => handleResize(world, app)
window.addEventListener('resize', resize)
resize()
