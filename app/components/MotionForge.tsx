"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  TransformControls,
  type TransformControlsMode,
} from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

type PrimitiveKind =
  | "cube"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "plane"
  | "capsule";

type Vec3Tuple = [number, number, number];

type TransformValue = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
};

type ForgeKeyframe = {
  frame: number;
  transform: TransformValue;
};

type KeyframeMap = Record<string, ForgeKeyframe[]>;

type OutlinerEntry = {
  id: string;
  name: string;
  depth: number;
  kind: string;
  visible: boolean;
  parentId: string | null;
};

type MaterialValue = {
  color: string;
  metalness: number;
  roughness: number;
  wireframe: boolean;
};

type SceneStats = {
  objects: number;
  meshes: number;
  vertices: number;
  triangles: number;
};

type BalanceResult = {
  position: Vec3Tuple;
  stable: boolean;
  score: number;
  support: number;
};

type ForgeProject = {
  format: "motion-forge-project";
  version: 1;
  scene: unknown;
  keyframes: KeyframeMap;
  frame: number;
  camera: {
    position: Vec3Tuple;
    target: Vec3Tuple;
  };
};

type ForgeRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  orbit: OrbitControls;
  transform: TransformControls;
  transformHelper: THREE.Object3D;
  root: THREE.Group;
  grid: THREE.GridHelper;
  selectionBox: THREE.BoxHelper;
  pathGroup: THREE.Group;
  balanceGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
};

type ActionRefs = {
  select: (object: THREE.Object3D | null) => void;
  syncInspector: () => void;
  commitTransform: () => void;
  applyFrame: (frame: number) => void;
  refresh: () => void;
  analyzeBalance: (announce?: boolean) => void;
  resetHistory: () => void;
  setMode: (mode: TransformControlsMode) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  undo: () => void;
  redo: () => void;
  togglePlayback: () => void;
};

const MAX_FRAME = 240;
const FPS = 30;
const HISTORY_LIMIT = 50;

const PRIMITIVES: Array<{
  kind: PrimitiveKind;
  label: string;
  short: string;
}> = [
  { kind: "cube", label: "Cubo", short: "□" },
  { kind: "sphere", label: "Esfera", short: "●" },
  { kind: "cylinder", label: "Cilindro", short: "◫" },
  { kind: "cone", label: "Cone", short: "△" },
  { kind: "torus", label: "Toro", short: "◎" },
  { kind: "plane", label: "Plano", short: "▱" },
  { kind: "capsule", label: "Cápsula", short: "⬭" },
];

const INITIAL_MATERIAL: MaterialValue = {
  color: "#7c5cff",
  metalness: 0.58,
  roughness: 0.28,
  wireframe: false,
};

const INITIAL_TRANSFORM: TransformValue = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

function geometryFor(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(0.72, 32, 20);
    case "cylinder":
      return new THREE.CylinderGeometry(0.62, 0.62, 1.45, 32);
    case "cone":
      return new THREE.ConeGeometry(0.7, 1.55, 32);
    case "torus":
      return new THREE.TorusGeometry(0.68, 0.22, 18, 48);
    case "plane":
      return new THREE.PlaneGeometry(2.2, 2.2, 8, 8);
    case "capsule":
      return new THREE.CapsuleGeometry(0.46, 0.86, 8, 20);
    case "cube":
    default:
      return new THREE.BoxGeometry(1.25, 1.25, 1.25, 2, 2, 2);
  }
}

function primitiveHeight(kind: PrimitiveKind): number {
  switch (kind) {
    case "sphere":
      return 0.72;
    case "cylinder":
      return 0.725;
    case "cone":
      return 0.775;
    case "capsule":
      return 0.89;
    case "cube":
      return 0.625;
    case "torus":
      return 0.24;
    case "plane":
    default:
      return 0.015;
  }
}

function createPrimitive(kind: PrimitiveKind, name: string): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: INITIAL_MATERIAL.color,
    emissive: new THREE.Color(INITIAL_MATERIAL.color).multiplyScalar(0.045),
    metalness: INITIAL_MATERIAL.metalness,
    roughness: INITIAL_MATERIAL.roughness,
    wireframe: INITIAL_MATERIAL.wireframe,
  });
  const mesh = new THREE.Mesh(geometryFor(kind), material);
  mesh.name = name;
  mesh.position.y = primitiveHeight(kind);
  if (kind === "plane") mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = kind !== "plane";
  mesh.receiveShadow = true;
  mesh.userData.forgePrimitive = kind;
  mesh.userData.forgeEditable = true;
  return mesh;
}

function snapshotTransform(object: THREE.Object3D): TransformValue {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function applyTransform(object: THREE.Object3D, value: TransformValue) {
  object.position.fromArray(value.position);
  object.rotation.set(value.rotation[0], value.rotation[1], value.rotation[2]);
  object.scale.fromArray(value.scale);
  object.updateMatrixWorld(true);
}

function copyTransform(value: TransformValue): TransformValue {
  return {
    position: [...value.position],
    rotation: [...value.rotation],
    scale: [...value.scale],
  };
}

function sampleKeyframes(track: ForgeKeyframe[], frame: number): TransformValue | null {
  if (!track.length) return null;
  const sorted = [...track].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return copyTransform(sorted[0].transform);
  if (frame >= sorted[sorted.length - 1].frame) {
    return copyTransform(sorted[sorted.length - 1].transform);
  }

  let left = sorted[0];
  let right = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (frame >= sorted[index].frame && frame <= sorted[index + 1].frame) {
      left = sorted[index];
      right = sorted[index + 1];
      break;
    }
  }

  const span = Math.max(1, right.frame - left.frame);
  const alpha = THREE.MathUtils.clamp((frame - left.frame) / span, 0, 1);
  const position = new THREE.Vector3(...left.transform.position).lerp(
    new THREE.Vector3(...right.transform.position),
    alpha,
  );
  const scale = new THREE.Vector3(...left.transform.scale).lerp(
    new THREE.Vector3(...right.transform.scale),
    alpha,
  );
  const leftQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...left.transform.rotation),
  );
  const rightQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...right.transform.rotation),
  );
  const quaternion = leftQuaternion.slerp(rightQuaternion, alpha);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion);

  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

function disposeRenderable(object: THREE.Object3D) {
  if (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.Points
  ) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  }
}

function disposeTree(object: THREE.Object3D) {
  object.traverse(disposeRenderable);
}

function clearHelper(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeTree(child);
  }
}

function markEditable(object: THREE.Object3D, cloneMaterials = false) {
  object.traverse((child) => {
    child.userData.forgeEditable = true;
    if (cloneMaterials && child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    }
  });
}

function cloneForEditing(source: THREE.Object3D): THREE.Object3D {
  const cloned = cloneSkeleton(source);
  cloned.traverse((child) => {
    child.userData.forgeEditable = true;
    if (child instanceof THREE.Mesh) {
      child.geometry = child.geometry.clone();
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    }
  });
  return cloned;
}

