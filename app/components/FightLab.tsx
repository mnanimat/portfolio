"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Fighter = {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
};

const DURATION = 8;
const MOVES = [
  "Guarda inicial",
  "Rain · jab vetorial",
  "Snow · esquiva orbital",
  "Snow · chute crescente",
  "Rain · bloqueio cruzado",
  "Impacto · câmera lenta",
  "Recuperação de equilíbrio",
  "Loop pronto",
];

function limb(
  color: THREE.ColorRepresentation,
  length = 0.82,
  radius = 0.095,
) {
  const pivot = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.42,
  });
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.12, length - radius * 2), 4, 10),
    material,
  );
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

function createFighter(
  primary: THREE.ColorRepresentation,
  accent: THREE.ColorRepresentation,
): Fighter {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: primary,
    roughness: 0.26,
    metalness: 0.52,
    emissive: new THREE.Color(primary).multiplyScalar(0.08),
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.2,
    metalness: 0.68,
    emissive: new THREE.Color(accent).multiplyScalar(0.28),
  });

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.58, 6, 14), bodyMaterial);
  chest.scale.set(1.12, 1, 0.72);
  chest.position.y = 1.62;
  chest.castShadow = true;
  torso.add(chest);

  const core = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 32), accentMaterial);
  core.position.set(0, 1.64, 0.25);
  core.rotation.x = Math.PI / 2;
  torso.add(core);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 2), bodyMaterial);
  head.position.y = 2.28;
  head.castShadow = true;
  torso.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.055, 0.035), accentMaterial);
  visor.position.set(0, 2.3, 0.225);
  torso.add(visor);

  const armL = limb(primary, 0.72, 0.085);
  const armR = limb(primary, 0.72, 0.085);
  armL.position.set(-0.42, 1.94, 0);
  armR.position.set(0.42, 1.94, 0);
  torso.add(armL, armR);

  const forearmL = limb(accent, 0.62, 0.075);
  const forearmR = limb(accent, 0.62, 0.075);
  forearmL.position.y = -0.7;
  forearmR.position.y = -0.7;
  armL.add(forearmL);
  armR.add(forearmR);

  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.22, 4, 12), bodyMaterial);
  hips.rotation.z = Math.PI / 2;
  hips.position.y = 1.04;
  hips.castShadow = true;
  torso.add(hips);

  const legL = limb(primary, 1.05, 0.12);
  const legR = limb(primary, 1.05, 0.12);
  legL.position.set(-0.2, 1.02, 0);
  legR.position.set(0.2, 1.02, 0);
  torso.add(legL, legR);

  return { root, torso, head, armL, armR, forearmL, forearmR, legL, legR };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const pulse = (time: number, start: number, peak: number, end: number) =>
  time < peak ? ease((time - start) / (peak - start)) : 1 - ease((time - peak) / (end - peak));

function poseFighters(rain: Fighter, snow: Fighter, time: number) {
  const breathing = Math.sin(time * 3.2) * 0.025;
  rain.root.position.set(-1.12, 0, 0);
  snow.root.position.set(1.12, 0, 0);
  rain.root.rotation.y = Math.PI / 2;
  snow.root.rotation.y = -Math.PI / 2;
  rain.torso.position.y = breathing;
  snow.torso.position.y = -breathing;

  rain.armL.rotation.set(0.18, 0, 0.72);
  rain.armR.rotation.set(-0.25, 0, -0.82);
  rain.forearmL.rotation.set(0, 0, -1.28);
  rain.forearmR.rotation.set(0, 0, 1.35);
  rain.legL.rotation.set(0.04, 0, 0.08);
  rain.legR.rotation.set(-0.04, 0, -0.08);
  snow.armL.rotation.set(-0.18, 0, 0.82);
  snow.armR.rotation.set(0.25, 0, -0.72);
  snow.forearmL.rotation.set(0, 0, -1.35);
  snow.forearmR.rotation.set(0, 0, 1.28);
  snow.legL.rotation.set(-0.04, 0, 0.08);
  snow.legR.rotation.set(0.04, 0, -0.08);
  rain.torso.rotation.set(0, 0, 0);
  snow.torso.rotation.set(0, 0, 0);

  const jab = pulse(time, 0.7, 1.35, 2.05);
  rain.armR.rotation.z -= jab * 1.42;
  rain.forearmR.rotation.z -= jab * 1.12;
  rain.root.position.x += jab * 0.35;
  rain.torso.rotation.z -= jab * 0.12;

  const dodge = pulse(time, 1.25, 2.05, 2.9);
  snow.torso.rotation.z -= dodge * 0.62;
  snow.head.position.x = dodge * 0.25;
  snow.root.position.z -= dodge * 0.34;

  const kick = pulse(time, 2.55, 3.55, 4.55);
  snow.legL.rotation.z += kick * 1.82;
  snow.legL.rotation.x -= kick * 0.75;
  snow.torso.rotation.z += kick * 0.38;
  snow.root.position.x -= kick * 0.24;

  const block = pulse(time, 3.25, 4.2, 5.05);
  rain.armL.rotation.z -= block * 1.35;
  rain.forearmL.rotation.z += block * 1.15;
  rain.armR.rotation.z += block * 0.65;

  const impact = pulse(time, 4.75, 5.35, 6.4);
  rain.root.position.x -= impact * 0.5;
  snow.root.position.x += impact * 0.2;
  rain.torso.rotation.z += impact * 0.4;
  snow.torso.rotation.z -= impact * 0.18;
  rain.head.rotation.z = impact * 0.26;

  const recover = ease((time - 6.05) / 1.7);
  if (time > 6.05) {
    rain.torso.rotation.z *= 1 - recover;
    snow.torso.rotation.z *= 1 - recover;
  }

  return impact;
}

