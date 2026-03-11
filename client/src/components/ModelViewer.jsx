import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  DEFAULT_ANIMATED_SPRITE_DELAY_MS,
  resolveAnimatedSpriteCaptureDelayMs,
} from '../lib/spriteTiming'
import { DEFAULT_VIEWER_LOOK_SETTINGS, normalizeViewerLookSettings } from '../lib/viewerLook'

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

const ANIMATED_SPRITE_CAPTURE_FRAME_COUNT = 16
const ISOMETRIC_SPRITE_CAPTURE_PITCH_DEG = 45
const ORIGINAL_ROUGHNESS_USER_DATA_KEY = '__wwOriginalRoughness'
const LOOK_ADJUST_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: { x: 1, y: 1 } },
    contrast: { value: DEFAULT_VIEWER_LOOK_SETTINGS.contrast },
    vibrance: { value: DEFAULT_VIEWER_LOOK_SETTINGS.vibrance },
    sharpen: { value: DEFAULT_VIEWER_LOOK_SETTINGS.sharpen },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float contrast;
    uniform float vibrance;
    uniform float sharpen;
    varying vec2 vUv;

    vec3 applyVibrance(vec3 color, float amount) {
      float average = (color.r + color.g + color.b) / 3.0;
      float maxChannel = max(color.r, max(color.g, color.b));
      float influence = (maxChannel - average) * (-amount * 3.0);
      return mix(color, vec3(maxChannel), influence);
    }

    void main() {
      vec2 texel = 1.0 / max(resolution, vec2(1.0));
      vec4 baseSample = texture2D(tDiffuse, vUv);
      vec3 color = baseSample.rgb;

      if (sharpen > 0.001) {
        vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        vec3 east = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 west = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        color = color * (1.0 + 4.0 * sharpen) - (north + south + east + west) * sharpen;
      }

      color = (color - 0.5) * contrast + 0.5;
      color = applyVibrance(color, vibrance);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), baseSample.a);
    }
  `,
}

const resolveToneMapping = (value) => {
  switch (String(value || '').trim().toLowerCase()) {
    case 'aces':
      return THREE.ACESFilmicToneMapping
    case 'reinhard':
      return THREE.ReinhardToneMapping
    default:
      return THREE.NoToneMapping
  }
}

const collectRoughnessMaterials = (object) => {
  const collectedMaterials = []
  const seenMaterials = new Set()

  object.traverse((child) => {
    const candidateMaterials = Array.isArray(child.material) ? child.material : [child.material]

    candidateMaterials.forEach((material) => {
      if (!material || typeof material !== 'object' || seenMaterials.has(material)) {
        return
      }

      if (!Number.isFinite(material.roughness)) {
        return
      }

      if (!material.userData || typeof material.userData !== 'object') {
        material.userData = {}
      }

      if (!Number.isFinite(material.userData[ORIGINAL_ROUGHNESS_USER_DATA_KEY])) {
        material.userData[ORIGINAL_ROUGHNESS_USER_DATA_KEY] = material.roughness
      }

      seenMaterials.add(material)
      collectedMaterials.push(material)
    })
  })

  return collectedMaterials
}

const applyMaterialRoughnessMultiplier = (materials, roughnessMultiplier) => {
  const resolvedMultiplier = Number.isFinite(Number(roughnessMultiplier))
    ? Number(roughnessMultiplier)
    : DEFAULT_VIEWER_LOOK_SETTINGS.roughnessMultiplier

  materials.forEach((material) => {
    const baseRoughness = Number.isFinite(material?.userData?.[ORIGINAL_ROUGHNESS_USER_DATA_KEY])
      ? material.userData[ORIGINAL_ROUGHNESS_USER_DATA_KEY]
      : material.roughness

    if (!Number.isFinite(baseRoughness)) {
      return
    }

    material.roughness = Math.min(1, Math.max(0, baseRoughness * resolvedMultiplier))
    material.needsUpdate = true
  })
}

const buildFloorGrid = (object) => {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const maxHorizontalExtent = Math.max(size.x, size.z, 1)
  const gridSize = Math.max(Math.ceil(maxHorizontalExtent * 2.8), 4)
  const divisions = Math.max(Math.round(gridSize * 4), 16)
  const grid = new THREE.GridHelper(gridSize, divisions, '#67707f', '#8f98a6')

  grid.material.transparent = true
  grid.material.opacity = 0.2
  grid.material.depthWrite = false
  grid.position.y = box.min.y + 0.002

  return grid
}

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

const normalizeAnimationToken = (value) => String(value || '').trim().toLowerCase()

const ANIMATION_CLIP_NAME_HINTS = Object.freeze({
  idle: ['idle', 'stand', 'rest'],
  walk: ['walk'],
  run: ['run', 'jog', 'sprint'],
  look_around: [
    'standing_relax',
    'standing relax',
    'look_around',
    'lookaround',
    'look around',
  ],
  slash: ['slash', 'attack', 'swing'],
})

const resolveRequestedAnimationClip = (
  clips = [],
  { animationSelectionKey = 'apose', animationClipIndex = null, animationClipName = '' } = {},
) => {
  if (!Array.isArray(clips) || clips.length === 0) {
    return null
  }

  const normalizedSelectionKey = normalizeAnimationToken(animationSelectionKey)
  if (!normalizedSelectionKey || normalizedSelectionKey === 'apose') {
    return null
  }

  const normalizedClipName = normalizeAnimationToken(animationClipName)
  if (normalizedClipName) {
    const namedClip = clips.find(
      (clip) => normalizeAnimationToken(clip?.name) === normalizedClipName,
    )
    if (namedClip) {
      return namedClip
    }
  }

  if (
    Number.isInteger(animationClipIndex) &&
    animationClipIndex >= 0 &&
    animationClipIndex < clips.length
  ) {
    return clips[animationClipIndex]
  }

  const nameHints = ANIMATION_CLIP_NAME_HINTS[normalizedSelectionKey] || [normalizedSelectionKey]
  const matchedClip = clips.find((clip) => {
    const normalizedName = normalizeAnimationToken(clip?.name)
    return nameHints.some((hint) => normalizedName.includes(hint))
  })

  return matchedClip || chooseIdleLikeClip(clips)
}

const MARGIN_RATIO = 0.1

const buildBoxCorners = (box) => [
  new THREE.Vector3(box.min.x, box.min.y, box.min.z),
  new THREE.Vector3(box.min.x, box.min.y, box.max.z),
  new THREE.Vector3(box.min.x, box.max.y, box.min.z),
  new THREE.Vector3(box.min.x, box.max.y, box.max.z),
  new THREE.Vector3(box.max.x, box.min.y, box.min.z),
  new THREE.Vector3(box.max.x, box.min.y, box.max.z),
  new THREE.Vector3(box.max.x, box.max.y, box.min.z),
  new THREE.Vector3(box.max.x, box.max.y, box.max.z),
]

const getCaptureOffsetDirection = (yawDeg = 0, pitchDeg = 0) => {
  const pitchRad = THREE.MathUtils.degToRad(Math.max(Number(pitchDeg) || 0, 0))
  const horizontalDirection = new THREE.Vector3(1, 0, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(yawDeg),
  )

  return horizontalDirection
    .multiplyScalar(Math.cos(pitchRad))
    .add(new THREE.Vector3(0, 1, 0).multiplyScalar(Math.sin(pitchRad)))
    .normalize()
}

const configureOrthographicCaptureCamera = (
  camera,
  object,
  { yawDeg = 0, pitchDeg = 0, marginRatio = MARGIN_RATIO } = {},
) => {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const fitRatio = Math.max(1 - marginRatio * 2, 0.2)
  const aspect = Math.max(Number(camera.aspect) || 0, 0.001)
  const captureDistance = Math.max(size.length() * 2.2, 4)
  const captureDirection = getCaptureOffsetDirection(yawDeg, pitchDeg)

  camera.position.copy(center).addScaledVector(captureDirection, captureDistance)
  camera.up.set(0, 1, 0)
  camera.lookAt(center)
  camera.updateMatrixWorld(true)

  const corners = buildBoxCorners(box)
  let maxAbsX = 0
  let maxAbsY = 0
  let minDepth = Number.POSITIVE_INFINITY
  let maxDepth = 0

  for (const corner of corners) {
    const cameraSpacePoint = corner.clone().applyMatrix4(camera.matrixWorldInverse)
    const depth = -cameraSpacePoint.z
    maxAbsX = Math.max(maxAbsX, Math.abs(cameraSpacePoint.x))
    maxAbsY = Math.max(maxAbsY, Math.abs(cameraSpacePoint.y))
    minDepth = Math.min(minDepth, depth)
    maxDepth = Math.max(maxDepth, depth)
  }

  const halfWidthNeeded = maxAbsX / fitRatio
  const halfHeightNeeded = maxAbsY / fitRatio
  const halfHeight = Math.max(halfHeightNeeded, halfWidthNeeded / aspect, 0.001)
  const halfWidth = halfHeight * aspect
  const depthPadding = Math.max(size.length() * 0.5, 1)

  camera.left = -halfWidth
  camera.right = halfWidth
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.near = Math.max(0.01, minDepth - depthPadding)
  camera.far = Math.max(camera.near + 1, maxDepth + depthPadding)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  return center
}

export function ModelViewer({
  modelUrl,
  animationSelectionKey = 'apose',
  animationClipIndex = null,
  animationClipName = '',
  lookSettings = DEFAULT_VIEWER_LOOK_SETTINGS,
  resetSignal = 0,
  onCaptureApiReady = null,
}) {
  const containerRef = useRef(null)
  const controlsRef = useRef(null)
  const lookRuntimeRef = useRef(null)
  const latestLookSettingsRef = useRef(normalizeViewerLookSettings(lookSettings))
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
    const resolvedLookSettings = normalizeViewerLookSettings(lookSettings)
    latestLookSettingsRef.current = resolvedLookSettings

    const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight, false)
    if (typeof renderer.setClearColor === 'function') {
      renderer.setClearColor(0x000000, 0)
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = resolveToneMapping(resolvedLookSettings.toneMapping)
    renderer.toneMappingExposure = resolvedLookSettings.exposure
    container.appendChild(renderer.domElement)

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = resolvedLookSettings.environmentIntensity

    // Keep the viewer close to the source renders instead of a stylized studio relight.
    const keyLight = new THREE.DirectionalLight('#ffffff', resolvedLookSettings.keyLightIntensity)
    keyLight.position.set(2.7, 3.5, 5.4)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight('#ffffff', resolvedLookSettings.fillLightIntensity)
    fillLight.position.set(-3.4, 1.9, 2.6)
    scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight('#ffffff', resolvedLookSettings.rimLightIntensity)
    rimLight.position.set(-4.2, 2.1, -3.2)
    scene.add(rimLight)

    const ambientLight = new THREE.AmbientLight('#ffffff', resolvedLookSettings.ambientLightIntensity)
    scene.add(ambientLight)
    const composer = new EffectComposer(renderer)
    if (typeof composer.setPixelRatio === 'function') {
      composer.setPixelRatio(window.devicePixelRatio)
    }
    composer.setSize(container.clientWidth, container.clientHeight)
    const renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)
    const lookPass = new ShaderPass({
      ...LOOK_ADJUST_SHADER,
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: { x: 1, y: 1 } },
        contrast: { value: DEFAULT_VIEWER_LOOK_SETTINGS.contrast },
        vibrance: { value: DEFAULT_VIEWER_LOOK_SETTINGS.vibrance },
        sharpen: { value: DEFAULT_VIEWER_LOOK_SETTINGS.sharpen },
      },
    })
    lookPass.uniforms.contrast.value = resolvedLookSettings.contrast
    lookPass.uniforms.vibrance.value = resolvedLookSettings.vibrance
    lookPass.uniforms.sharpen.value = resolvedLookSettings.sharpen
    lookPass.uniforms.resolution.value = {
      x: container.clientWidth || 1,
      y: container.clientHeight || 1,
    }
    composer.addPass(lookPass)
    composer.addPass(new OutputPass())
    lookRuntimeRef.current = {
      renderer,
      scene,
      keyLight,
      fillLight,
      rimLight,
      ambientLight,
      lookPass,
      roughnessMaterials: [],
    }

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
    let didFinishLoading = false
    let loadErrorMessage = ''
    let mixer = null
    let floorGrid = null
    let targetSkinnedMesh = null
    let activeAnimationDuration = 0
    const clock = new THREE.Clock()

    const renderScene = (renderCamera = camera) => {
      renderPass.camera = renderCamera
      composer.render()
    }

    const captureEightViews = async () => {
      if (!loadedScene || !hasLoadedModel) {
        throw new Error('3D model is still loading. Try again in a moment.')
      }

      const screenshots = {}
      const originalBackground = scene.background
      const originalGridVisibility = floorGrid?.visible ?? false
      const captureCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
      captureCamera.aspect = container.clientWidth / Math.max(container.clientHeight, 1)

      isCapturingSnapshotsRef.current = true
      try {
        scene.background = null
        if (floorGrid) {
          floorGrid.visible = false
        }

        for (const preset of VIEW_CAPTURE_PRESETS) {
          configureOrthographicCaptureCamera(captureCamera, loadedScene, {
            yawDeg: preset.yawDeg,
            pitchDeg: ISOMETRIC_SPRITE_CAPTURE_PITCH_DEG,
          })
          renderScene(captureCamera)

          screenshots[preset.key] = {
            label: preset.label,
            dataUrl: renderer.domElement.toDataURL('image/png'),
          }
        }
      } finally {
        scene.background = originalBackground
        if (floorGrid) {
          floorGrid.visible = originalGridVisibility
        }
        renderScene(camera)
        isCapturingSnapshotsRef.current = false
      }

      return screenshots
    }

    const captureAnimatedSpriteDirections = async ({
      frameCount = ANIMATED_SPRITE_CAPTURE_FRAME_COUNT,
    } = {}) => {
      if (!loadedScene || !hasLoadedModel) {
        throw new Error('3D model is still loading. Try again in a moment.')
      }

      if (!mixer || activeAnimationDuration <= 0) {
        throw new Error('Animated sprite capture requires a loaded animation.')
      }

      const resolvedFrameCount = Math.max(Math.round(Number(frameCount) || 0), 2)
      const resolvedDelayMs = resolveAnimatedSpriteCaptureDelayMs(
        activeAnimationDuration,
        resolvedFrameCount,
        DEFAULT_ANIMATED_SPRITE_DELAY_MS,
        animationSelectionKey,
      )
      const originalBackground = scene.background
      const originalGridVisibility = floorGrid?.visible ?? false
      const originalMixerTime = mixer.time
      const sprites = {}
      const captureCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
      captureCamera.aspect = container.clientWidth / Math.max(container.clientHeight, 1)

      isCapturingSnapshotsRef.current = true
      try {
        scene.background = null
        if (floorGrid) {
          floorGrid.visible = false
        }

        for (const preset of VIEW_CAPTURE_PRESETS) {
          configureOrthographicCaptureCamera(captureCamera, loadedScene, {
            yawDeg: preset.yawDeg,
            pitchDeg: ISOMETRIC_SPRITE_CAPTURE_PITCH_DEG,
          })

          const frameDataUrls = []
          for (let frameIndex = 0; frameIndex < resolvedFrameCount; frameIndex += 1) {
            const normalizedProgress = frameIndex / resolvedFrameCount
            mixer.setTime(activeAnimationDuration * normalizedProgress)
            renderScene(captureCamera)
            frameDataUrls.push(renderer.domElement.toDataURL('image/png'))
          }

          sprites[preset.key] = {
            label: preset.label,
            frameDataUrls,
            delayMs: resolvedDelayMs,
          }
        }
      } finally {
        mixer.setTime(originalMixerTime)
        scene.background = originalBackground
        if (floorGrid) {
          floorGrid.visible = originalGridVisibility
        }
        renderScene(camera)
        isCapturingSnapshotsRef.current = false
      }

      return sprites
    }

    const waitUntilReady = ({ timeoutMs = 20000 } = {}) =>
      new Promise((resolve, reject) => {
        const startedAt = Date.now()

        const checkReadiness = () => {
          if (loadErrorMessage) {
            reject(new Error(loadErrorMessage))
            return
          }

          if (hasLoadedModel && didFinishLoading) {
            resolve({
              modelUrl,
              animationSelectionKey,
            })
            return
          }

          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error('3D viewer did not finish loading in time.'))
            return
          }

          window.setTimeout(checkReadiness, 50)
        }

        checkReadiness()
      })

    if (typeof onCaptureApiReady === 'function') {
      onCaptureApiReady({
        captureEightViews,
        captureAnimatedSpriteDirections,
        waitUntilReady,
        getCurrentModelUrl: () => modelUrl,
        getCurrentAnimationSelection: () => animationSelectionKey,
      })
    }

    loader.load(
      modelUrl,
      (gltf) => {
        loadedScene = gltf.scene
        scene.add(loadedScene)
        const roughnessMaterials = collectRoughnessMaterials(loadedScene)
        applyMaterialRoughnessMultiplier(
          roughnessMaterials,
          latestLookSettingsRef.current.roughnessMultiplier,
        )
        if (lookRuntimeRef.current) {
          lookRuntimeRef.current.roughnessMaterials = roughnessMaterials
        }
        fitCameraToObject(camera, controls, loadedScene)
        floorGrid = buildFloorGrid(loadedScene)
        scene.add(floorGrid)
        hasLoadedModel = true
        targetSkinnedMesh = findFirstSkinnedMesh(loadedScene)
        const embeddedClip = resolveRequestedAnimationClip(gltf.animations || [], {
          animationSelectionKey,
          animationClipIndex,
          animationClipName,
        })

        if (embeddedClip) {
          activeAnimationDuration = embeddedClip.duration || 0
          mixer = new THREE.AnimationMixer(loadedScene)
          const action = mixer.clipAction(embeddedClip)
          action.reset()
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.play()
          didFinishLoading = true
          setIsLoading(false)
          return
        }

        if (targetSkinnedMesh && normalizeAnimationToken(animationSelectionKey) !== 'apose') {
          fbxLoader.load(
            '/Walking.fbx',
            (fbx) => {
              const sourceClip = fbx.animations?.[0]
              if (!sourceClip) {
                didFinishLoading = true
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
              activeAnimationDuration = clipToPlay?.duration || sourceClip?.duration || 0
              const action = mixer.clipAction(clipToPlay, targetSkinnedMesh)
              action.reset()
              action.setLoop(THREE.LoopRepeat, Infinity)
              action.play()
              didFinishLoading = true
              setIsLoading(false)
            },
            undefined,
            () => {
              didFinishLoading = true
              setIsLoading(false)
            },
          )
          return
        }

        didFinishLoading = true
        setIsLoading(false)
      },
      undefined,
      (error) => {
        loadErrorMessage = error?.message || 'Failed to load the 3D preview.'
        setIsLoading(false)
        setViewerError(loadErrorMessage)
      },
    )

    const resizeObserver = new ResizeObserver(() => {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight, false)
      composer.setSize(container.clientWidth, container.clientHeight)
      lookPass.uniforms.resolution.value = {
        x: container.clientWidth || 1,
        y: container.clientHeight || 1,
      }
    })

    resizeObserver.observe(container)

    renderer.setAnimationLoop(() => {
      controls.update()
      const delta = clock.getDelta()
      if (mixer && delta > 0 && !isCapturingSnapshotsRef.current) {
        mixer.update(Math.min(delta, 0.05))
      }
      renderScene(camera)
    })

    return () => {
      if (typeof onCaptureApiReady === 'function') {
        onCaptureApiReady(null)
      }
      lookRuntimeRef.current = null
      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      if (typeof composer.dispose === 'function') {
        composer.dispose()
      }
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
      if (floorGrid) {
        scene.remove(floorGrid)
        floorGrid.geometry.dispose()
        floorGrid.material.dispose()
      }
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [
    animationClipIndex,
    animationClipName,
    animationSelectionKey,
    modelUrl,
    onCaptureApiReady,
  ])

  useEffect(() => {
    const runtime = lookRuntimeRef.current
    if (!runtime) {
      return
    }

    const resolvedLookSettings = normalizeViewerLookSettings(lookSettings)
    latestLookSettingsRef.current = resolvedLookSettings
    runtime.renderer.toneMapping = resolveToneMapping(resolvedLookSettings.toneMapping)
    runtime.renderer.toneMappingExposure = resolvedLookSettings.exposure
    runtime.scene.environmentIntensity = resolvedLookSettings.environmentIntensity
    runtime.keyLight.intensity = resolvedLookSettings.keyLightIntensity
    runtime.fillLight.intensity = resolvedLookSettings.fillLightIntensity
    runtime.rimLight.intensity = resolvedLookSettings.rimLightIntensity
    runtime.ambientLight.intensity = resolvedLookSettings.ambientLightIntensity
    applyMaterialRoughnessMultiplier(
      runtime.roughnessMaterials || [],
      resolvedLookSettings.roughnessMultiplier,
    )
    runtime.lookPass.uniforms.contrast.value = resolvedLookSettings.contrast
    runtime.lookPass.uniforms.vibrance.value = resolvedLookSettings.vibrance
    runtime.lookPass.uniforms.sharpen.value = resolvedLookSettings.sharpen
  }, [lookSettings])

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
