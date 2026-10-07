import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';

const context = vm.createContext({ THREE });
const code = readFileSync(new URL('../src/view/heart3d.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/^export /gm, '');
vm.runInContext(`${code}\nglobalThis.Heart3D = Heart3D;`, context);
const { Heart3D } = context;

function heart() {
  const view = Object.create(Heart3D.prototype);
  view.scene = new THREE.Scene();
  view.clipPlane = new THREE.Plane();
  view.display = {
    layers: Object.fromEntries(['ventriculos', 'atrios', 'vasos'].map((key) => [key, { visible: true, opacity: 1 }])),
    xray: false, clip: { enabled: false, axis: 'x', position: 0 },
  };
  view._buildProcedural();
  view._bindLayers(view.procedural, view.proceduralParts);
  return view;
}

function model() {
  const scene = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const geometry = new THREE.BoxGeometry();
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  return { scene, animations: [], texture, material, geometry };
}

test('remoção libera recursos compartilhados uma vez, incluindo materiais originais e wireframes', (t) => {
  const view = heart();
  const gltf = model();
  const counts = { geometry: 0, original: 0, texture: 0, cloned: 0, wire: 0 };
  gltf.geometry.addEventListener('dispose', () => counts.geometry++);
  gltf.material.addEventListener('dispose', () => counts.original++);
  gltf.texture.addEventListener('dispose', () => counts.texture++);
  let proceduralDisposed = false;
  view.ventMeshes[0].geometry.addEventListener('dispose', () => { proceduralDisposed = true; });
  view.setModel(gltf);
  const previous = view.model;
  const stop = t.mock.method(previous.mixer, 'stopAllAction');
  const uncache = t.mock.method(previous.mixer, 'uncacheRoot');
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    node.material.addEventListener('dispose', () => counts[node.userData.oh3dIsWire ? 'wire' : 'cloned']++);
  });
  view.setModel(null);
  assert.deepEqual(counts, { geometry: 1, original: 1, texture: 1, cloned: 2, wire: 2 });
  assert.equal(stop.mock.callCount(), 1);
  assert.equal(uncache.mock.calls[0].arguments[0], gltf.scene);
  assert.equal(view.model, null);
  assert.equal(previous.root.parent, null);
  assert.equal(view.procedural.visible, true);
  assert.equal(proceduralDisposed, false);
  view.setModel(null);
  assert.equal(counts.geometry, 1);
});

test('substituição libera o modelo anterior sem liberar os recursos do novo', () => {
  const view = heart();
  const first = model();
  const second = model();
  let firstDisposed = 0; let secondDisposed = 0;
  first.geometry.addEventListener('dispose', () => firstDisposed++);
  second.geometry.addEventListener('dispose', () => secondDisposed++);
  view.setModel(first);
  view.setModel(second);
  assert.equal(firstDisposed, 1);
  assert.equal(secondDisposed, 0);
  assert.equal(view.model.gltf, second);
  assert.equal(view.procedural.visible, false);
  view.setModel(null);
});