export default function FightLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [move, setMove] = useState(MOVES[0]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050812, 0.095);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 2.1, 6.7);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x050812, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4.5;
    controls.maxDistance = 9;
    controls.target.set(0, 1.35, 0);

    const ambient = new THREE.HemisphereLight(0x79f6ff, 0x17051f, 1.65);
    const key = new THREE.SpotLight(0x67f5ff, 75, 16, Math.PI / 5, 0.55, 1.2);
    key.position.set(-4, 6, 4);
    key.castShadow = true;
    const rim = new THREE.PointLight(0xff3aac, 42, 10, 2);
    rim.position.set(4, 2.6, -2.5);
    scene.add(ambient, key, rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.3, 96),
      new THREE.MeshStandardMaterial({ color: 0x080c18, metalness: 0.82, roughness: 0.36 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const rings = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.35 + index * 0.72, 0.006, 4, 96),
        new THREE.MeshBasicMaterial({ color: index % 2 ? 0xff2e9f : 0x5cecff, transparent: true, opacity: 0.34 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.012;
      rings.add(ring);
    }
    scene.add(rings);

    const rain = createFighter(0x8b3dff, 0xff42b4);
    const snow = createFighter(0xeafcff, 0x54efff);
    scene.add(rain.root, snow.root);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let raf = 0;
    let previous = performance.now();
    let lastUiUpdate = 0;
    const render = (now: number) => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (playingRef.current) {
        timeRef.current = (timeRef.current + delta * speedRef.current) % DURATION;
      }
      const impact = poseFighters(rain, snow, timeRef.current);
      rings.rotation.z = timeRef.current * 0.06;
      rim.intensity = 42 + impact * 78;
      camera.position.x = Math.sin(timeRef.current * 0.18) * 0.24 + Math.sin(now * 0.045) * impact * 0.045;
      controls.update();
      renderer.render(scene, camera);
      if (now - lastUiUpdate > 70) {
        setTime(timeRef.current);
        setMove(MOVES[Math.min(MOVES.length - 1, Math.floor(timeRef.current))]);
        lastUiUpdate = now;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const scrub = (value: number) => {
    const next = (value / 1000) * DURATION;
    timeRef.current = next;
    setTime(next);
    setMove(MOVES[Math.min(MOVES.length - 1, Math.floor(next))]);
  };

  return (
    <div className="fight-lab">
      <div className="fight-stage" ref={mountRef} aria-label="Animática 3D interativa da luta Rain contra Snow">
        <div className="fight-stage__hud fight-stage__hud--left">
          <span>RAIN</span>
          <small>energia / precisão</small>
        </div>
        <div className="fight-stage__hud fight-stage__hud--right">
          <span>SNOW</span>
          <small>fluxo / contra-ataque</small>
        </div>
        <div className="fight-stage__move"><span>TAKE 01</span>{move}</div>
      </div>

      <div className="fight-controls" aria-label="Controles da animática">
        <button className="icon-button" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pausar luta" : "Reproduzir luta"}>
          {playing ? "Ⅱ" : "▶"}
        </button>
        <span className="timecode">00:{time.toFixed(2).padStart(5, "0")} / 00:08.00</span>
        <input
          aria-label="Tempo da luta"
          type="range"
          min="0"
          max="1000"
          value={Math.round((time / DURATION) * 1000)}
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <button className="chip-button" type="button" onClick={() => setSpeed((value) => (value === 1 ? 0.35 : value === 0.35 ? 0.65 : 1))}>
          {speed.toFixed(2).replace(".00", "")}×
        </button>
        <button className="chip-button" type="button" onClick={() => { timeRef.current = 0; setTime(0); }}>
          Reiniciar
        </button>
      </div>

      <div className="license-strip">
        <div>
          <span className="eyebrow">PRODUÇÃO LICENCIADA</span>
          <p>Animática autoral de coreografia. A produção final receberá os rigs oficiais Rain v3 e Snow v4 quando os arquivos licenciados forem adicionados.</p>
        </div>
        <div className="license-strip__links">
          <a href="https://studio.blender.org/characters/rain/" target="_blank" rel="noreferrer">Rain Rig · Blender Foundation ↗</a>
          <a href="https://studio.blender.org/characters/snow/" target="_blank" rel="noreferrer">Snow Rig · Blender Foundation ↗</a>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0 ↗</a>
        </div>
      </div>
    </div>
  );
}
