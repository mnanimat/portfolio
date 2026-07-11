"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const EXPLOSION_DURATION = 1.833333;
const MODEL_URL = "/models/moto-mn-optimized.glb";
const VIEWER_BACKGROUND = 0x03050d;

export type MotoViewPreset = "front" | "back" | "side" | "top" | "iso";

export interface MotoViewerProgress {
  bytesLoaded: number;
  bytesTotal: number;
  itemsLoaded: number;
  itemsTotal: number;
  percent: number;
}

export interface MotoViewerStats {
  pieceCount: number;
  animationCount: number;
  duration: number;
}

export interface MotoViewerProps {
  className?: string;
  modelUrl?: string;
  initialExplosion?: number;
  onLoad?: (stats: MotoViewerStats) => void;
  onProgress?: (progress: MotoViewerProgress) => void;
  onPartSelect?: (partName: string | null) => void;
}

type ViewerMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;
type MaterialSet = THREE.Material | THREE.Material[];

interface MeshMaterialRecord {
  base: MaterialSet;
  highlight?: MaterialSet;
}

interface HotspotRecord {
  anchor: ViewerMesh;
  localPosition: THREE.Vector3;
  sprite: THREE.Sprite;
  phase: number;
}

interface CyberEnvironment {
  grid: THREE.GridHelper;
  platform: THREE.Mesh;
  rings: THREE.Group;
  particles: THREE.Points;
  cyanLight: THREE.PointLight;
  magentaLight: THREE.PointLight;
}

interface ViewerRuntime {
  disposed: boolean;
  frameId: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  environment: CyberEnvironment;
  modelRoot: THREE.Group | null;
  mixer: THREE.AnimationMixer | null;
  actions: THREE.AnimationAction[];
  meshes: ViewerMesh[];
  materials: Map<ViewerMesh, MeshMaterialRecord>;
  sourceMaterials: Set<THREE.Material>;
  selectedMesh: ViewerMesh | null;
  center: THREE.Vector3;
  modelSize: THREE.Vector3;
  cameraDistance: number;
  hotspotRoot: THREE.Group;
  hotspots: HotspotRecord[];
  hotspotTexture: THREE.CanvasTexture | null;
  hotspotMaterial: THREE.SpriteMaterial | null;
  hotspotSize: number;
  tempVector: THREE.Vector3;
}

interface ViewerCallbacks {
  onLoad?: MotoViewerProps["onLoad"];
  onProgress?: MotoViewerProps["onProgress"];
  onPartSelect?: MotoViewerProps["onPartSelect"];
}

const VIEW_PRESETS: ReadonlyArray<{
  id: MotoViewPreset;
  label: string;
  shortcut: string;
}> = [
  { id: "front", label: "Frente", shortcut: "1" },
  { id: "back", label: "Traseira", shortcut: "2" },
  { id: "side", label: "Lateral", shortcut: "3" },
  { id: "top", label: "Superior", shortcut: "4" },
  { id: "iso", label: "Isométrica", shortcut: "5" },
];

const INITIAL_PROGRESS: MotoViewerProgress = {
  bytesLoaded: 0,
  bytesTotal: 0,
  itemsLoaded: 0,
  itemsTotal: 0,
  percent: 0,
};

function clamp01(value: number) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function materialList(material: MaterialSet): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function cloneMaterialSet(material: MaterialSet): MaterialSet {
  return Array.isArray(material)
    ? material.map((item) => item.clone())
    : material.clone();
}

function setMaterialWireframe(material: MaterialSet, enabled: boolean) {
  for (const item of materialList(material)) {
    if ("wireframe" in item) {
      (item as THREE.Material & { wireframe: boolean }).wireframe = enabled;
      item.needsUpdate = true;
    }
  }
}

function setHighlightStyle(material: MaterialSet) {
  const cyan = new THREE.Color(0x24f7ff);
  const magenta = new THREE.Color(0xff2bd6);

  for (const item of materialList(material)) {
    const candidate = item as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };

    if (candidate.color instanceof THREE.Color) {
      candidate.color.lerp(cyan, 0.32);
    }
    if (candidate.emissive instanceof THREE.Color) {
      candidate.emissive.copy(cyan).lerp(magenta, 0.16);
      candidate.emissiveIntensity = Math.max(
        candidate.emissiveIntensity ?? 0,
        1.15,
      );
    }
    item.needsUpdate = true;
  }
}

