import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ModelViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('mounts and disposes the Three.js viewer cleanly', async () => {
    const sceneAdd = vi.fn()
    const sceneRemove = vi.fn()
    const rendererDispose = vi.fn()
    const controlsDispose = vi.fn()
    const controlsReset = vi.fn()
    const composerAddPass = vi.fn()
    const outputPassMarker = { isOutputPass: true }

    vi.doMock('three', () => {
      class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
          this.x = x
          this.y = y
          this.z = z
        }
      }

      return {
        Scene: class {
          constructor() {
            this.background = null
          }

          add = sceneAdd
          remove = sceneRemove
        },
        Color: class {
          constructor(value) {
            this.value = value
          }
        },
        PerspectiveCamera: class {
          constructor() {
            this.position = { set: vi.fn() }
            this.near = 0
            this.far = 0
          }

          updateProjectionMatrix = vi.fn()
        },
        WebGLRenderer: class {
          constructor() {
            this.domElement = document.createElement('canvas')
          }

          setPixelRatio = vi.fn()
          setSize = vi.fn()
          setAnimationLoop = vi.fn()
          render = vi.fn()
          dispose = rendererDispose
        },
        PMREMGenerator: class {
          fromScene() {
            return { texture: 'env-texture' }
          }

          dispose = vi.fn()
        },
        DirectionalLight: class {
          constructor() {
            this.position = { set: vi.fn() }
          }
        },
        AmbientLight: class {},
        GridHelper: class {
          constructor() {
            this.material = {
              transparent: false,
              opacity: 1,
              depthWrite: true,
              dispose: vi.fn(),
            }
            this.geometry = {
              dispose: vi.fn(),
            }
            this.position = { y: 0 }
            this.visible = true
          }
        },
        Box3: class {
          constructor() {
            this.min = { y: -1 }
          }

          setFromObject() {
            return this
          }

          getSize() {
            return new Vector3(1, 2, 1)
          }

          getCenter() {
            return new Vector3(0, 0, 0)
          }
        },
        Vector3,
        Clock: class {
          getDelta() {
            return 0
          }
        },
        Skeleton: class {
          constructor(bones) {
            this.bones = bones
          }
        },
        AnimationMixer: class {
          clipAction() {
            return {
              reset: vi.fn(() => this),
              setLoop: vi.fn(() => this),
              play: vi.fn(),
            }
          }

          update = vi.fn()
          stopAllAction = vi.fn()
          uncacheRoot = vi.fn()
        },
        LoopRepeat: 'LoopRepeat',
        SRGBColorSpace: 'srgb',
        NoToneMapping: 'none',
        ACESFilmicToneMapping: 'aces',
        ReinhardToneMapping: 'reinhard',
      }
    })

    vi.doMock('three/examples/jsm/controls/OrbitControls.js', () => ({
      OrbitControls: class {
        constructor() {
          this.target = { set: vi.fn() }
          this.enableDamping = false
          this.autoRotate = false
          this.autoRotateSpeed = 0
          this.minDistance = 0
          this.maxDistance = 0
        }

        update = vi.fn()
        reset = controlsReset
        dispose = controlsDispose
      },
    }))

    vi.doMock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
      EffectComposer: class {
        addPass = composerAddPass
        setPixelRatio = vi.fn()
        setSize = vi.fn()
        render = vi.fn()
        dispose = vi.fn()
      },
    }))

    vi.doMock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
      RenderPass: class {
        constructor(_scene, camera) {
          this.camera = camera
        }
      },
    }))

    vi.doMock('three/examples/jsm/postprocessing/ShaderPass.js', () => ({
      ShaderPass: class {
        constructor(shader) {
          this.uniforms = shader.uniforms
        }
      },
    }))

    vi.doMock('three/examples/jsm/postprocessing/OutputPass.js', () => ({
      OutputPass: class {
        constructor() {
          return outputPassMarker
        }
      },
    }))

    vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        load(_url, onLoad) {
          onLoad({
            scene: {
              position: { sub: vi.fn() },
              traverse: vi.fn(),
            },
          })
        }
      },
    }))

    vi.doMock('three/examples/jsm/loaders/FBXLoader.js', () => ({
      FBXLoader: class {
        load(_url, onLoad) {
          onLoad({
            animations: [{ name: 'walking' }],
            traverse: vi.fn(),
          })
        }
      },
    }))

    vi.doMock('three/examples/jsm/utils/SkeletonUtils.js', () => ({
      retargetClip: (_target, _source, clip) => clip,
    }))

    vi.doMock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
      RoomEnvironment: class {},
    }))

    const { ModelViewer } = await import('../components/ModelViewer')
    const { unmount } = render(<ModelViewer modelUrl="/api/tripo/tasks/task-1/model?variant=pbr_model" />)

    await waitFor(() => {
      expect(sceneAdd).toHaveBeenCalled()
    })
    expect(composerAddPass).toHaveBeenCalledWith(outputPassMarker)

    unmount()

    expect(rendererDispose).toHaveBeenCalled()
    expect(controlsDispose).toHaveBeenCalled()
    expect(sceneRemove).toHaveBeenCalled()
    expect(controlsReset).not.toHaveBeenCalled()
  })
})
