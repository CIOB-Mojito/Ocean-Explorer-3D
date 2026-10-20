import * as THREE from 'three'

export function createFloor(): THREE.Group {
  const group = new THREE.Group()
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60, 40, 40),
    new THREE.MeshStandardMaterial({
      color: 0x7d6a45,
      roughness: 0.9,
      flatShading: true,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = false
  group.add(floor)

  return group
}
