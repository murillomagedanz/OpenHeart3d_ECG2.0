// Coração 3D comandado pelos eventos detectados no ECG. A sístole ventricular começa
// no R detectado; a contração atrial é ESTIMADA a partir do RR médio (antecipando o
// próximo P) e assim rotulada. A animação indica SINCRONIZAÇÃO TEMPORAL com os eventos
// elétricos — não anatomia, contratilidade nem força reais.
//
// Dois modelos: o procedural (padrão público, didático) e, opcionalmente, um modelo
// anatômico ilustrativo carregado por `setModel(gltf)` (asset licenciado, distribuído
// cifrado). Se o modelo traz clipes de animação, o tempo de cada clipe é posicionado
// MANUALMENTE pelos envelopes do ECG (nunca autoplay: é o sinal que comanda). Sem clipes,
// as partes são escaladas/iluminadas como no procedural.
//
// Câmera: alvo fixo no centro do coração, giro em torno do eixo longo (vertical), zoom
// limitado, vistas predefinidas com transição suave. Camadas, raio-X e plano de corte são
// filtros de exibição, não medidas.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  VENT_RISE, VENT_HOLD, VENT_FALL, ATRIAL_LEAD, ATRIAL_RISE, ATRIAL_FALL, envelope, smooth, clipTime,
} from './envelopes.js';

const MODEL_HEIGHT = 3.9; // extensão-alvo do eixo longo, em unidades de cena
const CAMERA_DISTANCE = 7;
const VIEW_TRANSITION_MS = 650;

export const LAYERS = ['ventriculos', 'atrios', 'vasos'];
export const LAYER_LABELS = { ventriculos: 'Ventrículos', atrios: 'Átrios / topo', vasos: 'Aorta / grandes vasos' };
export const PROCEDURAL_LABEL = 'modelo procedural didático';
export const ANATOMICAL_LABEL = 'modelo anatômico ilustrativo (asset licenciado)';

// Direções da câmera em relação ao PACIENTE (frente = +Z; esquerda do paciente = +X).
export const VIEWS = {
  anterior: [0, 0, 1], posterior: [0, 0, -1], esquerda: [1, 0, 0], direita: [-1, 0, 0],
  superior: [0, 1, 0.0005], inferior: [0, -1, 0.0005],
};
export const VIEW_LABELS = {
  anterior: 'Anterior', posterior: 'Posterior', esquerda: 'Lateral esq.', direita: 'Lateral dir.',
  superior: 'Superior (base)', inferior: 'Inferior (ápice)',
};

const HINT_LAYER = { ventricles: 'ventriculos', atria: 'atrios', vessels: 'vasos' };

function layerByName(name) {
  const n = String(name).toLowerCase();
  if (/ventric/.test(n)) return 'ventriculos';
  if (/aort|pulm|vess|vaso|arter|vein|veia/.test(n)) return 'vasos';
  if (/atri|top|base|auric/.test(n)) return 'atrios';
  return null;
}

function clipKind(name) {
  const n = String(name).toLowerCase();
  if (/ventric/.test(n)) return 'ventriculos';
  if (/atri|top/.test(n)) return 'atrios';
  return null;
}

