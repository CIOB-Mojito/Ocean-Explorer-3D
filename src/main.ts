import './style.css'
import { createWorld, handleResize, type World } from './core/scene'
import { createControls } from './core/controls'
import { createAquariumEnvironment } from './environment/aquarium'
import {
  ANEMONE_SCALE,
  chooseAnemoneSetup,
  loadAnemone,
  type Anemone,
} from './environment/anemone'
import { loadClownfish, updateClownfish, type Clownfish } from './clownfish/clownfish'
import { loadSchool, updateSchool, type School } from './school/school'
import * as THREE from 'three'

const app = document.querySelector<HTMLElement>('#app')
if (!app) {
  throw new Error('No se encontró el elemento #app')
}

const world: World = createWorld(app)
world.scene.add(createAquariumEnvironment())

const controls = createControls(world)

let clownfish: Clownfish | null = null
let anemone: Anemone | null = null
let school: School | null = null

async function initCharacters(): Promise<void> {
  const setup = chooseAnemoneSetup(ANEMONE_SCALE)

  const schoolPromise = loadSchool(world.scene, '/models/pez_cardumen.glb', {
    scale: 1.2,
    obstacles: setup.obstacles,
  })
    .then((loaded) => {
      school = loaded
    })
    .catch((error) => {
      console.error('No se pudo cargar el cardumen.', error)
    })

  try {
    anemone = await loadAnemone(
      world.scene,
      '/models/anemona.glb',
      setup.placement,
      ANEMONE_SCALE,
    )
  } catch (error) {
    anemone = null
    console.warn(
      'No se pudo cargar la anémona; el pez mantiene su comportamiento original.',
      error,
    )
  }

  try {
    clownfish = await loadClownfish(world.scene, '/models/pez_payaso.glb', {
      scale: 1.6,
      position: new THREE.Vector3(0, 2, 0),
      rotation: new THREE.Euler(0, Math.PI / 2, 0),
      home: anemone ? setup.home : null,
      obstacles: anemone ? setup.obstacles : [],
    })
    clownfish.speed = 1.0
  } catch (error) {
    console.error('No se pudo cargar el pez payaso.', error)
  }

  await schoolPromise
}

void initCharacters()

const clock = new THREE.Clock()
function animate(): void {
  const delta = clock.getDelta()
  controls.update(delta)
  if (anemone) {
    anemone.update(delta)
  }
  if (clownfish) {
    updateClownfish(clownfish, delta)
  }
  if (school) {
    updateSchool(school, delta)
  }
  world.renderer.render(world.scene, world.camera)
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

const resize = () => handleResize(world, app)
window.addEventListener('resize', resize)
resize()
