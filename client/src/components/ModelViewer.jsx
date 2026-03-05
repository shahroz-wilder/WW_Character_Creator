import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'

const fitCameraToObject = (camera, controls, object) => {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z)
  const distance = Math.max(maxDimension * 1.8, 2.25)

  object.position.sub(center)
  camera.position.set(distance * 0.75, distance * 0.55, distance)
  camera.near = 0.01
  camera.far = distance * 10
  camera.updateProjectionMatrix()
  controls.target.set(0, size.y * 0.15, 0)
  controls.update()
}

const disposeSceneObject = (object) => {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose()
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose())
    } else if (child.material) {
      child.material.dispose()
    }
  })
}

const findFirstSkinnedMesh = (object) => {
  let skinnedMesh = null
  object.traverse((child) => {
    if (!skinnedMesh && child.isSkinnedMesh && child.skeleton) {
      skinnedMesh = child
    }
  })
  return skinnedMesh
}

const findSourceSkeleton = (object) => {
  const bones = []
  object.traverse((child) => {
    if (child.isBone) {
      bones.push(child)
    }
  })

  if (!bones.length) {
    return null
  }

  return new THREE.Skeleton(bones)
}

const chooseIdleLikeClip = (clips = []) => {
  if (!Array.isArray(clips) || clips.length === 0) {
    return null
  }

  const idleLikeClip =
    clips.find((clip) => /idle/i.test(clip?.name || '')) ||
    clips.find((clip) => /stand|rest/i.test(clip?.name || ''))

  return idleLikeClip || clips[0]
}

export function ModelViewer({ modelUrl, resetSignal = 0 }) {
  const containerRef = useRef(null)
  const controlsRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewerError, setViewerError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !modelUrl) {
      return undefined
    }

    setIsLoading(true)
    setViewerError('')

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#d7dbd6')

    const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    container.appendChild(renderer.domElement)

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture

    const keyLight = new THREE.DirectionalLight('#fff1df', 2.4)
    keyLight.position.set(3, 4, 6)
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight('#8fcfba', 1.2)
    rimLight.position.set(-4, 2, -3)
    scene.add(rimLight)

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.65)
    scene.add(ambientLight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotate = false
    controls.autoRotateSpeed = 0
    controls.minDistance = 1
    controls.maxDistance = 20
    controlsRef.current = controls

    const loader = new GLTFLoader()
    const fbxLoader = new FBXLoader()
    let loadedScene = null
    let mixer = null
    let targetSkinnedMesh = null
    const clock = new THREE.Clock()

    loader.load(
      modelUrl,
      (gltf) => {
        loadedScene = gltf.scene
        scene.add(loadedScene)
        fitCameraToObject(camera, controls, loadedScene)
        targetSkinnedMesh = findFirstSkinnedMesh(loadedScene)
        const embeddedClip = chooseIdleLikeClip(gltf.animations || [])

        if (embeddedClip) {
          mixer = new THREE.AnimationMixer(loadedScene)
          const action = mixer.clipAction(embeddedClip)
          action.reset()
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.play()
          setIsLoading(false)
          return
        }

        if (targetSkinnedMesh) {
          fbxLoader.load(
            '/Walking.fbx',
            (fbx) => {
              const sourceClip = fbx.animations?.[0]
              if (!sourceClip) {
                setIsLoading(false)
                return
              }

              let clipToPlay = sourceClip
              const sourceSkeleton = findSourceSkeleton(fbx)

              if (sourceSkeleton) {
                try {
                  clipToPlay = retargetClip(targetSkinnedMesh, sourceSkeleton, sourceClip, {
                    getBoneName: (bone) => bone.name,
                    hip: 'Hips',
                    preserveBoneMatrix: false,
                    preserveBonePositions: true,
                    useTargetMatrix: true,
                    useFirstFramePosition: true,
                  })
                } catch (_error) {
                  // Fall back to the original clip if retargeting fails.
                }
              }

              mixer = new THREE.AnimationMixer(loadedScene)
              const action = mixer.clipAction(clipToPlay, targetSkinnedMesh)
              action.reset()
              action.setLoop(THREE.LoopRepeat, Infinity)
              action.play()
              setIsLoading(false)
            },
            undefined,
            () => {
              setIsLoading(false)
            },
          )
          return
        }

        setIsLoading(false)
      },
      undefined,
      (error) => {
        setIsLoading(false)
        setViewerError(error?.message || 'Failed to load the 3D preview.')
      },
    )

    const resizeObserver = new ResizeObserver(() => {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight, false)
    })

    resizeObserver.observe(container)

    renderer.setAnimationLoop(() => {
      controls.update()
      const delta = clock.getDelta()
      if (mixer && delta > 0) {
        mixer.update(Math.min(delta, 0.05))
      }
      renderer.render(scene, camera)
    })

    return () => {
      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      pmremGenerator.dispose()
      if (mixer) {
        mixer.stopAllAction()
        if (loadedScene) {
          mixer.uncacheRoot(loadedScene)
        }
      }
      if (loadedScene) {
        disposeSceneObject(loadedScene)
      }
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [modelUrl])

  useEffect(() => {
    if (resetSignal > 0 && controlsRef.current) {
      controlsRef.current.reset()
    }
  }, [resetSignal])

  return (
    <div className="viewer-shell">
      <div ref={containerRef} className="viewer-canvas" />
      {viewerError ? <p className="error-copy">{viewerError}</p> : null}
    </div>
  )
}