export class Heart3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, CAMERA_DISTANCE);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false; // alvo sempre no centro do coração
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 14;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 4, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde6ff, 0.35);
    fill.position.set(-4, -2, -3);
    this.scene.add(fill);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.display = {
      layers: Object.fromEntries(LAYERS.map((l) => [l, { visible: true, opacity: 1 }])),
      xray: false,
      clip: { enabled: false, axis: 'x', position: 0 },
    };
    this.viewTween = null;
    this.model = null;
    this.modelLabel = PROCEDURAL_LABEL;

    this._buildProcedural();
    this._bindLayers(this.procedural, this.proceduralParts);
    this.reset();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
  }

  _material(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  }

  _buildProcedural() {
    const heart = new THREE.Group();
    heart.rotation.z = -0.35; // ápice apontando para a esquerda-inferior do paciente

    this.ventricles = new THREE.Group();
    const lv = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), this._material(0xb3323f));
    lv.name = 'ventrículo esquerdo';
    lv.scale.set(1.05, 1.5, 1.0);
    lv.position.set(0.25, -0.55, 0);
    const rv = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), this._material(0x8f2a37));
    rv.name = 'ventrículo direito';
    rv.scale.set(0.9, 1.25, 0.8);
    rv.position.set(-0.7, -0.35, 0.3);
    this.ventricles.add(lv, rv);

    this.atria = new THREE.Group();
    const la = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 40), this._material(0xc96a74));
    la.name = 'átrio esquerdo';
    la.position.set(0.55, 1.05, -0.35);
    const ra = new THREE.Mesh(new THREE.SphereGeometry(0.65, 40, 40), this._material(0xb95a66));
    ra.name = 'átrio direito';
    ra.position.set(-0.75, 0.95, 0.15);
    this.atria.add(la, ra);

    const aorta = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.19, 20, 40, Math.PI), this._material(0xd9646e));
    aorta.name = 'aorta';
    aorta.position.set(0.05, 1.5, -0.1);
    const pulm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.2, 24), this._material(0x5a6fb5));
    pulm.name = 'tronco pulmonar';
    pulm.position.set(-0.35, 1.45, 0.5);
    pulm.rotation.z = 0.3;

    heart.add(this.ventricles, this.atria, aorta, pulm);
    this.scene.add(heart);
    this.procedural = heart;
    this.proceduralParts = { ventriculos: [lv, rv], atrios: [la, ra], vasos: [aorta, pulm] };
    this.ventMeshes = [lv, rv];
    this.atrialMeshes = [la, ra];
  }

  // Associa as malhas de cada camada (de qualquer modelo) e cria a sobreposição de malha
  // para o modo raio-X. Materiais são clonados por malha para que opacidade e corte não
  // vazem entre camadas.
  _bindLayers(root, nodesByLayer) {
    const layers = {};
    const sourceMaterials = new Set();
    for (const layer of LAYERS) {
      const meshes = [];
      for (const obj of nodesByLayer[layer] ?? []) obj.traverse((o) => { if (o.isMesh && !o.userData.oh3dIsWire) meshes.push(o); });
      for (const mesh of meshes) {
        for (const material of this._materialsOf(mesh)) sourceMaterials.add(material);
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
        else mesh.material = mesh.material.clone();
        const wireMat = new THREE.MeshBasicMaterial({ color: 0xffc9d0, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false });
        let wire;
        if (mesh.isSkinnedMesh) {
          wire = new THREE.SkinnedMesh(mesh.geometry, wireMat);
          wire.bindMode = mesh.bindMode;
          wire.bind(mesh.skeleton, mesh.bindMatrix);
        } else wire = new THREE.Mesh(mesh.geometry, wireMat);
        wire.name = `${mesh.name} (malha)`;
        wire.visible = false;
        wire.userData.oh3dIsWire = true;
        mesh.add(wire);
        mesh.userData.oh3dWire = wire;
      }
      layers[layer] = meshes;
    }
    root.userData.oh3dLayers = layers;
    root.userData.oh3dSourceMaterials = sourceMaterials;
    this.layerMeshes = layers;
    this._applyDisplay();
  }

  _materialsOf(mesh) { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }

  _applyDisplay() {
    const { layers, xray, clip } = this.display;
    const planes = clip.enabled ? [this.clipPlane] : [];
    for (const layer of LAYERS) {
      const st = layers[layer];
      for (const mesh of this.layerMeshes[layer] ?? []) {
        mesh.visible = st.visible;
        const opacity = xray ? Math.min(st.opacity, 0.22) : st.opacity;
        for (const m of this._materialsOf(mesh)) {
          m.userData.oh3dSide ??= m.side;
          m.transparent = opacity < 1;
          m.opacity = opacity;
          m.depthWrite = opacity >= 1;
          m.clippingPlanes = planes;
          m.side = clip.enabled ? THREE.DoubleSide : m.userData.oh3dSide; // corte mostra o interior
          m.needsUpdate = true;
        }
        const wire = mesh.userData.oh3dWire;
        if (wire) {
          wire.visible = xray;
          wire.material.clippingPlanes = planes;
          wire.material.needsUpdate = true;
        }
      }
    }
    const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[clip.axis] ?? [1, 0, 0];
    this.clipPlane.normal.set(...axis);
    // Mantém o lado "normal·p + c ≥ 0": com posição −1 nada é cortado; com +1, tudo.
    this.clipPlane.constant = -clip.position * (MODEL_HEIGHT * 0.56);
  }

  // --- Filtros de exibição -------------------------------------------------------------

  setLayerVisible(layer, visible) { if (this.display.layers[layer]) { this.display.layers[layer].visible = !!visible; this._applyDisplay(); } }
  setLayerOpacity(layer, opacity) { if (this.display.layers[layer]) { this.display.layers[layer].opacity = Math.min(1, Math.max(0, opacity)); this._applyDisplay(); } }
  setXray(on) { this.display.xray = !!on; this._applyDisplay(); }
  setClip({ enabled, axis, position } = {}) {
    const c = this.display.clip;
    if (enabled !== undefined) c.enabled = !!enabled;
    if (axis !== undefined) c.axis = axis;
    if (position !== undefined) c.position = Math.min(1, Math.max(-1, position));
    this._applyDisplay();
  }
  setAutoRotate(on) { this.controls.autoRotate = !!on; }

  // Vista predefinida: mantém a distância atual e desliza a câmera até a direção pedida.
  setView(name, animate = true) {
    const dir = VIEWS[name];
    if (!dir) return;
    const distance = this.camera.position.length();
    const to = new THREE.Vector3(...dir).normalize().multiplyScalar(distance);
    if (!animate) { this.camera.position.copy(to); this.viewTween = null; return; }
    this.viewTween = { from: this.camera.position.clone(), to, start: performance.now() };
  }

  _stepViewTween(now) {
    const tw = this.viewTween;
    if (!tw) return;
    const k = Math.min(1, (now - tw.start) / VIEW_TRANSITION_MS);
    const e = smooth(k);
    // Interpola direção (no arco) e distância separadamente para contornar o alvo.
    const d0 = tw.from.length(); const d1 = tw.to.length();
    const a = tw.from.clone().normalize(); const b = tw.to.clone().normalize();
    const dot = Math.min(1, Math.max(-1, a.dot(b)));
    const omega = Math.acos(dot);
    let dir;
    if (omega < 1e-4) dir = b.clone();
    else if (Math.PI - omega < 1e-3) { // direções opostas: passa por cima
      const up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(a.dot(up)) > 0.99) up.set(0, 0, 1);
      const mid = a.clone().add(up).normalize();
      dir = e < 0.5 ? a.clone().lerp(mid, e * 2).normalize() : mid.clone().lerp(b, (e - 0.5) * 2).normalize();
    } else {
      dir = a.clone().multiplyScalar(Math.sin((1 - e) * omega) / Math.sin(omega)).add(b.clone().multiplyScalar(Math.sin(e * omega) / Math.sin(omega)));
    }
    this.camera.position.copy(dir.multiplyScalar(d0 + (d1 - d0) * e));
    if (k >= 1) this.viewTween = null;
  }

  // --- Modelo anatômico opcional -------------------------------------------------------

  _disposeModel() {
    const { root, gltf, mixer } = this.model;
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    const geometries = new Set();
    const materials = new Set(root.userData.oh3dSourceMaterials);
    const textures = new Set();
    const skeletons = new Set();
    root.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) for (const material of this._materialsOf(node)) materials.add(material);
      if (node.skeleton) skeletons.add(node.skeleton);
    });
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    this.scene.remove(root);
    this.model = null;
  }

  // gltf: resultado de GLTFLoader.parse(). null volta ao procedural.
  setModel(gltf) {
    if (this.model) {
      this._disposeModel();
    }
    if (!gltf) {
      this.procedural.visible = true;
      this.layerMeshes = this.procedural.userData.oh3dLayers;
      this.modelLabel = PROCEDURAL_LABEL;
      this._applyDisplay();
      return;
    }
    const hints = gltf.scene.userData?.oh3d ?? {};
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clips = {};
    for (const clip of gltf.animations ?? []) {
      const kind = clipKind(clip.name);
      if (!kind || clips[kind]) continue;
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.time = 0;
      const hint = Object.values(hints.clips ?? {}).find((h) => h.name === clip.name);
      const peak = hint?.peak != null ? Math.min(hint.peak, clip.duration) : clip.duration / 2;
      clips[kind] = { action, peak, duration: clip.duration };
    }
    mixer.update(0); // pose relaxada (tempo 0 de cada clipe)
    gltf.scene.updateMatrixWorld(true);

    // Nós por camada: dicas do arquivo, senão pelo nome.
    const byLayer = { ventriculos: [], atrios: [], vasos: [] };
    const hinted = new Set();
    for (const [key, names] of Object.entries(hints.layers ?? {})) {
      const layer = HINT_LAYER[key];
      for (const name of names ?? []) {
        const obj = gltf.scene.getObjectByName(name);
        if (layer && obj) { byLayer[layer].push(obj); hinted.add(obj); }
      }
    }
    gltf.scene.traverse((o) => {
      if (!o.isMesh || hinted.has(o)) return;
      for (let p = o; p; p = p.parent) if (hinted.has(p)) return;
      const layer = layerByName(o.name) ?? layerByName(o.parent?.name) ?? 'ventriculos';
      byLayer[layer].push(o);
      hinted.add(o);
    });

    // Centraliza, alinha o eixo longo com Y e normaliza o tamanho (pose relaxada).
    const finiteBox = (b) => !b.isEmpty() && [b.min, b.max].every((v) => Number.isFinite(v.x + v.y + v.z));
    let box = new THREE.Box3().setFromObject(gltf.scene, true);
    if (!finiteBox(box)) box = new THREE.Box3().setFromObject(gltf.scene, false);
    const size = finiteBox(box) ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
    const center = finiteBox(box) ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const pivot = new THREE.Group();
    gltf.scene.position.sub(center);
    pivot.add(gltf.scene);
    if (size.x >= size.y && size.x >= size.z) pivot.rotation.z = Math.PI / 2;
    else if (size.z >= size.y && size.z >= size.x) pivot.rotation.x = -Math.PI / 2;
    const longest = Math.max(size.x, size.y, size.z);
    pivot.scale.setScalar(Number.isFinite(longest) && longest > 0 ? MODEL_HEIGHT / longest : 1);
    const root = new THREE.Group();
    root.name = 'modelo anatômico';
    const o = hints.orientation ?? {};
    root.rotation.set(o.pitch ?? 0, o.yaw ?? 0, o.roll ?? 0);
    root.add(pivot);

    // Sem clipe para uma camada, a parte é escalada em torno do próprio centro.
    const scaled = {};
    for (const layer of LAYERS) {
      scaled[layer] = byLayer[layer].map((node) => {
        const b = new THREE.Box3().setFromObject(node, true);
        const c = node.parent ? node.parent.worldToLocal(b.getCenter(new THREE.Vector3())) : b.getCenter(new THREE.Vector3());
        return { node, center: c, position: node.position.clone(), scale: node.scale.clone() };
      });
    }

    this.procedural.visible = false;
    this.scene.add(root);
    this.model = { root, gltf, mixer, clips, scaled };
    this._bindLayers(root, byLayer);
    this.modelLabel = ANATOMICAL_LABEL;
  }

  get hasAnimatedModel() { return !!(this.model && Object.keys(this.model.clips).length); }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    // Garante que ~±2,4 unidades caibam na horizontal mesmo em painéis estreitos
    // (na distância de referência; o zoom do usuário não altera o FOV).
    const halfH = Math.atan(2.4 / CAMERA_DISTANCE);
    const vfov = 2 * Math.atan(Math.tan(halfH) / this.camera.aspect) * (180 / Math.PI);
    this.camera.fov = Math.max(40, vfov);
    // Centraliza o coração na área livre acima do painel de estado que cobre a base do quadro.
    const inset = Math.min(r.height * 0.45, this.bottomInset || 0);
    this.camera.setViewOffset(r.width, r.height, 0, inset / 2, r.width, r.height);
    this.camera.updateProjectionMatrix();
  }

  // Altura (px) ocupada por sobreposições na base do painel (painel de estado).
  setBottomInset(px) { this.bottomInset = Math.max(0, px || 0); this._resize(); }

  // tDetected: instante do sinal em que o QRS foi declarado — a contração começa
  // AQUI, suavemente, sem "pular" os ~125 ms de latência do detector.
  // tR: instante estimado do pico R (retroativo), usado só para prever o próximo
  // ciclo (contração atrial estimada pelo RR).
  onQrs(tDetected, rrMean, tR = tDetected) {
    this.lastR = tDetected;
    this.lastRTrue = tR;
    if (rrMean) this.rrMean = rrMean;
  }

  // Esquece o histórico de eventos (troca de fonte ou reinício do registro).
  reset() {
    this.lastR = -Infinity;
    this.lastRTrue = -Infinity;
    this.rrMean = null;
    this.phaseLabel = '—';
  }

  _animateProcedural(vEnv, aEnv) {
    const vs = 1 - 0.13 * vEnv;
    this.ventricles.scale.set(vs, 1 - 0.09 * vEnv, vs);
    const as = 1 - 0.14 * aEnv + 0.05 * vEnv; // átrios enchem durante a sístole ventricular
    this.atria.scale.set(as, as, as);
    for (const m of this.ventMeshes) m.material.emissive.setRGB(0.45 * vEnv, 0.08 * vEnv, 0.1 * vEnv);
    for (const m of this.atrialMeshes) m.material.emissive.setRGB(0.35 * aEnv, 0.25 * aEnv, 0.1 * aEnv);
  }

  _scaleAbout(entry, s) {
    const { node, center, position, scale } = entry;
    node.scale.copy(scale).multiplyScalar(s);
    node.position.copy(center).sub(position).multiplyScalar(1 - s).add(position);
  }

  _animateModel(sinceR, sinceA, vEnv, aEnv) {
    const { clips, mixer, scaled } = this.model;
    const v = clips.ventriculos; const a = clips.atrios;
    if (v) v.action.time = clipTime(sinceR, VENT_RISE, VENT_HOLD, VENT_FALL, v.peak, v.duration);
    else for (const e of scaled.ventriculos) this._scaleAbout(e, 1 - 0.12 * vEnv);
    if (a) a.action.time = clipTime(sinceA, ATRIAL_RISE, 0, ATRIAL_FALL, a.peak, a.duration);
    else for (const e of scaled.atrios) this._scaleAbout(e, 1 - 0.12 * aEnv + 0.04 * vEnv);
    if (v || a) mixer.update(0);
    // Realce discreto no momento do evento, para a sincronização ficar legível.
    for (const m of this.layerMeshes.ventriculos) for (const mat of this._materialsOf(m)) mat.emissive?.setRGB(0.22 * vEnv, 0.04 * vEnv, 0.05 * vEnv);
    for (const m of this.layerMeshes.atrios) for (const mat of this._materialsOf(m)) mat.emissive?.setRGB(0.18 * aEnv, 0.13 * aEnv, 0.05 * aEnv);
  }

  // tSignal: tempo atual do sinal (s). A animação acompanha o relógio do ECG.
  update(tSignal) {
    const sinceR = tSignal - this.lastR;
    const vEnv = smooth(envelope(sinceR, VENT_RISE, VENT_HOLD, VENT_FALL));

    let aEnv = 0; let sinceA = -Infinity;
    if (this.rrMean && Number.isFinite(this.lastRTrue)) {
      const nextR = this.lastRTrue + this.rrMean;
      sinceA = tSignal - (nextR - ATRIAL_LEAD);
      aEnv = smooth(envelope(sinceA, ATRIAL_RISE, 0, ATRIAL_FALL));
    }

    if (this.model) this._animateModel(sinceR, sinceA, vEnv, aEnv);
    else this._animateProcedural(vEnv, aEnv);

    if (!Number.isFinite(this.lastR)) this.phaseLabel = 'aguardando QRS';
    else if (vEnv > 0.05) this.phaseLabel = 'sístole ventricular (R detectado)';
    else if (aEnv > 0.05) this.phaseLabel = 'contração atrial (estimada pelo RR)';
    else this.phaseLabel = 'diástole';

    this._stepViewTween(performance.now());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
