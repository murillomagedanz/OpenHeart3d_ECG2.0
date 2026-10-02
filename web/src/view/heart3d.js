// Coração 3D procedural e didático. A animação é comandada por eventos vindos do
// detector de QRS: a sístole ventricular começa no R detectado; a contração atrial
// é ESTIMADA a partir do RR médio (antecipando o próximo P), e assim rotulada.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const VENT_RISE = 0.08;
const VENT_HOLD = 0.2;
const VENT_FALL = 0.25;
const ATRIAL_LEAD = 0.16; // PR aproximado: átrio contrai ~160 ms antes do R
const ATRIAL_DUR = 0.12;

function envelope(dt, rise, hold, fall) {
  if (dt < 0) return 0;
  if (dt < rise) return dt / rise;
  if (dt < rise + hold) return 1;
  if (dt < rise + hold + fall) return 1 - (dt - rise - hold) / fall;
  return 0;
}

function smooth(e) { return e * e * (3 - 2 * e); }

export class Heart3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 7);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 4, 5);
    this.scene.add(key);

    this._build();
    this.lastR = -Infinity;
    this.rrMean = null;
    this.phaseLabel = '—';
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
  }

  _material(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  }

  _build() {
    const heart = new THREE.Group();
    heart.rotation.z = -0.35; // ápice apontando para a esquerda-inferior do paciente

    this.ventricles = new THREE.Group();
    const lv = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), this._material(0xb3323f));
    lv.scale.set(1.05, 1.5, 1.0);
    lv.position.set(0.25, -0.55, 0);
    const rv = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), this._material(0x8f2a37));
    rv.scale.set(0.9, 1.25, 0.8);
    rv.position.set(-0.7, -0.35, 0.3);
    this.ventricles.add(lv, rv);

    this.atria = new THREE.Group();
    const la = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 40), this._material(0xc96a74));
    la.position.set(0.55, 1.05, -0.35);
    const ra = new THREE.Mesh(new THREE.SphereGeometry(0.65, 40, 40), this._material(0xb95a66));
    ra.position.set(-0.75, 0.95, 0.15);
    this.atria.add(la, ra);

    const aorta = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.19, 20, 40, Math.PI), this._material(0xd9646e));
    aorta.position.set(0.05, 1.5, -0.1);
    const pulm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.2, 24), this._material(0x5a6fb5));
    pulm.position.set(-0.35, 1.45, 0.5);
    pulm.rotation.z = 0.3;

    heart.add(this.ventricles, this.atria, aorta, pulm);
    this.scene.add(heart);
    this.heart = heart;
    this.ventMeshes = [lv, rv];
    this.atrialMeshes = [la, ra];
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    // Garante que ~±2,4 unidades caibam na horizontal mesmo em painéis estreitos.
    const dist = this.camera.position.length();
    const halfH = Math.atan(2.4 / dist);
    const vfov = 2 * Math.atan(Math.tan(halfH) / this.camera.aspect) * (180 / Math.PI);
    this.camera.fov = Math.max(40, vfov);
    this.camera.updateProjectionMatrix();
  }

  onQrs(tSignal, rrMean) {
    this.lastR = tSignal;
    if (rrMean) this.rrMean = rrMean;
  }

  // tSignal: tempo atual do sinal (s). A animação acompanha o relógio do ECG.
  update(tSignal) {
    const sinceR = tSignal - this.lastR;
    const vEnv = smooth(envelope(sinceR, VENT_RISE, VENT_HOLD, VENT_FALL));

    let aEnv = 0;
    if (this.rrMean && Number.isFinite(this.lastR)) {
      const nextR = this.lastR + this.rrMean;
      const atrialStart = nextR - ATRIAL_LEAD;
      aEnv = smooth(envelope(tSignal - atrialStart, ATRIAL_DUR * 0.4, 0, ATRIAL_DUR * 0.6));
    }

    const vs = 1 - 0.13 * vEnv;
    this.ventricles.scale.set(vs, 1 - 0.09 * vEnv, vs);
    const as = 1 - 0.14 * aEnv + 0.05 * vEnv; // átrios enchem durante a sístole ventricular
    this.atria.scale.set(as, as, as);

    for (const m of this.ventMeshes) m.material.emissive.setRGB(0.45 * vEnv, 0.08 * vEnv, 0.1 * vEnv);
    for (const m of this.atrialMeshes) m.material.emissive.setRGB(0.35 * aEnv, 0.25 * aEnv, 0.1 * aEnv);

    if (!Number.isFinite(this.lastR)) this.phaseLabel = 'aguardando QRS';
    else if (vEnv > 0.05) this.phaseLabel = 'sístole ventricular (R detectado)';
    else if (aEnv > 0.05) this.phaseLabel = 'contração atrial (estimada pelo RR)';
    else this.phaseLabel = 'diástole';

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
