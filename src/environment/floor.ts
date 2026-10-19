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

  const sandDots = new THREE.Points(
    new THREE.CircleGeometry(60, 20, 0, Math.PI * 2).toNonIndexed(),
    new THREE.PointsMaterial({
      color: 0x8b7355,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
    }),
  )
  sandDots.rotation.x = -Math.PI / 2
  sandDots.position.y = 0.02
  group.add(sandDots)

  return group
}
