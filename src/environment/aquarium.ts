import * as THREE from 'three'
import { createFloor } from './floor'

export function createAquariumEnvironment(): THREE.Group {
  const env = new THREE.Group()
  env.add(createFloor())
  return env
}