function disposeMaterialSet(material: MaterialSet, disposeTextures = false) {
  for (const item of materialList(material)) {
    if (disposeTextures) {
      for (const value of Object.values(item)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
    }
    item.dispose();
  }
}

function clearRuntimeSelection(runtime: ViewerRuntime) {
  if (!runtime.selectedMesh) return;

  const record = runtime.materials.get(runtime.selectedMesh);
  if (record?.highlight) {
    runtime.selectedMesh.material = record.base;
    disposeMaterialSet(record.highlight);
    record.highlight = undefined;
  }
  runtime.selectedMesh = null;
}

function selectRuntimeMesh(runtime: ViewerRuntime, mesh: ViewerMesh | null) {
  clearRuntimeSelection(runtime);
  if (!mesh) return;

  const record = runtime.materials.get(mesh);
  if (!record) return;

  // The highlight always gets its own material instance. This keeps shared GLB
  // materials (and the other pieces that use them) untouched.
  const highlight = cloneMaterialSet(record.base);
  setHighlightStyle(highlight);
  record.highlight = highlight;
  mesh.material = highlight;
  runtime.selectedMesh = mesh;
}

function formatPieceName(mesh: ViewerMesh, root: THREE.Object3D | null) {
  const genericName = /^(mesh|object|node|primitive|cube|cylinder|sphere|plane)([._\s-]*\d+)?$/i;
  let current: THREE.Object3D | null = mesh;

  while (current && current !== root) {
    const candidate = current.name.trim();
    if (candidate && !genericName.test(candidate)) {
      return candidate
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    current = current.parent;
  }

  const fallbackIndex = Math.max(0, mesh.id % 1000);
  return `Peça ${String(fallbackIndex).padStart(3, "0")}`;
}

function sampleAnimations(runtime: ViewerRuntime, normalizedTime: number) {
  if (!runtime.mixer || runtime.actions.length === 0) return;

  const time = clamp01(normalizedTime) * EXPLOSION_DURATION;
  for (const action of runtime.actions) {
    action.time = Math.min(time, action.getClip().duration);
  }
  runtime.mixer.update(0);
  runtime.modelRoot?.updateMatrixWorld(true);
}

function viewDirection(view: MotoViewPreset) {
  switch (view) {
    case "front":
      return new THREE.Vector3(0, 0, 1);
    case "back":
      return new THREE.Vector3(0, 0, -1);
    case "side":
      return new THREE.Vector3(1, 0, 0);
    case "top":
      return new THREE.Vector3(0, 1, 0);
    case "iso":
    default:
      return new THREE.Vector3(1, 0.62, 1).normalize();
  }
}

function applyCameraView(runtime: ViewerRuntime, view: MotoViewPreset) {
  const direction = viewDirection(view);
  runtime.camera.up.set(0, 1, 0);
  if (view === "top") runtime.camera.up.set(0, 0, -1);

  runtime.camera.position
    .copy(runtime.center)
    .addScaledVector(direction, runtime.cameraDistance);
  runtime.controls.target.copy(runtime.center);
  runtime.camera.lookAt(runtime.center);
  runtime.camera.updateProjectionMatrix();
  runtime.controls.update();
}

function fitCameraToBounds(runtime: ViewerRuntime, bounds: THREE.Box3) {
  const size = bounds.getSize(runtime.modelSize);
  bounds.getCenter(runtime.center);

  const safeHeight = Math.max(size.y, 0.01);
  const safeWidth = Math.max(size.x, size.z, 0.01);
  const verticalFov = THREE.MathUtils.degToRad(runtime.camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * runtime.camera.aspect);
  const heightDistance = safeHeight / (2 * Math.tan(verticalFov / 2));
  const widthDistance = safeWidth / (2 * Math.tan(horizontalFov / 2));
  const diagonal = Math.max(size.length(), 0.01);

  runtime.cameraDistance = Math.max(heightDistance, widthDistance, diagonal * 0.52) * 1.32;
  runtime.camera.near = Math.max(runtime.cameraDistance / 1000, 0.001);
  runtime.camera.far = Math.max(runtime.cameraDistance * 80, 100);
  runtime.controls.minDistance = runtime.cameraDistance * 0.16;
  runtime.controls.maxDistance = runtime.cameraDistance * 5;
  runtime.camera.updateProjectionMatrix();
}

function setGridOpacity(grid: THREE.GridHelper, opacity: number) {
  const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of materials) {
    material.transparent = true;
    material.opacity = opacity;
    material.depthWrite = false;
  }
}

function createCyberEnvironment(scene: THREE.Scene): CyberEnvironment {
  const grid = new THREE.GridHelper(20, 40, 0x16e5ff, 0x222a58);
  setGridOpacity(grid, 0.38);
  scene.add(grid);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.04, 0.05, 96),
    new THREE.MeshStandardMaterial({
      color: 0x080d1c,
      metalness: 0.82,
      roughness: 0.28,
      emissive: 0x07182b,
      emissiveIntensity: 0.8,
    }),
  );
  scene.add(platform);

  const rings = new THREE.Group();
  const ringGeometry = new THREE.RingGeometry(0.91, 1, 128);
  const cyanRing = new THREE.Mesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x1be9ff,
      transparent: true,
      opacity: 0.66,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  cyanRing.rotation.x = -Math.PI / 2;
  const magentaRing = cyanRing.clone();
  magentaRing.material = new THREE.MeshBasicMaterial({
    color: 0xff2ccf,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  magentaRing.scale.setScalar(1.18);
  rings.add(cyanRing, magentaRing);
  scene.add(rings);

  let seed = 0x1a2b3c4d;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const positions = new Float32Array(360 * 3);
  const colors = new Float32Array(360 * 3);
  const cyan = new THREE.Color(0x23eaff);
  const magenta = new THREE.Color(0xff2dcf);
  for (let index = 0; index < 360; index += 1) {
    positions[index * 3] = (random() - 0.5) * 20;
    positions[index * 3 + 1] = random() * 10;
    positions[index * 3 + 2] = (random() - 0.5) * 20;
    const color = random() > 0.72 ? magenta : cyan;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      size: 0.025,
      transparent: true,
      opacity: 0.58,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(particles);

  scene.add(new THREE.HemisphereLight(0x9ccfff, 0x11091f, 1.45));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const cyanLight = new THREE.PointLight(0x11eaff, 14, 30, 1.6);
  const magentaLight = new THREE.PointLight(0xff1fcf, 11, 30, 1.7);
  scene.add(cyanLight, magentaLight);

  return { grid, platform, rings, particles, cyanLight, magentaLight };
}

function fitEnvironmentToModel(
  runtime: ViewerRuntime,
  baseBounds: THREE.Box3,
) {
  const size = baseBounds.getSize(new THREE.Vector3());
  const center = baseBounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
  const radius = Math.max(size.x, size.z, maxDimension * 0.45) * 0.78;
  const floorY = baseBounds.min.y - maxDimension * 0.025;

  runtime.environment.platform.position.set(center.x, floorY, center.z);
  runtime.environment.platform.scale.set(radius, maxDimension, radius);
  runtime.environment.rings.position.set(center.x, floorY + maxDimension * 0.027, center.z);
  runtime.environment.rings.scale.setScalar(radius * 0.86);
  runtime.environment.grid.position.set(center.x, floorY, center.z);
  runtime.environment.grid.scale.setScalar(Math.max(maxDimension * 0.22, 0.05));
  runtime.environment.particles.position.copy(center);
  runtime.environment.particles.scale.setScalar(maxDimension * 0.22);
  runtime.environment.cyanLight.position.set(
    center.x + maxDimension * 1.2,
    center.y + maxDimension * 0.45,
    center.z + maxDimension * 0.9,
  );
  runtime.environment.magentaLight.position.set(
    center.x - maxDimension * 1.05,
    center.y + maxDimension * 0.2,
    center.z - maxDimension * 0.75,
  );

  if (runtime.scene.fog instanceof THREE.FogExp2) {
    runtime.scene.fog.density = 0.055 / maxDimension;
  }
}

function createHotspotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");

  if (context) {
    const glow = context.createRadialGradient(48, 48, 5, 48, 48, 46);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.15, "rgba(35,239,255,1)");
    glow.addColorStop(0.48, "rgba(35,239,255,.42)");
    glow.addColorStop(1, "rgba(35,239,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 96, 96);
    context.strokeStyle = "rgba(255,255,255,.94)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(48, 48, 15, 0, Math.PI * 2);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addHotspots(runtime: ViewerRuntime) {
  if (!runtime.modelRoot || runtime.meshes.length === 0) return;

  runtime.modelRoot.updateMatrixWorld(true);
  const candidates = runtime.meshes
    .map((mesh) => {
      const bounds = new THREE.Box3().setFromObject(mesh);
      const size = bounds.getSize(new THREE.Vector3());
      return {
        mesh,
        bounds,
        volume: Math.max(size.x * size.y * size.z, 0),
      };
    })
    .filter((candidate) => candidate.volume > 0)
    .sort((left, right) => right.volume - left.volume)
    .slice(0, 10);

  runtime.hotspotTexture = createHotspotTexture();
  runtime.hotspotMaterial = new THREE.SpriteMaterial({
    map: runtime.hotspotTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  candidates.forEach((candidate, index) => {
    const worldCenter = candidate.bounds.getCenter(new THREE.Vector3());
    const localPosition = candidate.mesh.worldToLocal(worldCenter.clone());
    const sprite = new THREE.Sprite(runtime.hotspotMaterial ?? undefined);
    sprite.name = `Hotspot: ${formatPieceName(candidate.mesh, runtime.modelRoot)}`;
    sprite.renderOrder = 20;
    sprite.scale.setScalar(runtime.hotspotSize);
    runtime.hotspotRoot.add(sprite);
    runtime.hotspots.push({
      anchor: candidate.mesh,
      localPosition,
      sprite,
      phase: index * 0.73,
    });
  });
}

function updateHotspots(runtime: ViewerRuntime, elapsedTime: number) {
  if (!runtime.hotspotRoot.visible) return;

  for (const hotspot of runtime.hotspots) {
    runtime.tempVector.copy(hotspot.localPosition);
    hotspot.anchor.localToWorld(runtime.tempVector);
    hotspot.sprite.position.copy(runtime.tempVector);
    const pulse = 1 + Math.sin(elapsedTime * 2.7 + hotspot.phase) * 0.1;
    hotspot.sprite.scale.setScalar(runtime.hotspotSize * pulse);
  }
}

function disposeRuntimeScene(runtime: ViewerRuntime) {
  clearRuntimeSelection(runtime);
  runtime.mixer?.stopAllAction();
  if (runtime.modelRoot && runtime.mixer) {
    runtime.mixer.uncacheRoot(runtime.modelRoot);
  }

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  runtime.scene.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: MaterialSet;
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (renderable.material) {
      for (const material of materialList(renderable.material)) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
  });
  for (const sourceMaterial of runtime.sourceMaterials) {
    materials.add(sourceMaterial);
    for (const value of Object.values(sourceMaterial)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  if (runtime.hotspotTexture) textures.add(runtime.hotspotTexture);
  if (runtime.hotspotMaterial) materials.add(runtime.hotspotMaterial);

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : megabytes.toFixed(0)} MB`;
}

export default function MotoViewer({
  className = "",
  modelUrl = MODEL_URL,
  initialExplosion = 0,
  onLoad,
  onProgress,
  onPartSelect,
}: MotoViewerProps) {
  const viewerId = useId();
  const sliderId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const callbackRef = useRef<ViewerCallbacks>({ onLoad, onProgress, onPartSelect });
  const normalizedInitialExplosion = clamp01(initialExplosion);
  const explosionRef = useRef(normalizedInitialExplosion);
  const playingRef = useRef(false);
  const playbackDirectionRef = useRef<1 | -1>(1);
  const wireframeRef = useRef(false);
  const hotspotsVisibleRef = useRef(true);
  const autoRotateRef = useRef(false);
  const activeViewRef = useRef<MotoViewPreset>("iso");

  const [explosion, setExplosion] = useState(normalizedInitialExplosion);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [hotspotsVisible, setHotspotsVisible] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeView, setActiveView] = useState<MotoViewPreset>("iso");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MotoViewerProgress>(INITIAL_PROGRESS);
  const [stats, setStats] = useState<MotoViewerStats>({
    pieceCount: 0,
    animationCount: 0,
    duration: EXPLOSION_DURATION,
  });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiNotice, setUiNotice] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = { onLoad, onProgress, onPartSelect };
  }, [onLoad, onProgress, onPartSelect]);

  const publishPartSelection = useCallback((partName: string | null) => {
    setSelectedPart(partName);
    callbackRef.current.onPartSelect?.(partName);
  }, []);

  const setExplosionValue = useCallback((value: number) => {
    const nextValue = clamp01(value);
    explosionRef.current = nextValue;
    setExplosion(nextValue);
    const runtime = runtimeRef.current;
    if (runtime) sampleAnimations(runtime, nextValue);
  }, []);

  const setPlayback = useCallback((enabled: boolean) => {
    playingRef.current = enabled;
    setIsPlaying(enabled);
  }, []);

  const togglePlayback = useCallback(() => {
    setIsPlaying((current) => {
      const next = !current;
      playingRef.current = next;
      return next;
    });
  }, []);

  const setWireframeMode = useCallback((enabled: boolean) => {
    wireframeRef.current = enabled;
    setWireframe(enabled);
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.materials.forEach((record) => {
      setMaterialWireframe(record.base, enabled);
      if (record.highlight) setMaterialWireframe(record.highlight, enabled);
    });
  }, []);

  const setHotspotsMode = useCallback((enabled: boolean) => {
    hotspotsVisibleRef.current = enabled;
    setHotspotsVisible(enabled);
    const runtime = runtimeRef.current;
    if (runtime) runtime.hotspotRoot.visible = enabled;
  }, []);

  const setAutoRotateMode = useCallback((enabled: boolean) => {
    autoRotateRef.current = enabled;
    setAutoRotate(enabled);
    const runtime = runtimeRef.current;
    if (runtime) runtime.controls.autoRotate = enabled;
  }, []);

  const chooseView = useCallback((view: MotoViewPreset) => {
    activeViewRef.current = view;
    setActiveView(view);
    const runtime = runtimeRef.current;
    if (runtime) applyCameraView(runtime, view);
  }, []);

  const clearSelection = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime) clearRuntimeSelection(runtime);
    publishPartSelection(null);
  }, [publishPartSelection]);

  const resetViewer = useCallback(() => {
    playbackDirectionRef.current = 1;
    setPlayback(false);
    setExplosionValue(0);
    setWireframeMode(false);
    setHotspotsMode(true);
    setAutoRotateMode(false);
    clearSelection();
    chooseView("iso");
    setUiNotice("Visualizador redefinido.");
  }, [
    chooseView,
    clearSelection,
    setAutoRotateMode,
    setExplosionValue,
    setHotspotsMode,
    setPlayback,
    setWireframeMode,
  ]);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenEnabled || !rootRef.current?.requestFullscreen) {
      setUiNotice("Tela cheia não está disponível neste navegador.");
      return;
    }

    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      setUiNotice("Não foi possível ativar a tela cheia.");
    }
  }, []);

  const handleStageKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLButtonElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const preset = VIEW_PRESETS.find((view) => view.shortcut === event.key);
      if (preset) {
        event.preventDefault();
        chooseView(preset.id);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPlayback(false);
        setExplosionValue(explosionRef.current - 0.025);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlayback(false);
        setExplosionValue(explosionRef.current + 0.025);
      } else if (event.key === "Home") {
        event.preventDefault();
        setPlayback(false);
        setExplosionValue(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setPlayback(false);
        setExplosionValue(1);
      } else if (key === "r" && !event.repeat) {
        event.preventDefault();
        resetViewer();
      } else if (key === "w" && !event.repeat) {
        event.preventDefault();
        setWireframeMode(!wireframeRef.current);
      } else if (key === "h" && !event.repeat) {
        event.preventDefault();
        setHotspotsMode(!hotspotsVisibleRef.current);
      } else if (key === "a" && !event.repeat) {
        event.preventDefault();
        setAutoRotateMode(!autoRotateRef.current);
      } else if (key === "f" && !event.repeat) {
        event.preventDefault();
        void toggleFullscreen();
      }
    },
    [
      chooseView,
      resetViewer,
      setAutoRotateMode,
      setExplosionValue,
      setHotspotsMode,
      setPlayback,
      setWireframeMode,
      toggleFullscreen,
      togglePlayback,
    ],
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    setCanFullscreen(
      Boolean(document.fullscreenEnabled && rootRef.current?.requestFullscreen),
    );
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let resizeObserver: ResizeObserver | null = null;
    let dracoLoader: DRACOLoader | null = null;
    let runtime: ViewerRuntime | null = null;
    let pointerStart: { pointerId: number; x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clock = new THREE.Clock();
    let lastStatePublish = 0;
    let progressSnapshot = { ...INITIAL_PROGRESS };
    let errorNoticeTimer: number | null = null;

    setIsLoading(true);
    setLoadError(null);
    setProgress(INITIAL_PROGRESS);
    setStats({ pieceCount: 0, animationCount: 0, duration: EXPLOSION_DURATION });
    publishPartSelection(null);

    const publishProgress = (partial: Partial<MotoViewerProgress>) => {
      if (runtime?.disposed) return;
      const merged = { ...progressSnapshot, ...partial };
      const percent =
        merged.bytesTotal > 0
          ? (merged.bytesLoaded / merged.bytesTotal) * 100
          : merged.itemsTotal > 0
            ? (merged.itemsLoaded / merged.itemsTotal) * 100
            : merged.percent;
      progressSnapshot = {
        ...merged,
        percent: THREE.MathUtils.clamp(percent, 0, 100),
      };
      setProgress(progressSnapshot);
      callbackRef.current.onProgress?.(progressSnapshot);
    };

    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(VIEWER_BACKGROUND);
      scene.fog = new THREE.FogExp2(VIEWER_BACKGROUND, 0.016);

      const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
      camera.position.set(4, 2.4, 5.5);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      renderer.domElement.className = "moto-viewer__canvas";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.touchAction = "none";
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.tabIndex = -1;
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.rotateSpeed = 0.62;
      controls.zoomSpeed = 0.82;
      controls.panSpeed = 0.62;
      controls.screenSpacePanning = true;
      controls.autoRotate = autoRotateRef.current;
      controls.autoRotateSpeed = 0.72;

      const hotspotRoot = new THREE.Group();
      hotspotRoot.name = "Pontos de interesse";
      hotspotRoot.visible = hotspotsVisibleRef.current;
      scene.add(hotspotRoot);

      runtime = {
        disposed: false,
        frameId: 0,
        scene,
        camera,
        renderer,
        controls,
        environment: createCyberEnvironment(scene),
        modelRoot: null,
        mixer: null,
        actions: [],
        meshes: [],
        materials: new Map(),
        sourceMaterials: new Set(),
        selectedMesh: null,
        center: new THREE.Vector3(),
        modelSize: new THREE.Vector3(1, 1, 1),
        cameraDistance: 6,
        hotspotRoot,
        hotspots: [],
        hotspotTexture: null,
        hotspotMaterial: null,
        hotspotSize: 0.05,
        tempVector: new THREE.Vector3(),
      };
      const activeRuntime = runtime;
      runtimeRef.current = activeRuntime;

      const resize = () => {
        const bounds = host.getBoundingClientRect();
        const width = Math.max(Math.round(bounds.width), 1);
        const height = Math.max(Math.round(bounds.height), 1);
        activeRuntime.camera.aspect = width / height;
        activeRuntime.camera.updateProjectionMatrix();
        activeRuntime.renderer.setSize(width, height, false);
      };
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);

      const handlePointerDown = (event: PointerEvent) => {
        pointerStart = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        host.focus({ preventScroll: true });
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (
          !pointerStart ||
          pointerStart.pointerId !== event.pointerId ||
          Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7
        ) {
          pointerStart = null;
          return;
        }
        pointerStart = null;

        const bounds = activeRuntime.renderer.domElement.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, activeRuntime.camera);
        const hit = raycaster.intersectObjects(activeRuntime.meshes, false)[0];
        const mesh = hit?.object instanceof THREE.Mesh ? (hit.object as ViewerMesh) : null;
        selectRuntimeMesh(activeRuntime, mesh);
        publishPartSelection(
          mesh ? formatPieceName(mesh, activeRuntime.modelRoot) : null,
        );
      };

      renderer.domElement.addEventListener("pointerdown", handlePointerDown);
      renderer.domElement.addEventListener("pointerup", handlePointerUp);

      const loadingManager = new THREE.LoadingManager();
      loadingManager.onStart = (_url, itemsLoaded, itemsTotal) => {
        publishProgress({ itemsLoaded, itemsTotal });
      };
      loadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
        publishProgress({ itemsLoaded, itemsTotal });
      };

      dracoLoader = new DRACOLoader(loadingManager);
      dracoLoader.setDecoderPath("/draco/");
      const loader = new GLTFLoader(loadingManager);
      loader.setDRACOLoader(dracoLoader);

      loader.load(
        modelUrl,
        (gltf) => {
          if (activeRuntime.disposed) {
            gltf.scene.traverse((object) => {
              if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                disposeMaterialSet(object.material, true);
              }
            });
            return;
          }

          activeRuntime.modelRoot = gltf.scene;
          gltf.scene.name ||= "Moto MN";
          activeRuntime.scene.add(gltf.scene);

          gltf.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const mesh = object as ViewerMesh;
            const sourceMaterial = mesh.material;
            for (const material of materialList(sourceMaterial)) {
              activeRuntime.sourceMaterials.add(material);
            }
            const baseMaterial = cloneMaterialSet(sourceMaterial);
            mesh.material = baseMaterial;
            setMaterialWireframe(baseMaterial, wireframeRef.current);
            mesh.frustumCulled = true;
            activeRuntime.meshes.push(mesh);
            activeRuntime.materials.set(mesh, { base: baseMaterial });
          });

          activeRuntime.mixer = new THREE.AnimationMixer(gltf.scene);
          activeRuntime.actions = gltf.animations.map((clip) => {
            const action = activeRuntime.mixer?.clipAction(clip);
            if (!action) throw new Error("Falha ao preparar animação da moto.");
            action.enabled = true;
            action.clampWhenFinished = true;
            action.setLoop(THREE.LoopOnce, 0);
            action.play();
            action.paused = true;
            return action;
          });

          sampleAnimations(activeRuntime, 0);
          const baseBounds = new THREE.Box3().setFromObject(gltf.scene);
          sampleAnimations(activeRuntime, 1);
          const fullMotionBounds = baseBounds.clone().union(
            new THREE.Box3().setFromObject(gltf.scene),
          );
          sampleAnimations(activeRuntime, explosionRef.current);

          if (fullMotionBounds.isEmpty()) {
            fullMotionBounds.set(
              new THREE.Vector3(-1, -1, -1),
              new THREE.Vector3(1, 1, 1),
            );
          }
          const safeBaseBounds = baseBounds.isEmpty() ? fullMotionBounds : baseBounds;
          fitCameraToBounds(activeRuntime, fullMotionBounds);
          fitEnvironmentToModel(activeRuntime, safeBaseBounds);
          activeRuntime.hotspotSize = Math.max(
            safeBaseBounds.getSize(new THREE.Vector3()).length() * 0.034,
            0.015,
          );
          addHotspots(activeRuntime);
          activeRuntime.hotspotRoot.visible = hotspotsVisibleRef.current;
          applyCameraView(activeRuntime, activeViewRef.current);

          const loadedStats: MotoViewerStats = {
            pieceCount: activeRuntime.meshes.length,
            animationCount: gltf.animations.length,
            duration: EXPLOSION_DURATION,
          };
          setStats(loadedStats);
          setIsLoading(false);
          publishProgress({
            bytesLoaded: Math.max(progressSnapshot.bytesLoaded, progressSnapshot.bytesTotal),
            itemsLoaded: Math.max(progressSnapshot.itemsLoaded, progressSnapshot.itemsTotal),
            percent: 100,
          });
          callbackRef.current.onLoad?.(loadedStats);
        },
        (event) => {
          publishProgress({
            bytesLoaded: event.loaded,
            bytesTotal: event.lengthComputable ? event.total : progressSnapshot.bytesTotal,
          });
        },
        () => {
          if (activeRuntime.disposed) return;
          setIsLoading(false);
          setLoadError(
            "Não foi possível carregar o modelo 3D. Verifique o arquivo da moto e tente novamente.",
          );
        },
      );

      const renderFrame = (timestamp: number) => {
        if (activeRuntime.disposed) return;
        activeRuntime.frameId = window.requestAnimationFrame(renderFrame);
        const delta = Math.min(clock.getDelta(), 0.05);

        if (playingRef.current && activeRuntime.actions.length > 0) {
          let next =
            explosionRef.current +
            (delta / EXPLOSION_DURATION) * playbackDirectionRef.current;
          if (next >= 1) {
            next = 2 - next;
            playbackDirectionRef.current = -1;
          } else if (next <= 0) {
            next = -next;
            playbackDirectionRef.current = 1;
          }
          next = clamp01(next);
          explosionRef.current = next;
          sampleAnimations(activeRuntime, next);
          if (timestamp - lastStatePublish > 32) {
            setExplosion(next);
            lastStatePublish = timestamp;
          }
        }

        activeRuntime.controls.autoRotate = autoRotateRef.current;
        activeRuntime.controls.update();
        activeRuntime.environment.rings.rotation.z = timestamp * 0.000045;
        activeRuntime.environment.particles.rotation.y = timestamp * 0.000012;
        updateHotspots(activeRuntime, timestamp / 1000);
        activeRuntime.renderer.render(activeRuntime.scene, activeRuntime.camera);
      };
      clock.start();
      activeRuntime.frameId = window.requestAnimationFrame(renderFrame);

      return () => {
        activeRuntime.disposed = true;
        window.cancelAnimationFrame(activeRuntime.frameId);
        resizeObserver?.disconnect();
        renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
        renderer.domElement.removeEventListener("pointerup", handlePointerUp);
        activeRuntime.controls.dispose();
        disposeRuntimeScene(activeRuntime);
        activeRuntime.renderer.dispose();
        activeRuntime.renderer.forceContextLoss();
        dracoLoader?.dispose();
        if (renderer.domElement.parentElement === host) {
          host.removeChild(renderer.domElement);
        }
        if (runtimeRef.current === activeRuntime) runtimeRef.current = null;
      };
    } catch {
      if (runtime) runtime.disposed = true;
      errorNoticeTimer = window.setTimeout(() => {
        setIsLoading(false);
        setLoadError(
          "Este dispositivo não conseguiu iniciar a visualização 3D. Tente um navegador com WebGL ativo.",
        );
      }, 0);
      return () => {
        if (errorNoticeTimer !== null) window.clearTimeout(errorNoticeTimer);
      };
    }
  }, [loadAttempt, modelUrl, publishPartSelection]);

  const rootClassName = [
    "moto-viewer",
    isLoading ? "moto-viewer--loading" : "",
    isFullscreen ? "moto-viewer--fullscreen" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const percent = Math.round(progress.percent);
  const sliderValue = Math.round(explosion * 1000);

  return (
    <section
      ref={rootRef}
      className={rootClassName}
      aria-labelledby={`${viewerId}-title`}
      data-view={activeView}
      data-explosion={Math.round(explosion * 100)}
    >
      <header className="moto-viewer__header">
        <div className="moto-viewer__heading-group">
          <span className="moto-viewer__eyebrow">Laboratório 3D / Moto MN</span>
          <h2 id={`${viewerId}-title`} className="moto-viewer__title">
            Exploded View Interativo
          </h2>
        </div>
        <div className="moto-viewer__model-stats" aria-live="polite">
          <span>{stats.pieceCount} peças</span>
          <span aria-hidden="true">/</span>
          <span>{stats.animationCount} animações</span>
        </div>
      </header>

      <div className="moto-viewer__stage">
        <div
          ref={canvasHostRef}
          className="moto-viewer__canvas-host"
          role="application"
          tabIndex={0}
          aria-label="Modelo tridimensional da moto. Arraste para girar, use a roda ou gesto de pinça para ampliar e toque em uma peça para selecioná-la."
          aria-describedby={`${viewerId}-keyboard-help`}
          onKeyDown={handleStageKeyDown}
        />

        <div className="moto-viewer__hud moto-viewer__hud--top" aria-hidden="true">
          <span className="moto-viewer__hud-label">MN / DIGITAL TWIN</span>
          <span className="moto-viewer__hud-status">
            {isLoading ? "SINCRONIZANDO" : "ONLINE"}
          </span>
        </div>

        <div className="moto-viewer__reticle" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>

        {isLoading && !loadError ? (
          <div className="moto-viewer__loading" role="status" aria-live="polite">
            <span className="moto-viewer__loading-index" aria-hidden="true">
              {String(percent).padStart(2, "0")}
            </span>
            <div className="moto-viewer__loading-copy">
              <strong>Montando gêmeo digital</strong>
              <span>
                {progress.itemsTotal > 0
                  ? `${progress.itemsLoaded} de ${progress.itemsTotal} recursos`
                  : "Preparando geometria"}
                {progress.bytesLoaded > 0
                  ? ` · ${formatBytes(progress.bytesLoaded)}`
                  : ""}
              </span>
            </div>
            <progress
              className="moto-viewer__loading-progress"
              max={100}
              value={percent}
              aria-label={`Carregamento do modelo: ${percent}%`}
            >
              {percent}%
            </progress>
          </div>
        ) : null}

        {loadError ? (
          <div className="moto-viewer__error" role="alert">
            <strong>Visualização indisponível</strong>
            <p>{loadError}</p>
            <button
              type="button"
              className="moto-viewer__button moto-viewer__button--retry"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        <div
          className="moto-viewer__part-readout"
          aria-live="polite"
          data-selected={selectedPart ? "true" : "false"}
        >
          <span>Peça selecionada</span>
          <strong>{selectedPart ?? "Toque em uma peça"}</strong>
          {selectedPart ? (
            <button
              type="button"
              className="moto-viewer__clear-selection"
              onClick={clearSelection}
              aria-label={`Desmarcar ${selectedPart}`}
            >
              Desmarcar
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="moto-viewer__fullscreen-button"
          onClick={() => void toggleFullscreen()}
          disabled={!canFullscreen}
          aria-pressed={isFullscreen}
          title={canFullscreen ? "Alternar tela cheia (F)" : "Tela cheia indisponível"}
        >
          {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </div>

      <div className="moto-viewer__controls">
        <div className="moto-viewer__timeline">
          <button
            type="button"
            className="moto-viewer__play-button"
            onClick={togglePlayback}
            aria-pressed={isPlaying}
            aria-label={isPlaying ? "Pausar explosão automática" : "Reproduzir explosão automática"}
            disabled={isLoading || Boolean(loadError)}
          >
            <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
            <span>{isPlaying ? "Pausar" : "Explodir"}</span>
          </button>

          <div className="moto-viewer__scrubber">
            <label htmlFor={sliderId}>Explosão da moto</label>
            <input
              id={sliderId}
              className="moto-viewer__range"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={sliderValue}
              disabled={isLoading || Boolean(loadError)}
              onPointerDown={() => setPlayback(false)}
              onChange={(event) => setExplosionValue(Number(event.target.value) / 1000)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(explosion * 100)}
              aria-valuetext={`${Math.round(explosion * 100)}% explodida`}
            />
          </div>
          <output className="moto-viewer__timeline-output" htmlFor={sliderId}>
            {String(Math.round(explosion * 100)).padStart(3, "0")}%
          </output>
        </div>

        <div className="moto-viewer__control-deck">
          <div
            className="moto-viewer__view-presets"
            role="group"
            aria-label="Vistas da moto"
          >
            <span className="moto-viewer__control-label">Vistas</span>
            <div className="moto-viewer__button-row">
              {VIEW_PRESETS.map((view) => (
                <button
                  type="button"
                  className="moto-viewer__view-button"
                  key={view.id}
                  onClick={() => chooseView(view.id)}
                  aria-pressed={activeView === view.id}
                  disabled={isLoading || Boolean(loadError)}
                  title={`${view.label} (tecla ${view.shortcut})`}
                >
                  <span aria-hidden="true" className="moto-viewer__view-index">
                    {view.shortcut}
                  </span>
                  {view.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="moto-viewer__display-options"
            role="group"
            aria-label="Opções de exibição"
          >
            <span className="moto-viewer__control-label">Camadas</span>
            <div className="moto-viewer__button-row">
              <button
                type="button"
                className="moto-viewer__toggle-button"
                onClick={() => setWireframeMode(!wireframe)}
                aria-pressed={wireframe}
                disabled={isLoading || Boolean(loadError)}
                title="Alternar estrutura de arame (W)"
              >
                Wireframe
              </button>
              <button
                type="button"
                className="moto-viewer__toggle-button"
                onClick={() => setHotspotsMode(!hotspotsVisible)}
                aria-pressed={hotspotsVisible}
                disabled={isLoading || Boolean(loadError)}
                title="Alternar pontos de interesse (H)"
              >
                Hotspots
              </button>
              <button
                type="button"
                className="moto-viewer__toggle-button"
                onClick={() => setAutoRotateMode(!autoRotate)}
                aria-pressed={autoRotate}
                disabled={isLoading || Boolean(loadError)}
                title="Alternar rotação automática (A)"
              >
                Auto-rotação
              </button>
            </div>
          </div>

          <button
            type="button"
            className="moto-viewer__reset-button"
            onClick={resetViewer}
            disabled={isLoading || Boolean(loadError)}
            title="Redefinir visualizador (R)"
          >
            Redefinir
          </button>
        </div>
      </div>

      <p id={`${viewerId}-keyboard-help`} className="moto-viewer__keyboard-help">
        Teclado: espaço reproduz ou pausa; setas ajustam a explosão; teclas 1 a 5
        mudam a vista; W alterna wireframe; H alterna hotspots; A alterna a
        rotação; R redefine; F abre em tela cheia.
      </p>
      {uiNotice ? (
        <p className="moto-viewer__notice" role="status" aria-live="polite">
          {uiNotice}
        </p>
      ) : null}
    </section>
  );
}