function humanCount(value: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isFiniteTuple(value: unknown): value is Vec3Tuple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function sanitizeKeyframes(value: unknown): KeyframeMap {
  if (!value || typeof value !== "object") return {};
  const result: KeyframeMap = {};
  for (const [id, rawTrack] of Object.entries(value)) {
    if (!Array.isArray(rawTrack)) continue;
    const track: ForgeKeyframe[] = [];
    for (const rawKey of rawTrack) {
      if (!rawKey || typeof rawKey !== "object") continue;
      const candidate = rawKey as {
        frame?: unknown;
        transform?: Partial<TransformValue>;
      };
      if (
        typeof candidate.frame !== "number" ||
        !Number.isFinite(candidate.frame) ||
        !candidate.transform ||
        !isFiniteTuple(candidate.transform.position) ||
        !isFiniteTuple(candidate.transform.rotation) ||
        !isFiniteTuple(candidate.transform.scale)
      ) {
        continue;
      }
      track.push({
        frame: THREE.MathUtils.clamp(Math.round(candidate.frame), 0, MAX_FRAME),
        transform: {
          position: [...candidate.transform.position],
          rotation: [...candidate.transform.rotation],
          scale: [...candidate.transform.scale],
        },
      });
    }
    if (track.length) {
      result[id] = track.sort((a, b) => a.frame - b.frame);
    }
  }
  return result;
}

function fileStem(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export default function MotionForge() {
  const mountRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const runtimeRef = useRef<ForgeRuntime | null>(null);
  const selectedRef = useRef<string | null>(null);
  const keyframesRef = useRef<KeyframeMap>({});
  const frameRef = useRef(0);
  const playingRef = useRef(false);
  const autoKeyRef = useRef(false);
  const pathVisibleRef = useRef(true);
  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const applyingRef = useRef(false);
  const primitiveCountRef = useRef<Record<PrimitiveKind, number>>({
    cube: 0,
    sphere: 0,
    cylinder: 0,
    cone: 0,
    torus: 0,
    plane: 0,
    capsule: 0,
  });

  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<OutlinerEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [selectedKind, setSelectedKind] = useState("—");
  const [transformValue, setTransformValue] =
    useState<TransformValue>(INITIAL_TRANSFORM);
  const [materialValue, setMaterialValue] =
    useState<MaterialValue>(INITIAL_MATERIAL);
  const [mode, setModeState] = useState<TransformControlsMode>("translate");
  const [space, setSpace] = useState<"world" | "local">("world");
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoKey, setAutoKey] = useState(false);
  const [pathVisible, setPathVisible] = useState(true);
  const [keyframes, setKeyframes] = useState<KeyframeMap>({});
  const [stats, setStats] = useState<SceneStats>({
    objects: 0,
    meshes: 0,
    vertices: 0,
    triangles: 0,
  });
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState("Preparando o núcleo 3D…");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const actionRefs = useRef<ActionRefs>({
    select: () => undefined,
    syncInspector: () => undefined,
    commitTransform: () => undefined,
    applyFrame: () => undefined,
    refresh: () => undefined,
    analyzeBalance: () => undefined,
    resetHistory: () => undefined,
    setMode: () => undefined,
    deleteSelected: () => undefined,
    duplicateSelected: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    togglePlayback: () => undefined,
  });

  const getSelected = (): THREE.Object3D | null => {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedRef.current) return null;
    return runtime.root.getObjectByProperty("uuid", selectedRef.current) ?? null;
  };

  const firstMesh = (object: THREE.Object3D): THREE.Mesh | null => {
    let found: THREE.Mesh | null = object instanceof THREE.Mesh ? object : null;
    if (!found) {
      object.traverse((child) => {
        if (!found && child instanceof THREE.Mesh) found = child;
      });
    }
    return found;
  };

  const readMaterial = (object: THREE.Object3D): MaterialValue => {
    const mesh = firstMesh(object);
    if (!mesh) return INITIAL_MATERIAL;
    const material = Array.isArray(mesh.material)
      ? mesh.material[0]
      : mesh.material;
    const standard = material instanceof THREE.MeshStandardMaterial
      ? material
      : null;
    const color = "color" in material && material.color instanceof THREE.Color
      ? `#${material.color.getHexString()}`
      : INITIAL_MATERIAL.color;
    return {
      color,
      metalness: standard?.metalness ?? INITIAL_MATERIAL.metalness,
      roughness: standard?.roughness ?? INITIAL_MATERIAL.roughness,
      wireframe: "wireframe" in material && typeof material.wireframe === "boolean"
        ? material.wireframe
        : false,
    };
  };

  const rebuildPath = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearHelper(runtime.pathGroup);
    runtime.pathGroup.visible = pathVisibleRef.current;
    const object = getSelected();
    if (!object) return;
    const track = keyframesRef.current[object.uuid] ?? [];
    if (!track.length) return;

    object.parent?.updateMatrixWorld(true);
    const points = [...track]
      .sort((a, b) => a.frame - b.frame)
      .map((key) => {
        const point = new THREE.Vector3(...key.transform.position);
        return object.parent ? object.parent.localToWorld(point) : point;
      });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0x67efff,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
      }),
    );
    line.renderOrder = 90;
    const pointGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const pointCloud = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        color: 0xff4fb9,
        size: 0.11,
        sizeAttenuation: true,
        depthTest: false,
      }),
    );
    pointCloud.renderOrder = 91;
    runtime.pathGroup.add(line, pointCloud);
  };

  const refresh = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const nextEntries: OutlinerEntry[] = [];
    let meshes = 0;
    let vertices = 0;
    let triangles = 0;

    const visit = (object: THREE.Object3D, depth: number) => {
      nextEntries.push({
        id: object.uuid,
        name: object.name || object.type,
        depth,
        kind: object.type,
        visible: object.visible,
        parentId: object.parent === runtime.root ? null : object.parent?.uuid ?? null,
      });
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const positionCount = object.geometry.attributes.position?.count ?? 0;
        vertices += positionCount;
        triangles += object.geometry.index
          ? Math.floor(object.geometry.index.count / 3)
          : Math.floor(positionCount / 3);
      }
      object.children.forEach((child) => visit(child, depth + 1));
    };
    runtime.root.children.forEach((child) => visit(child, 0));
    setEntries(nextEntries);
    setStats({
      objects: nextEntries.length,
      meshes,
      vertices,
      triangles,
    });

    if (
      selectedRef.current &&
      !runtime.root.getObjectByProperty("uuid", selectedRef.current)
    ) {
      actionRefs.current.select(null);
    }
  };

  const syncInspector = () => {
    const object = getSelected();
    if (!object) return;
    setTransformValue(snapshotTransform(object));
    setMaterialValue(readMaterial(object));
    setSelectedName(object.name || object.type);
    setSelectedKind(object.type);
  };

  const selectObject = (object: THREE.Object3D | null) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!object || object === runtime.root) {
      selectedRef.current = null;
      setSelectedId(null);
      setSelectedName("");
      setSelectedKind("—");
      runtime.transform.detach();
      runtime.selectionBox.visible = false;
      clearHelper(runtime.pathGroup);
      setBalance(null);
      clearHelper(runtime.balanceGroup);
      return;
    }
    selectedRef.current = object.uuid;
    setSelectedId(object.uuid);
    setSelectedName(object.name || object.type);
    setSelectedKind(object.type);
    setTransformValue(snapshotTransform(object));
    setMaterialValue(readMaterial(object));
    runtime.transform.attach(object);
    runtime.selectionBox.setFromObject(object);
    runtime.selectionBox.visible = true;
    rebuildPath();
    window.setTimeout(() => actionRefs.current.analyzeBalance(false), 0);
  };

  const updateHistoryFlags = () => {
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(futureRef.current.length > 0);
  };

  const captureProject = (): ForgeProject | null => {
    const runtime = runtimeRef.current;
    if (!runtime) return null;
    return {
      format: "motion-forge-project",
      version: 1,
      scene: runtime.root.toJSON(),
      keyframes: keyframesRef.current,
      frame: Math.round(frameRef.current),
      camera: {
        position: [
          runtime.camera.position.x,
          runtime.camera.position.y,
          runtime.camera.position.z,
        ],
        target: [
          runtime.orbit.target.x,
          runtime.orbit.target.y,
          runtime.orbit.target.z,
        ],
      },
    };
  };

  const captureProjectString = (): string | null => {
    try {
      const project = captureProject();
      return project ? JSON.stringify(project) : null;
    } catch {
      setStatus("O estado possui um recurso externo que não pôde entrar no histórico.");
      return null;
    }
  };

  const commitHistory = () => {
    const snapshot = captureProjectString();
    if (!snapshot) return;
    if (historyRef.current[historyRef.current.length - 1] === snapshot) return;
    historyRef.current.push(snapshot);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    updateHistoryFlags();
  };

  const resetHistory = () => {
    const snapshot = captureProjectString();
    historyRef.current = snapshot ? [snapshot] : [];
    futureRef.current = [];
    updateHistoryFlags();
  };

  const setKeyframeMap = (next: KeyframeMap) => {
    keyframesRef.current = next;
    setKeyframes(next);
    rebuildPath();
  };

  const writeKeyframe = (
    object: THREE.Object3D,
    targetFrame = Math.round(frameRef.current),
    value = snapshotTransform(object),
  ) => {
    const frameNumber = THREE.MathUtils.clamp(Math.round(targetFrame), 0, MAX_FRAME);
    const currentTrack = keyframesRef.current[object.uuid] ?? [];
    const nextTrack = currentTrack
      .filter((key) => key.frame !== frameNumber)
      .concat({ frame: frameNumber, transform: copyTransform(value) })
      .sort((a, b) => a.frame - b.frame);
    setKeyframeMap({
      ...keyframesRef.current,
      [object.uuid]: nextTrack,
    });
  };

  const applyFrame = (targetFrame: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyingRef.current = true;
    for (const [id, track] of Object.entries(keyframesRef.current)) {
      const object = runtime.root.getObjectByProperty("uuid", id);
      const sampled = sampleKeyframes(track, targetFrame);
      if (object && sampled) applyTransform(object, sampled);
    }
    applyingRef.current = false;
    if (selectedRef.current) {
      const selected = getSelected();
      if (selected) runtime.selectionBox.setFromObject(selected);
    }
  };

  const seek = (targetFrame: number) => {
    const next = THREE.MathUtils.clamp(Math.round(targetFrame), 0, MAX_FRAME);
    frameRef.current = next;
    setFrame(next);
    applyFrame(next);
    syncInspector();
    actionRefs.current.analyzeBalance(false);
  };

  const setPlayback = (next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
    setStatus(next ? "Reproduzindo a timeline a 30 fps." : "Timeline pausada.");
  };

  const togglePlayback = () => setPlayback(!playingRef.current);

  const setTransformMode = (next: TransformControlsMode) => {
    runtimeRef.current?.transform.setMode(next);
    setModeState(next);
  };

  const updateSnap = (enabled: boolean) => {
    const transform = runtimeRef.current?.transform;
    if (transform) {
      transform.setTranslationSnap(enabled ? 0.25 : null);
      transform.setRotationSnap(enabled ? Math.PI / 12 : null);
      transform.setScaleSnap(enabled ? 0.1 : null);
    }
    setSnapEnabled(enabled);
    setStatus(enabled ? "Snap: 0,25 m / 15° / 0,1×." : "Snap livre.");
  };

  const updateSpace = (next: "world" | "local") => {
    runtimeRef.current?.transform.setSpace(next);
    setSpace(next);
  };

  const addPrimitive = (kind: PrimitiveKind) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    primitiveCountRef.current[kind] += 1;
    const config = PRIMITIVES.find((item) => item.kind === kind);
    const mesh = createPrimitive(
      kind,
      `${config?.label ?? "Objeto"} ${String(primitiveCountRef.current[kind]).padStart(2, "0")}`,
    );
    const slot = runtime.root.children.length % 5;
    mesh.position.x = (slot - 2) * 1.45;
    runtime.root.add(mesh);
    refresh();
    selectObject(mesh);
    commitHistory();
    setStatus(`${mesh.name} criado e selecionado.`);
  };

  const idsInTree = (object: THREE.Object3D): string[] => {
    const ids: string[] = [];
    object.traverse((child) => ids.push(child.uuid));
    return ids;
  };

  const deleteSelected = () => {
    const runtime = runtimeRef.current;
    const object = getSelected();
    if (!runtime || !object || !object.parent) return;
    const name = object.name || object.type;
    const removedIds = new Set(idsInTree(object));
    runtime.transform.detach();
    object.parent.remove(object);
    disposeTree(object);
    const nextKeys = Object.fromEntries(
      Object.entries(keyframesRef.current).filter(([id]) => !removedIds.has(id)),
    );
    setKeyframeMap(nextKeys);
    selectObject(null);
    refresh();
    commitHistory();
    setStatus(`${name} removido da cena.`);
  };

  const duplicateSelected = () => {
    const object = getSelected();
    if (!object?.parent) return;
    const originalNodes: THREE.Object3D[] = [];
    object.traverse((child) => originalNodes.push(child));
    const copy = cloneForEditing(object);
    copy.name = `${object.name || object.type} · cópia`;
    copy.position.x += 0.55;
    object.parent.add(copy);
    const clonedNodes: THREE.Object3D[] = [];
    copy.traverse((child) => clonedNodes.push(child));
    const copiedKeys: KeyframeMap = { ...keyframesRef.current };
    originalNodes.forEach((source, index) => {
      const sourceTrack = keyframesRef.current[source.uuid];
      const target = clonedNodes[index];
      if (sourceTrack && target) {
        copiedKeys[target.uuid] = sourceTrack.map((key) => ({
          frame: key.frame,
          transform: copyTransform(key.transform),
        }));
      }
    });
    setKeyframeMap(copiedKeys);
    refresh();
    selectObject(copy);
    commitHistory();
    setStatus(`${copy.name} criada.`);
  };

  const groupSelected = () => {
    const object = getSelected();
    if (!object?.parent) return;
    const parent = object.parent;
    const group = new THREE.Group();
    group.name = `Grupo ${String(entries.filter((entry) => entry.kind === "Group").length + 1).padStart(2, "0")}`;
    group.userData.forgeEditable = true;
    parent.add(group);
    group.attach(object);
    refresh();
    selectObject(group);
    commitHistory();
    setStatus(`${object.name || object.type} agrupado.`);
  };

  const elevateSelected = () => {
    const runtime = runtimeRef.current;
    const object = getSelected();
    if (!runtime || !object || object.parent === runtime.root) return;
    runtime.root.attach(object);
    refresh();
    selectObject(object);
    commitHistory();
    setStatus(`${object.name || object.type} movido para a raiz.`);
  };

  const reparentSelected = (parentId: string) => {
    const runtime = runtimeRef.current;
    const object = getSelected();
    if (!runtime || !object) return;
    const target = parentId === "root"
      ? runtime.root
      : runtime.root.getObjectByProperty("uuid", parentId);
    if (!target || target === object) return;
    let ancestor: THREE.Object3D | null = target;
    while (ancestor) {
      if (ancestor === object) {
        setStatus("Um objeto não pode ser pai de si mesmo.");
        return;
      }
      ancestor = ancestor.parent;
    }
    target.attach(object);
    refresh();
    selectObject(object);
    commitHistory();
    setStatus(`Hierarquia de ${object.name || object.type} atualizada.`);
  };

  const toggleVisibility = (id: string) => {
    const runtime = runtimeRef.current;
    const object = runtime?.root.getObjectByProperty("uuid", id);
    if (!object) return;
    object.visible = !object.visible;
    refresh();
    commitHistory();
    setStatus(`${object.name || object.type}: ${object.visible ? "visível" : "oculto"}.`);
  };

  const commitRename = () => {
    const object = getSelected();
    if (!object) return;
    const nextName = selectedName.trim() || object.type;
    if (object.name === nextName) return;
    object.name = nextName;
    setSelectedName(nextName);
    refresh();
    commitHistory();
    setStatus(`Objeto renomeado para ${nextName}.`);
  };

  const setTransformField = (
    section: keyof TransformValue,
    axis: 0 | 1 | 2,
    rawValue: number,
  ) => {
    const object = getSelected();
    if (!object || !Number.isFinite(rawValue)) return;
    const next = copyTransform(snapshotTransform(object));
    if (section === "rotation") {
      next.rotation[axis] = THREE.MathUtils.degToRad(rawValue);
    } else if (section === "scale") {
      next.scale[axis] = Math.max(0.01, rawValue);
    } else {
      next.position[axis] = rawValue;
    }
    applyTransform(object, next);
    setTransformValue(next);
    runtimeRef.current?.selectionBox.setFromObject(object);
    if (autoKeyRef.current) writeKeyframe(object);
    actionRefs.current.analyzeBalance(false);
    commitHistory();
  };

  const setMaterialField = <K extends keyof MaterialValue>(
    key: K,
    value: MaterialValue[K],
  ) => {
    const object = getSelected();
    if (!object) return;
    const next = { ...materialValue, [key]: value };
    setMaterialValue(next);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => {
        if (key === "color" && "color" in material && material.color instanceof THREE.Color) {
          material.color.set(value as string);
        }
        if (material instanceof THREE.MeshStandardMaterial) {
          if (key === "metalness") material.metalness = value as number;
          if (key === "roughness") material.roughness = value as number;
        }
        if (key === "wireframe" && "wireframe" in material) {
          material.wireframe = value as boolean;
        }
        material.needsUpdate = true;
      });
    });
    commitHistory();
  };

  const addCurrentKeyframe = () => {
    const object = getSelected();
    if (!object) {
      setStatus("Selecione um objeto antes de criar um keyframe.");
      return;
    }
    writeKeyframe(object);
    commitHistory();
    setStatus(`Keyframe salvo no frame ${Math.round(frameRef.current)}.`);
  };

  const removeCurrentKeyframe = () => {
    const object = getSelected();
    if (!object) return;
    const targetFrame = Math.round(frameRef.current);
    const nextTrack = (keyframesRef.current[object.uuid] ?? []).filter(
      (key) => key.frame !== targetFrame,
    );
    const next = { ...keyframesRef.current };
    if (nextTrack.length) next[object.uuid] = nextTrack;
    else delete next[object.uuid];
    setKeyframeMap(next);
    commitHistory();
    setStatus(`Keyframe do frame ${targetFrame} removido.`);
  };

  const applyPreset = (preset: "bounce" | "spin" | "arc") => {
    const object = getSelected();
    if (!object) {
      setStatus("Selecione um objeto para aplicar um preset.");
      return;
    }
    const base = snapshotTransform(object);
    const createKey = (targetFrame: number, transform: TransformValue): ForgeKeyframe => ({
      frame: targetFrame,
      transform,
    });
    let track: ForgeKeyframe[];

    if (preset === "bounce") {
      track = [
        createKey(0, copyTransform(base)),
        createKey(45, {
          ...copyTransform(base),
          position: [base.position[0], base.position[1] + 1.65, base.position[2]],
          scale: [base.scale[0] * 0.92, base.scale[1] * 1.08, base.scale[2] * 0.92],
        }),
        createKey(90, {
          ...copyTransform(base),
          scale: [base.scale[0] * 1.12, base.scale[1] * 0.82, base.scale[2] * 1.12],
        }),
        createKey(135, {
          ...copyTransform(base),
          position: [base.position[0], base.position[1] + 0.72, base.position[2]],
        }),
        createKey(180, copyTransform(base)),
        createKey(240, copyTransform(base)),
      ];
    } else if (preset === "spin") {
      track = [0, 60, 120, 180, 240].map((targetFrame, index) =>
        createKey(targetFrame, {
          ...copyTransform(base),
          rotation: [
            base.rotation[0],
            base.rotation[1] + index * (Math.PI / 2),
            base.rotation[2],
          ],
        }),
      );
    } else {
      track = [
        createKey(0, {
          ...copyTransform(base),
          position: [base.position[0] - 2, base.position[1], base.position[2]],
        }),
        createKey(60, {
          ...copyTransform(base),
          position: [base.position[0] - 1, base.position[1] + 1.35, base.position[2] + 0.65],
          rotation: [base.rotation[0], base.rotation[1], base.rotation[2] + 0.35],
        }),
        createKey(120, {
          ...copyTransform(base),
          position: [base.position[0], base.position[1] + 2.05, base.position[2]],
        }),
        createKey(180, {
          ...copyTransform(base),
          position: [base.position[0] + 1, base.position[1] + 1.35, base.position[2] - 0.65],
          rotation: [base.rotation[0], base.rotation[1], base.rotation[2] - 0.35],
        }),
        createKey(240, {
          ...copyTransform(base),
          position: [base.position[0] + 2, base.position[1], base.position[2]],
        }),
      ];
    }

    setKeyframeMap({ ...keyframesRef.current, [object.uuid]: track });
    seek(0);
    commitHistory();
    setStatus(
      preset === "bounce"
        ? "Preset Salto aplicado."
        : preset === "spin"
          ? "Preset Giro aplicado."
          : "Preset Arco aplicado com trilha visível.",
    );
  };

  const analyzeBalance = (announce = true) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const target = getSelected() ?? runtime.root;
    target.updateWorldMatrix(true, true);
    const meshData: Array<{
      box: THREE.Box3;
      center: THREE.Vector3;
      mass: number;
    }> = [];
    target.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) return;
      const box = new THREE.Box3().setFromObject(child);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const mass = Math.max(0.001, size.x * size.y * size.z);
      meshData.push({ box, center: box.getCenter(new THREE.Vector3()), mass });
    });

    clearHelper(runtime.balanceGroup);
    if (!meshData.length) {
      setBalance(null);
      if (announce) setStatus("Não há malhas visíveis para estimar o equilíbrio.");
      return;
    }

    const totalMass = meshData.reduce((sum, item) => sum + item.mass, 0);
    const center = meshData.reduce(
      (sum, item) => sum.addScaledVector(item.center, item.mass),
      new THREE.Vector3(),
    ).divideScalar(totalMass);
    const sceneBox = meshData.reduce(
      (box, item) => box.union(item.box),
      new THREE.Box3().makeEmpty(),
    );
    const sceneSize = sceneBox.getSize(new THREE.Vector3());
    const supportThreshold = sceneBox.min.y + Math.max(0.05, sceneSize.y * 0.14);
    const supportBox = meshData
      .filter((item) => item.box.min.y <= supportThreshold)
      .reduce((box, item) => box.union(item.box), new THREE.Box3().makeEmpty());
    const supportCenter = supportBox.getCenter(new THREE.Vector3());
    const supportSize = supportBox.getSize(new THREE.Vector3());
    const halfX = Math.max(0.08, supportSize.x / 2);
    const halfZ = Math.max(0.08, supportSize.z / 2);
    const norm = Math.max(
      Math.abs(center.x - supportCenter.x) / halfX,
      Math.abs(center.z - supportCenter.z) / halfZ,
    );
    const stable = norm <= 0.9;
    const score = Math.round(THREE.MathUtils.clamp(100 - Math.max(0, norm - 0.12) * 92, 0, 100));
    const result: BalanceResult = {
      position: [center.x, center.y, center.z],
      stable,
      score,
      support: supportSize.x * supportSize.z,
    };
    setBalance(result);

    const color = stable ? 0x65ffb3 : 0xff4f91;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.055, sceneSize.length() * 0.018), 18, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false }),
    );
    marker.position.copy(center);
    marker.renderOrder = 100;
    const projection = new THREE.Vector3(center.x, sceneBox.min.y + 0.012, center.z);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([center, projection]),
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.08,
        gapSize: 0.05,
        depthTest: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 99;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.145, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.position.copy(projection);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 100;
    runtime.balanceGroup.add(marker, line, ring);
    if (announce) {
      setStatus(
        stable
          ? `Centro de massa dentro da base estimada · estabilidade ${score}%.`
          : `Atenção: centro de massa fora da base segura · estabilidade ${score}%.`,
      );
    }
  };

  const setCameraView = (view: "iso" | "front" | "side" | "top") => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const selected = getSelected();
    const target = selected
      ? new THREE.Box3().setFromObject(selected).getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 1, 0);
    const box = selected ? new THREE.Box3().setFromObject(selected) : null;
    const distance = Math.max(5, (box?.getSize(new THREE.Vector3()).length() ?? 4) * 2.1);
    runtime.orbit.target.copy(target);
    if (view === "front") runtime.camera.position.set(target.x, target.y, target.z + distance);
    if (view === "side") runtime.camera.position.set(target.x + distance, target.y, target.z);
    if (view === "top") runtime.camera.position.set(target.x, target.y + distance, target.z + 0.001);
    if (view === "iso") {
      runtime.camera.position.set(
        target.x + distance * 0.72,
        target.y + distance * 0.62,
        target.z + distance * 0.72,
      );
    }
    runtime.camera.lookAt(target);
    runtime.orbit.update();
    setStatus(`Câmera: ${view === "iso" ? "perspectiva" : view === "front" ? "frontal" : view === "side" ? "lateral" : "superior"}.`);
  };

  const fitSelection = () => {
    const object = getSelected();
    const runtime = runtimeRef.current;
    if (!object || !runtime) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const direction = runtime.camera.position.clone().sub(runtime.orbit.target).normalize();
    runtime.orbit.target.copy(center);
    runtime.camera.position.copy(center).addScaledVector(direction, Math.max(2.5, size * 1.55));
    runtime.orbit.update();
    setStatus(`${object.name || object.type} enquadrado.`);
  };

  const buildAnimationClips = (): THREE.AnimationClip[] => {
    const runtime = runtimeRef.current;
    if (!runtime) return [];
    const tracks: THREE.KeyframeTrack[] = [];
    const existingClips: THREE.AnimationClip[] = [];
    const clipIds = new Set<string>();
    runtime.root.traverse((object) => {
      object.animations.forEach((clip) => {
        if (!clipIds.has(clip.uuid)) {
          clipIds.add(clip.uuid);
          existingClips.push(clip);
        }
      });
    });
    for (const [id, rawTrack] of Object.entries(keyframesRef.current)) {
      const object = runtime.root.getObjectByProperty("uuid", id);
      if (!object || !rawTrack.length) continue;
      const sorted = [...rawTrack].sort((a, b) => a.frame - b.frame);
      const times = sorted.map((key) => key.frame / FPS);
      const positions = sorted.flatMap((key) => key.transform.position);
      const scales = sorted.flatMap((key) => key.transform.scale);
      const quaternions = sorted.flatMap((key) => {
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...key.transform.rotation),
        );
        return quaternion.toArray();
      });
      tracks.push(
        new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, positions),
        new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, quaternions),
        new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, scales),
      );
    }
    if (tracks.length) {
      existingClips.push(
        new THREE.AnimationClip("Motion Forge · Timeline", MAX_FRAME / FPS, tracks),
      );
    }
    return existingClips;
  };

  const exportGlb = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtime.root.children.length) {
      setStatus("A cena está vazia; crie ou importe um objeto antes de exportar.");
      return;
    }
    setStatus("Gerando GLB com a timeline…");
    try {
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(runtime.root, {
        binary: true,
        trs: true,
        onlyVisible: true,
        animations: buildAnimationClips(),
      });
      if (!(result instanceof ArrayBuffer)) throw new Error("Formato binário indisponível.");
      downloadBlob(new Blob([result], { type: "model/gltf-binary" }), "motion-forge-scene.glb");
      setStatus("GLB exportado com objetos, materiais e animação.");
    } catch (error) {
      setStatus(error instanceof Error ? `Falha ao exportar GLB: ${error.message}` : "Falha ao exportar GLB.");
    }
  };

  const importGltf = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const model = files.find((file) => /\.(glb|gltf)$/i.test(file.name));
    const runtime = runtimeRef.current;
    if (!model || !runtime) {
      setStatus("Selecione um arquivo .glb ou .gltf.");
      return;
    }
    setStatus(`Importando ${model.name}…`);
    const objectUrls = new Map<string, string>();
    try {
      files.forEach((file) => objectUrls.set(file.name, URL.createObjectURL(file)));
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        const clean = decodeURIComponent(url.split("/").pop() ?? url);
        return objectUrls.get(clean) ?? url;
      });
      const loader = new GLTFLoader(manager);
      const source = /\.glb$/i.test(model.name)
        ? await model.arrayBuffer()
        : await model.text();
      const gltf = await loader.parseAsync(source, "");
      const imported = gltf.scene;
      imported.name = imported.name || fileStem(model.name);
      markEditable(imported, true);
      imported.animations = gltf.animations;
      runtime.root.add(imported);
      refresh();
      selectObject(imported);
      fitSelection();
      commitHistory();
      setStatus(
        `${model.name} importado · ${gltf.animations.length} animação(ões) incorporada(s).`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Falha ao importar: ${error.message}. Em .gltf, selecione também .bin e texturas.`
          : "Falha ao importar o modelo.",
      );
    } finally {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  };

  const saveProject = () => {
    const project = captureProject();
    if (!project) return;
    try {
      const blob = new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      });
      downloadBlob(blob, "motion-forge-project.json");
      setStatus("Projeto JSON salvo neste dispositivo.");
    } catch {
      setStatus("Não foi possível serializar este projeto.");
    }
  };

  const restoreProject = (value: unknown, resetStack: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || !value || typeof value !== "object") {
      throw new Error("Projeto inválido.");
    }
    const candidate = value as Partial<ForgeProject>;
    if (candidate.format !== "motion-forge-project" || !candidate.scene) {
      throw new Error("Este JSON não é um projeto Motion Forge.");
    }
    const loaded = new THREE.ObjectLoader().parse(candidate.scene);
    runtime.transform.detach();
    selectObject(null);
    for (const child of [...runtime.root.children]) {
      runtime.root.remove(child);
      disposeTree(child);
    }
    const sourceChildren = loaded.children.length ? [...loaded.children] : [loaded];
    sourceChildren.forEach((child) => {
      markEditable(child);
      runtime.root.add(child);
    });
    const nextKeys = sanitizeKeyframes(candidate.keyframes);
    setKeyframeMap(nextKeys);
    const nextFrame = typeof candidate.frame === "number"
      ? THREE.MathUtils.clamp(Math.round(candidate.frame), 0, MAX_FRAME)
      : 0;
    frameRef.current = nextFrame;
    setFrame(nextFrame);
    if (
      candidate.camera &&
      isFiniteTuple(candidate.camera.position) &&
      isFiniteTuple(candidate.camera.target)
    ) {
      runtime.camera.position.fromArray(candidate.camera.position);
      runtime.orbit.target.fromArray(candidate.camera.target);
      runtime.orbit.update();
    }
    applyFrame(nextFrame);
    refresh();
    if (resetStack) resetHistory();
  };

  const openProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      restoreProject(value, true);
      setStatus(`${file.name} aberto com sucesso.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível abrir o projeto.");
    }
  };

  const undo = () => {
    if (historyRef.current.length <= 1) return;
    const current = historyRef.current.pop();
    if (current) futureRef.current.push(current);
    const previous = historyRef.current[historyRef.current.length - 1];
    if (!previous) return;
    try {
      restoreProject(JSON.parse(previous) as unknown, false);
      updateHistoryFlags();
      setStatus("Ação desfeita.");
    } catch {
      setStatus("Não foi possível desfazer esta ação.");
    }
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    try {
      restoreProject(JSON.parse(next) as unknown, false);
      historyRef.current.push(next);
      updateHistoryFlags();
      setStatus("Ação refeita.");
    } catch {
      setStatus("Não foi possível refazer esta ação.");
    }
  };

  const newProject = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.root.children.length && !window.confirm("Criar um projeto novo e limpar a cena atual?")) return;
    runtime.transform.detach();
    for (const child of [...runtime.root.children]) {
      runtime.root.remove(child);
      disposeTree(child);
    }
    selectObject(null);
    setKeyframeMap({});
    frameRef.current = 0;
    setFrame(0);
    primitiveCountRef.current.cube += 1;
    const cube = createPrimitive("cube", "Cubo 01");
    runtime.root.add(cube);
    refresh();
    selectObject(cube);
    resetHistory();
    setStatus("Novo projeto criado.");
  };

  const commitTransform = () => {
    if (applyingRef.current) return;
    const object = getSelected();
    if (!object) return;
    syncInspector();
    if (autoKeyRef.current) writeKeyframe(object);
    analyzeBalance(false);
    commitHistory();
    setStatus(
      autoKeyRef.current
        ? `Transformação e keyframe gravados no frame ${Math.round(frameRef.current)}.`
        : "Transformação aplicada.",
    );
  };

  actionRefs.current = {
    select: selectObject,
    syncInspector,
    commitTransform,
    applyFrame,
    refresh,
    analyzeBalance,
    resetHistory,
    setMode: setTransformMode,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    togglePlayback,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.FogExp2(0x05070d, 0.028);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
    camera.position.set(6.8, 5.1, 7.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.075;
    orbit.target.set(0, 1, 0);
    orbit.minDistance = 1.2;
    orbit.maxDistance = 75;
    orbit.update();

    const root = new THREE.Group();
    root.name = "Motion Forge Scene";
    scene.add(root);

    const grid = new THREE.GridHelper(30, 60, 0x5cf2ff, 0x243044);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.38;
    });
    scene.add(grid);

    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.28 }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = -0.012;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    const hemisphere = new THREE.HemisphereLight(0x91f8ff, 0x15081c, 1.7);
    const key = new THREE.DirectionalLight(0xd7fbff, 3.5);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 35;
    const rim = new THREE.PointLight(0xff2aa4, 26, 20, 2);
    rim.position.set(-4, 3.5, -3);
    const fill = new THREE.PointLight(0x564dff, 18, 16, 2);
    fill.position.set(4, 1.8, -4);
    scene.add(hemisphere, key, rim, fill);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSize(0.82);
    transform.setColors(0xff5aa9, 0x69ffb4, 0x5cdcff, 0xffffff);
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);

    const selectionBox = new THREE.BoxHelper(root, 0x61efff);
    const selectionMaterial = selectionBox.material as THREE.LineBasicMaterial;
    selectionMaterial.transparent = true;
    selectionMaterial.opacity = 0.72;
    selectionMaterial.depthTest = false;
    selectionBox.visible = false;
    selectionBox.renderOrder = 80;
    scene.add(selectionBox);

    const pathGroup = new THREE.Group();
    pathGroup.name = "Forge Path Helper";
    scene.add(pathGroup);
    const balanceGroup = new THREE.Group();
    balanceGroup.name = "Forge Balance Helper";
    scene.add(balanceGroup);

    const runtime: ForgeRuntime = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      transformHelper,
      root,
      grid,
      selectionBox,
      pathGroup,
      balanceGroup,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
    };
    runtimeRef.current = runtime;

    primitiveCountRef.current.capsule = 1;
    const starter = createPrimitive("capsule", "Cápsula 01");
    root.add(starter);

    let pointerStart: { x: number; y: number; onGizmo: boolean } | null = null;
    const pointerDown = (event: PointerEvent) => {
      pointerStart = {
        x: event.clientX,
        y: event.clientY,
        onGizmo: transform.axis !== null,
      };
    };
    const pointerUp = (event: PointerEvent) => {
      if (!pointerStart) return;
      const moved = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      const skip = pointerStart.onGizmo;
      pointerStart = null;
      if (moved > 5 || skip) return;
      const rect = renderer.domElement.getBoundingClientRect();
      runtime.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      runtime.raycaster.setFromCamera(runtime.pointer, camera);
      const meshes: THREE.Object3D[] = [];
      root.traverse((child) => {
        if (child instanceof THREE.Mesh && child.visible) meshes.push(child);
      });
      const hit = runtime.raycaster.intersectObjects(meshes, false)[0];
      actionRefs.current.select(hit?.object ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);

    const draggingChanged = (event: { value: unknown }) => {
      orbit.enabled = !Boolean(event.value);
    };
    const objectChanged = () => {
      if (applyingRef.current) return;
      const object = transform.object;
      if (object) selectionBox.setFromObject(object);
      actionRefs.current.syncInspector();
    };
    const transformReleased = () => actionRefs.current.commitTransform();
    transform.addEventListener("dragging-changed", draggingChanged);
    transform.addEventListener("objectChange", objectChanged);
    transform.addEventListener("mouseUp", transformReleased);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let raf = 0;
    let previous = performance.now();
    let fpsStart = previous;
    let fpsFrames = 0;
    let lastFrameUi = previous;
    let lastBalanceUpdate = previous;
    const render = (now: number) => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (playingRef.current) {
        let next = frameRef.current + delta * FPS;
        if (next > MAX_FRAME) next %= MAX_FRAME;
        frameRef.current = next;
        actionRefs.current.applyFrame(next);
        if (now - lastFrameUi > 45) {
          setFrame(Math.round(next));
          actionRefs.current.syncInspector();
          lastFrameUi = now;
        }
        if (now - lastBalanceUpdate > 300) {
          actionRefs.current.analyzeBalance(false);
          lastBalanceUpdate = now;
        }
      }
      orbit.update();
      if (selectionBox.visible && transform.object) selectionBox.setFromObject(transform.object);
      renderer.render(scene, camera);
      fpsFrames += 1;
      if (now - fpsStart >= 600) {
        setFps(Math.round((fpsFrames * 1000) / (now - fpsStart)));
        fpsStart = now;
        fpsFrames = 0;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    actionRefs.current.refresh();
    actionRefs.current.select(starter);
    actionRefs.current.resetHistory();
    setReady(true);
    setStatus("Motion Forge pronto · selecione um objeto ou crie uma forma.");

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      transform.removeEventListener("dragging-changed", draggingChanged);
      transform.removeEventListener("objectChange", objectChanged);
      transform.removeEventListener("mouseUp", transformReleased);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      disposeTree(root);
      disposeTree(shadowFloor);
      disposeTree(selectionBox);
      clearHelper(pathGroup);
      clearHelper(balanceGroup);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) actionRefs.current.redo();
        else actionRefs.current.undo();
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        actionRefs.current.redo();
        return;
      }
      if (command && key === "d") {
        event.preventDefault();
        actionRefs.current.duplicateSelected();
        return;
      }
      if (key === "w") actionRefs.current.setMode("translate");
      if (key === "e") actionRefs.current.setMode("rotate");
      if (key === "r") actionRefs.current.setMode("scale");
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        actionRefs.current.deleteSelected();
      }
      if (event.code === "Space") {
        event.preventDefault();
        actionRefs.current.togglePlayback();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  const selectedTrack = selectedId ? keyframes[selectedId] ?? [] : [];
  const currentHasKey = selectedTrack.some((key) => key.frame === Math.round(frame));
  const selectedObject = getSelected();
  const currentParent = selectedObject?.parent === runtimeRef.current?.root
    ? "root"
    : selectedObject?.parent?.uuid ?? "root";
  const parentOptions = entries.filter((entry) => {
    if (entry.kind !== "Group" || entry.id === selectedId) return false;
    const runtime = runtimeRef.current;
    const candidate = runtime?.root.getObjectByProperty("uuid", entry.id);
    let ancestor = candidate;
    while (ancestor) {
      if (ancestor.uuid === selectedId) return false;
      ancestor = ancestor.parent ?? undefined;
    }
    return true;
  });
  const axisNames = ["X", "Y", "Z"] as const;

  return (
    <section className="forge-app" aria-label="Motion Forge, editor 3D autoral">
      <div className="forge-menubar">
        <div className="forge-product">
          <span className="forge-product-mark" aria-hidden="true">MF</span>
          <div>
            <strong>Motion Forge</strong>
            <small>LABORATÓRIO 3D · WEBGL</small>
          </div>
        </div>
        <div className="forge-file-actions" aria-label="Arquivo e histórico">
          <button type="button" onClick={newProject}>Novo</button>
          <button type="button" onClick={() => projectRef.current?.click()}>Abrir</button>
          <button type="button" onClick={saveProject}>Salvar JSON</button>
          <span className="forge-action-divider" aria-hidden="true" />
          <button type="button" onClick={() => importRef.current?.click()}>Importar GLB</button>
          <button type="button" className="forge-action-primary" onClick={exportGlb}>Exportar GLB</button>
          <span className="forge-action-divider" aria-hidden="true" />
          <button type="button" onClick={undo} disabled={!canUndo} aria-label="Desfazer">↶</button>
          <button type="button" onClick={redo} disabled={!canRedo} aria-label="Refazer">↷</button>
        </div>
        <div className="forge-runtime-badge"><i /> WEB · {fps || "—"} FPS</div>
        <input
          className="forge-visually-hidden"
          ref={importRef}
          type="file"
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"
          multiple
          onChange={importGltf}
          aria-label="Selecionar GLB, GLTF e dependências"
        />
        <input
          className="forge-visually-hidden"
          ref={projectRef}
          type="file"
          accept="application/json,.json"
          onChange={openProject}
          aria-label="Abrir projeto Motion Forge em JSON"
        />
      </div>

      <div className="forge-toolbar" aria-label="Ferramentas de criação e transformação">
        <div className="forge-tool-group forge-tool-group-primitives">
          <span>CRIAR</span>
          {PRIMITIVES.map((primitive) => (
            <button
              key={primitive.kind}
              type="button"
              onClick={() => addPrimitive(primitive.kind)}
              title={`Criar ${primitive.label}`}
              aria-label={`Criar ${primitive.label}`}
            >
              <b aria-hidden="true">{primitive.short}</b>
              <small>{primitive.label}</small>
            </button>
          ))}
        </div>
        <div className="forge-tool-group forge-tool-group-transform">
          <span>TRANSFORMAR</span>
          {([
            ["translate", "W", "Mover"],
            ["rotate", "E", "Rotacionar"],
            ["scale", "R", "Escalar"],
          ] as const).map(([toolMode, shortcut, label]) => (
            <button
              type="button"
              key={toolMode}
              className={mode === toolMode ? "forge-tool-active" : ""}
              aria-pressed={mode === toolMode}
              onClick={() => setTransformMode(toolMode)}
              title={`${label} (${shortcut})`}
            >
              <b>{shortcut}</b><small>{label}</small>
            </button>
          ))}
        </div>
        <div className="forge-tool-group forge-tool-group-options">
          <span>PRECISÃO</span>
          <button
            type="button"
            className={space === "local" ? "forge-tool-active" : ""}
            aria-pressed={space === "local"}
            onClick={() => updateSpace(space === "world" ? "local" : "world")}
          >
            <b>AX</b><small>{space === "world" ? "Global" : "Local"}</small>
          </button>
          <button
            type="button"
            className={snapEnabled ? "forge-tool-active" : ""}
            aria-pressed={snapEnabled}
            onClick={() => updateSnap(!snapEnabled)}
          >
            <b>⌁</b><small>Snap</small>
          </button>
          <button
            type="button"
            className={gridVisible ? "forge-tool-active" : ""}
            aria-pressed={gridVisible}
            onClick={() => {
              const next = !gridVisible;
              if (runtimeRef.current) runtimeRef.current.grid.visible = next;
              setGridVisible(next);
            }}
          >
            <b>#</b><small>Grade</small>
          </button>
          <button
            type="button"
            className={pathVisible ? "forge-tool-active" : ""}
            aria-pressed={pathVisible}
            onClick={() => {
              const next = !pathVisible;
              pathVisibleRef.current = next;
              setPathVisible(next);
              rebuildPath();
            }}
          >
            <b>⌇</b><small>Trilha</small>
          </button>
        </div>
      </div>

      <div className="forge-workspace">
        <aside className="forge-outliner" aria-label="Hierarquia da cena">
          <div className="forge-panel-heading">
            <div><span>CENA</span><strong>Hierarquia</strong></div>
            <small>{stats.objects} nós</small>
          </div>
          <div className="forge-scene-root"><span>◇</span> Motion Forge Scene</div>
          <div className="forge-outliner-tree" role="tree" aria-label="Objetos da cena">
            {entries.length ? entries.map((entry) => (
              <div
                className={`forge-outliner-row ${selectedId === entry.id ? "forge-outliner-selected" : ""}`}
                key={entry.id}
                role="treeitem"
                aria-selected={selectedId === entry.id}
              >
                <button
                  type="button"
                  className="forge-outliner-select"
                  style={{ paddingLeft: `${10 + entry.depth * 14}px` }}
                  onClick={() => {
                    const object = runtimeRef.current?.root.getObjectByProperty("uuid", entry.id);
                    if (object) selectObject(object);
                  }}
                >
                  <span aria-hidden="true">{entry.kind === "Group" ? "▾" : entry.kind.includes("Mesh") ? "◆" : "·"}</span>
                  <b>{entry.name}</b>
                  <small>{entry.kind.replace("Mesh", "Malha")}</small>
                </button>
                <button
                  type="button"
                  className="forge-outliner-visibility"
                  onClick={() => toggleVisibility(entry.id)}
                  aria-label={`${entry.visible ? "Ocultar" : "Exibir"} ${entry.name}`}
                  title={entry.visible ? "Ocultar" : "Exibir"}
                >
                  {entry.visible ? "◉" : "○"}
                </button>
              </div>
            )) : (
              <p className="forge-empty-state">Cena vazia. Crie uma forma ou importe um GLB.</p>
            )}
          </div>
          <div className="forge-hierarchy-actions">
            <button type="button" onClick={groupSelected} disabled={!selectedId}>Agrupar</button>
            <button type="button" onClick={elevateSelected} disabled={!selectedId || currentParent === "root"}>Elevar</button>
            <button type="button" onClick={duplicateSelected} disabled={!selectedId}>Duplicar</button>
            <button type="button" onClick={deleteSelected} disabled={!selectedId}>Excluir</button>
          </div>
          <div className="forge-shortcuts">
            <span>ATALHOS</span>
            <dl>
              <div><dt>W / E / R</dt><dd>transformar</dd></div>
              <div><dt>Ctrl D</dt><dd>duplicar</dd></div>
              <div><dt>Del</dt><dd>excluir</dd></div>
              <div><dt>Espaço</dt><dd>play / pausa</dd></div>
            </dl>
          </div>
        </aside>

        <div className="forge-stage-column">
          <div
            className="forge-viewport"
            ref={mountRef}
            tabIndex={0}
            aria-label="Viewport 3D. Arraste para orbitar, use o scroll para zoom e clique em um objeto para selecioná-lo."
          >
            {!ready && <div className="forge-viewport-loading"><i /><span>Inicializando WebGL…</span></div>}
            <div className="forge-viewport-topbar">
              <div className="forge-view-mode"><span>VISUAL</span><b>PERSPECTIVA</b></div>
              <div className="forge-camera-buttons" aria-label="Vistas da câmera">
                <button type="button" onClick={() => setCameraView("iso")} title="Perspectiva">3D</button>
                <button type="button" onClick={() => setCameraView("front")} title="Vista frontal">F</button>
                <button type="button" onClick={() => setCameraView("side")} title="Vista lateral">L</button>
                <button type="button" onClick={() => setCameraView("top")} title="Vista superior">S</button>
                <button type="button" onClick={fitSelection} disabled={!selectedId} title="Enquadrar seleção">⌖</button>
              </div>
            </div>
            <div className="forge-axis-legend" aria-hidden="true">
              <span className="forge-axis-x">X</span>
              <span className="forge-axis-y">Y</span>
              <span className="forge-axis-z">Z</span>
            </div>
            <div className="forge-selection-hud">
              <small>SELEÇÃO ATIVA</small>
              <strong>{selectedName || "Nenhum objeto"}</strong>
              <span>{selectedKind}</span>
            </div>
            <div className="forge-viewport-hint">LMB SELECIONA · RMB ORBITA · SCROLL ZOOM</div>
          </div>

          <section className="forge-timeline" aria-label="Timeline de animação de 0 a 240 frames">
            <div className="forge-timeline-controls">
              <button
                type="button"
                className="forge-play-button"
                onClick={togglePlayback}
                aria-label={playing ? "Pausar animação" : "Reproduzir animação"}
              >
                {playing ? "Ⅱ" : "▶"}
              </button>
              <button type="button" onClick={() => seek(0)} aria-label="Ir para o primeiro frame">|◀</button>
              <button type="button" onClick={() => seek(Math.max(0, frame - 1))} aria-label="Frame anterior">‹</button>
              <button type="button" onClick={() => seek(Math.min(MAX_FRAME, frame + 1))} aria-label="Próximo frame">›</button>
              <span className="forge-timecode"><b>F {String(frame).padStart(3, "0")}</b> / {MAX_FRAME}<small>{FPS} FPS · 00:{(frame / FPS).toFixed(2).padStart(5, "0")}</small></span>
              <button
                type="button"
                className={autoKey ? "forge-autokey-active" : ""}
                aria-pressed={autoKey}
                onClick={() => {
                  const next = !autoKey;
                  autoKeyRef.current = next;
                  setAutoKey(next);
                  setStatus(next ? "AutoKey ativado." : "AutoKey desativado.");
                }}
              >
                <i /> AUTO KEY
              </button>
              <button type="button" onClick={addCurrentKeyframe} disabled={!selectedId}>＋ Key</button>
              <button type="button" onClick={removeCurrentKeyframe} disabled={!currentHasKey}>− Key</button>
            </div>
            <div className="forge-track-area">
              <div className="forge-track-label">
                <strong>{selectedName || "Objeto"}</strong>
                <small>TRANSFORM</small>
              </div>
              <div className="forge-track-ruler">
                <div className="forge-ruler-labels" aria-hidden="true">
                  {[0, 30, 60, 90, 120, 150, 180, 210, 240].map((tick) => <span key={tick}>{tick}</span>)}
                </div>
                <div className="forge-key-markers">
                  {selectedTrack.map((key) => (
                    <button
                      type="button"
                      key={key.frame}
                      className="forge-key-marker"
                      style={{ left: `${(key.frame / MAX_FRAME) * 100}%` }}
                      onClick={() => seek(key.frame)}
                      aria-label={`Ir ao keyframe ${key.frame}`}
                      title={`Keyframe ${key.frame}`}
                    />
                  ))}
                </div>
                <input
                  className="forge-frame-slider"
                  type="range"
                  min={0}
                  max={MAX_FRAME}
                  value={frame}
                  onChange={(event) => {
                    setPlayback(false);
                    seek(Number(event.target.value));
                  }}
                  aria-label="Frame atual"
                />
              </div>
            </div>
            <div className="forge-presets">
              <span>PRESETS AUTORAIS</span>
              <button type="button" onClick={() => applyPreset("bounce")}>↕ Salto</button>
              <button type="button" onClick={() => applyPreset("spin")}>↻ Giro</button>
              <button type="button" onClick={() => applyPreset("arc")}>⌒ Arco</button>
              <small>Os presets geram keyframes editáveis; nada fica “travado”.</small>
            </div>
          </section>
        </div>

        <aside className="forge-inspector" aria-label="Inspetor do objeto selecionado">
          <div className="forge-panel-heading">
            <div><span>PROPRIEDADES</span><strong>Inspetor</strong></div>
            <small>{selectedKind}</small>
          </div>
          {selectedId ? (
            <div className="forge-inspector-content">
              <section className="forge-property-section">
                <div className="forge-property-title"><span>01</span><strong>Objeto</strong></div>
                <label className="forge-field">
                  <span>Nome</span>
                  <input
                    value={selectedName}
                    onChange={(event) => setSelectedName(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="forge-field">
                  <span>Parente</span>
                  <select value={currentParent} onChange={(event) => reparentSelected(event.target.value)}>
                    <option value="root">Raiz da cena</option>
                    {parentOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </select>
                </label>
              </section>

              {([
                ["position", "Posição", transformValue.position, 1],
                ["rotation", "Rotação", transformValue.rotation.map(THREE.MathUtils.radToDeg) as Vec3Tuple, 5],
                ["scale", "Escala", transformValue.scale, 0.1],
              ] as const).map(([section, label, values, step]) => (
                <section className="forge-property-section" key={section}>
                  <div className="forge-property-title"><span>{section === "position" ? "02" : section === "rotation" ? "03" : "04"}</span><strong>{label}</strong></div>
                  <div className="forge-vector-fields">
                    {axisNames.map((axis, index) => (
                      <label key={axis} className={`forge-axis-field forge-axis-field-${axis.toLowerCase()}`}>
                        <span>{axis}</span>
                        <input
                          type="number"
                          step={step}
                          value={Number(values[index].toFixed(3))}
                          onChange={(event) => setTransformField(section, index as 0 | 1 | 2, Number(event.target.value))}
                          aria-label={`${label} ${axis}`}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              ))}

              <section className="forge-property-section forge-material-section">
                <div className="forge-property-title"><span>05</span><strong>Material PBR</strong></div>
                <label className="forge-color-field">
                  <span>Cor base</span>
                  <input
                    type="color"
                    value={materialValue.color}
                    onChange={(event) => setMaterialField("color", event.target.value)}
                  />
                  <code>{materialValue.color.toUpperCase()}</code>
                </label>
                <label className="forge-slider-field">
                  <span>Metalness <b>{materialValue.metalness.toFixed(2)}</b></span>
                  <input type="range" min={0} max={1} step={0.01} value={materialValue.metalness} onChange={(event) => setMaterialField("metalness", Number(event.target.value))} />
                </label>
                <label className="forge-slider-field">
                  <span>Roughness <b>{materialValue.roughness.toFixed(2)}</b></span>
                  <input type="range" min={0} max={1} step={0.01} value={materialValue.roughness} onChange={(event) => setMaterialField("roughness", Number(event.target.value))} />
                </label>
                <label className="forge-check-field">
                  <input type="checkbox" checked={materialValue.wireframe} onChange={(event) => setMaterialField("wireframe", event.target.checked)} />
                  <span>Exibir wireframe</span>
                </label>
              </section>

              <section className="forge-property-section forge-balance-section">
                <div className="forge-property-title"><span>06</span><strong>Balance Assist</strong></div>
                <p>Estimativa autoral baseada no volume e na base de apoio das malhas — não é uma simulação física.</p>
                <button type="button" onClick={() => analyzeBalance(true)}>◎ Analisar centro de massa</button>
                {balance && (
                  <div className={`forge-balance-result ${balance.stable ? "forge-balance-stable" : "forge-balance-warning"}`}>
                    <div><span>ESTABILIDADE</span><strong>{balance.score}%</strong></div>
                    <div className="forge-balance-meter"><i style={{ width: `${balance.score}%` }} /></div>
                    <dl>
                      <div><dt>COM X</dt><dd>{balance.position[0].toFixed(2)}</dd></div>
                      <div><dt>COM Y</dt><dd>{balance.position[1].toFixed(2)}</dd></div>
                      <div><dt>COM Z</dt><dd>{balance.position[2].toFixed(2)}</dd></div>
                    </dl>
                    <small>{balance.stable ? "Centro projetado dentro da base segura." : "Revise apoio ou distribua o volume."}</small>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="forge-inspector-empty"><span>◇</span><strong>Nada selecionado</strong><p>Clique em uma malha no viewport ou escolha um item na hierarquia.</p></div>
          )}
        </aside>
      </div>

      <footer className="forge-statusbar">
        <p role="status" aria-live="polite"><i /> {status}</p>
        <dl aria-label="Contadores da cena">
          <div><dt>OBJETOS</dt><dd>{stats.objects}</dd></div>
          <div><dt>MALHAS</dt><dd>{stats.meshes}</dd></div>
          <div><dt>VÉRTICES</dt><dd>{humanCount(stats.vertices)}</dd></div>
          <div><dt>TRIÂNGULOS</dt><dd>{humanCount(stats.triangles)}</dd></div>
          <div><dt>KEYS</dt><dd>{Object.values(keyframes).reduce((sum, track) => sum + track.length, 0)}</dd></div>
        </dl>
        <span className="forge-disclaimer">NÚCLEO WEB AUTORAL · NÃO SUBSTITUI BLENDER OU CASCADEUR</span>
      </footer>
    </section>
  );
}
