import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'

const VIEW_CAPTURE_PRESETS = [
  { key: 'front', label: 'Front', yawDeg: 0 },
  { key: 'front_right', label: 'Front_Right', yawDeg: -45 },
  { key: 'right', label: 'Right', yawDeg: -90 },
  { key: 'back_right', label: 'Back_Right', yawDeg: -135 },
  { key: 'back', label: 'Back', yawDeg: 180 },
  { key: 'back_left', label: 'Back_Left', yawDeg: 135 },
  { key: 'left', label: 'Left', yawDeg: 90 },
  { key: 'front_left', label: 'Front_Left', yawDeg: 45 },
]

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
  controls.target.set(0, 0, 0)
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

const findPivotBone = (object) => {
  let bestMatch = null
  let fallbackMatch = null

  object.traverse((child) => {
    if (!child.isBone) {
      return
    }

    const lowerName = String(child.name || '').toLowerCase()
    if (!lowerName) {
      return
    }

    if (!bestMatch && (lowerName === 'hips' || lowerName.includes('hip'))) {
      bestMatch = child
      return
    }

    if (!fallbackMatch && (lowerName.includes('pelvis') || lowerName.includes('spine'))) {
      fallbackMatch = child
    }
  })

  return bestMatch || fallbackMatch
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

const MARGIN_RATIO = 0.1

const getCaptureFraming = (camera, object) => {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const fitRatio = Math.max(1 - MARGIN_RATIO * 2, 0.2)
  const safeWidth = Math.max(size.x, 0.001)
  const safeHeight = Math.max(size.y, 0.001)
  const verticalFovRad = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFovRad =
    2 * Math.atan(Math.tan(verticalFovRad / 2) * Math.max(camera.aspect, 0.001))

  const distanceForHeight = (safeHeight / fitRatio) / (2 * Math.tan(verticalFovRad / 2))
  const distanceForWidth = (safeWidth / fitRatio) / (2 * Math.tan(horizontalFovRad / 2))
  const horizontalDistance = Math.max(distanceForHeight, distanceForWidth, 1.5)

  return {
    center,
    horizontalDistance,
    verticalOffset: 0,
  }
}

export function ModelViewer({ modelUrl, resetSignal = 0, onCaptureApiReady = null }) {
  const containerRef = useRef(null)
  const controlsRef = useRef(null)
  const isCapturingSnapshotsRef = useRef(false)
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
    scene.background = null

    const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight, false)
    if (typeof renderer.setClearColor === 'function') {
      renderer.setClearColor(0x000000, 0)
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.88
    container.appendChild(renderer.domElement)

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture

    const keyLight = new THREE.DirectionalLight('#fff3e5', 1.55)
    keyLight.position.set(2.7, 3.5, 5.4)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight('#cdd9ff', 0.42)
    fillLight.position.set(-3.4, 1.9, 2.6)
    scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight('#88c8b6', 0.7)
    rimLight.position.set(-4.2, 2.1, -3.2)
    scene.add(rimLight)

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.34)
    scene.add(ambientLight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.autoRotate = false
    controls.autoRotateSpeed = 0
    controls.minDistance = 1
    controls.maxDistance = 20
    controlsRef.current = controls

    const loader = new GLTFLoader()
    const fbxLoader = new FBXLoader()
    let loadedScene = null
    let hasLoadedModel = false
    let mixer = null
    let targetSkinnedMesh = null
    let pivotBone = null
    const clock = new THREE.Clock()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const dynamicTarget = new THREE.Vector3()

    const captureEightViews = async () => {
      if (!loadedScene || !hasLoadedModel) {
        throw new Error('3D model is still loading. Try again in a moment.')
      }

      const originalTarget = controls.target.clone()
      const originalPosition = camera.position.clone()
      const originalQuaternion = camera.quaternion.clone()
      const { center: captureTarget, horizontalDistance, verticalOffset } = getCaptureFraming(
        camera,
        loadedScene,
      )
      // The generated Tripo character forward axis aligns with +X in this viewer.
      // Use +X as canonical front so capture labels map to actual views.
      const baseHorizontal = new THREE.Vector3(1, 0, 0)

      const screenshots = {}
      const originalBackground = scene.background

      isCapturingSnapshotsRef.current = true
      try {
        scene.background = null

        for (const preset of VIEW_CAPTURE_PRESETS) {
          const direction = baseHorizontal
            .clone()
            .applyAxisAngle(worldUp, THREE.MathUtils.degToRad(preset.yawDeg))
            .normalize()

          camera.position.copy(captureTarget).addScaledVector(direction, horizontalDistance)
          camera.position.y = captureTarget.y + verticalOffset
          camera.lookAt(captureTarget)
          controls.target.copy(captureTarget)
          controls.update()
          renderer.render(scene, camera)

          screenshots[preset.key] = {
            label: preset.label,
            dataUrl: renderer.domElement.toDataURL('image/png'),
          }
        }
      } finally {
        scene.background = originalBackground
        camera.position.copy(originalPosition)
        camera.quaternion.copy(originalQuaternion)
        controls.target.copy(originalTarget)
        controls.update()
        renderer.render(scene, camera)
        isCapturingSnapshotsRef.current = false
      }

      return screenshots
    }

    if (typeof onCaptureApiReady === 'function') {
      onCaptureApiReady({ captureEightViews })
    }

    loader.load(
      modelUrl,
      (gltf) => {
        loadedScene = gltf.scene
        scene.add(loadedScene)
        fitCameraToObject(camera, controls, loadedScene)
        pivotBone = findPivotBone(loadedScene)
        hasLoadedModel = true
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
      if (pivotBone && !isCapturingSnapshotsRef.current) {
        pivotBone.getWorldPosition(dynamicTarget)
        controls.target.set(dynamicTarget.x, dynamicTarget.y, dynamicTarget.z)
      }

      controls.update()
      const delta = clock.getDelta()
      if (mixer && delta > 0 && !isCapturingSnapshotsRef.current) {
        mixer.update(Math.min(delta, 0.05))
      }
      renderer.render(scene, camera)
    })

    return () => {
      if (typeof onCaptureApiReady === 'function') {
        onCaptureApiReady(null)
      }
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
  }, [modelUrl, onCaptureApiReady])

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
