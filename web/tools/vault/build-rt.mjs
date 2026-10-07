#!/usr/bin/env node
// Gera o derivado leve para o navegador a partir dos originais do cofre e grava-o CIFRADO.
//
//   node tools/vault/build-rt.mjs [--from <pasta com os originais>] [--out <pasta do cofre>]
//                                 [--keep-temp] [--texture-size 2048] [--no-local-key]
//
// Sem --from, decifra o cofre para uma pasta temporária (exige a chave). Pipeline:
//   cena de origem → glTF (conversor `fbx2gltf`) → texturas TIF → WebP (sharp) → recorte das
//   animações em um ciclo por armadura (ventrículos / topo) → dedup/prune (@gltf-transform)
//   → GLB → AES-256-GCM em web/assets/calib/rt-01.dat (+ índice rt.dat).
// A extensão .dat é neutra e fica fora das listas de gerenciadores de download que
// interceptam .bin/.zip no navegador (o que faria o carregamento falhar em silêncio).
// Fallback: se a conversão falhar, constrói a geometria estática a partir do OBJ + MTL.
// Mapas de deslocamento (EXR) ficam só no cofre. Nunca existe GLB em claro dentro do repositório.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import {
  loadKey, toBase64url, unpackArchive, packRuntime, makeTempDir, walkFiles, formatBytes, DEFAULT_KEY_PATH, KEY_ENV,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { values: args } = parseArgs({
  options: {
    from: { type: 'string' },
    out: { type: 'string', default: path.resolve(here, '../../assets/calib') },
    'keep-temp': { type: 'boolean', default: false },
    'texture-size': { type: 'string', default: '2048' },
    'no-local-key': { type: 'boolean', default: false },
  },
});
const TEXTURE_SIZE = Number(args['texture-size']);

function fail(msg) { console.error(`erro: ${msg}`); process.exit(1); }
const norm = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);

const key = loadKey();
if (!key) fail(`chave não encontrada (${KEY_ENV} ou ${DEFAULT_KEY_PATH}).`);

const tmp = makeTempDir('oh3d-rt-');
let srcDir = args.from;
if (!srcDir) {
  srcDir = path.join(tmp, 'src');
  console.log('decifrando o cofre para a pasta temporária …');
  await unpackArchive(args.out, srcDir, { key });
}
const files = walkFiles(srcDir);
const sceneFiles = files.filter((f) => /\.fbx$/i.test(f));
const objFile = files.find((f) => /\.obj$/i.test(f));
const textureFiles = files.filter((f) => /\.(tif|tiff|png|jpe?g)$/i.test(f));
console.log(`originais: ${files.length} arquivo(s); ${sceneFiles.length} cena(s), ${textureFiles.length} textura(s)`);

// --- 1. Cena → glTF ------------------------------------------------------------------

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let doc = null;
let method = null;

async function convertScene(rel) {
  const exe = require.resolve('fbx2gltf');
  const bin = path.join(path.dirname(exe), 'bin', process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux',
    process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');
  const outBase = path.join(tmp, `conv-${sceneFiles.indexOf(rel)}`);
  execFileSync(bin, ['--input', path.join(srcDir, ...rel.split('/')), '--output', outBase, '--binary', '--pbr-metallic-roughness', '--anim-framerate', 'bake30'], { stdio: 'inherit' });
  return io.read(`${outBase}.glb`);
}

// Escolhe a cena mais completa: mais malhas, depois mais canais de animação.
const candidates = [];
for (const rel of sceneFiles) {
  try {
    const d = await convertScene(rel);
    const root = d.getRoot();
    const channels = root.listAnimations().reduce((a, an) => a + an.listChannels().length, 0);
    candidates.push({ rel, doc: d, meshes: root.listMeshes().length, channels });
    console.log(`  convertido: ${root.listMeshes().length} malha(s), ${root.listSkins().length} armadura(s), ${channels} canal(is) de animação`);
  } catch (err) {
    console.warn(`  conversão falhou para um arquivo de cena: ${err.message.split('\n')[0]}`);
  }
}
candidates.sort((a, b) => b.meshes - a.meshes || b.channels - a.channels);
if (candidates.length) { doc = candidates[0].doc; method = 'conversor'; }

// O conversor deixa NaN nos pesos de skin dos vértices sem influência (detalhes internos
// densos, como válvulas); na GPU isso some com os vértices. Esses vértices passam a seguir
// o primeiro osso da armadura (o de movimento mais suave), e cada linha volta a somar 1.
function sanitizeSkinWeights(d) {
  let fixed = 0;
  for (const mesh of d.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const w = prim.getAttribute('WEIGHTS_0');
    if (!w) continue;
    const arr = w.getArray(); const n = w.getCount(); const el = w.getElementSize();
    let touched = false;
    for (let i = 0; i < n; i++) {
      let bad = false; let s = 0;
      for (let k = 0; k < el; k++) { const v = arr[i * el + k]; if (!Number.isFinite(v) || v < 0) { arr[i * el + k] = 0; bad = true; } else s += v; }
      if (s <= 0) { arr[i * el] = 1; s = 1; bad = true; }
      if (Math.abs(s - 1) > 1e-4) { for (let k = 0; k < el; k++) arr[i * el + k] /= s; bad = true; }
      if (bad) { touched = true; fixed++; }
    }
    if (touched) w.setArray(arr);
  }
  return fixed;
}
// Influência de cada osso medida ANTES da correção: só os vértices realmente pesados pelo
// autor contam como proxy do volume animado de cada parte.
let influence = new Map();
if (doc) {
  influence = jointInfluence(doc);
  const fixed = sanitizeSkinWeights(doc);
  if (fixed) console.log(`  pesos de skin corrigidos em ${fixed} vértice(s)`);
}

// --- 1b. Fallback: OBJ + MTL → geometria estática --------------------------------------

function buildFromObj(objPath) {
  const d = new Document();
  const buffer = d.createBuffer();
  const scene = d.createScene('Scene');
  const root = d.createNode('RootNode');
  scene.addChild(root);
  const v = []; const vt = []; const vn = [];
  let current = null;
  const groups = [];
  const flush = () => { if (current && current.faces.length) groups.push(current); };
  for (const line of fs.readFileSync(objPath, 'utf8').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vt') vt.push([Number(p[1]), 1 - Number(p[2])]);
    else if (p[0] === 'vn') vn.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'o' || p[0] === 'g') { flush(); current = { name: p.slice(1).join(' ') || `parte ${groups.length}`, faces: [] }; }
    else if (p[0] === 'f') { if (!current) current = { name: 'parte 0', faces: [] }; current.faces.push(p.slice(1)); }
  }
  flush();
  for (const g of groups) {
    const pos = []; const uv = []; const nrm = []; const idx = []; const map = new Map();
    const vertex = (tok) => {
      if (map.has(tok)) return map.get(tok);
      const [vi, ti, ni] = tok.split('/').map((s) => (s ? Number(s) : 0));
      const at = (arr, i) => arr[i > 0 ? i - 1 : arr.length + i];
      pos.push(...at(v, vi)); if (ti) uv.push(...at(vt, ti)); if (ni) nrm.push(...at(vn, ni));
      const id = map.size; map.set(tok, id); return id;
    };
    for (const f of g.faces) for (let i = 1; i + 1 < f.length; i++) idx.push(vertex(f[0]), vertex(f[i]), vertex(f[i + 1]));
    const prim = d.createPrimitive()
      .setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
      .setMaterial(d.createMaterial(g.name).setMetallicFactor(0).setRoughnessFactor(0.6));
    if (uv.length === pos.length / 3 * 2) prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
    if (nrm.length === pos.length) prim.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer));
    root.addChild(d.createNode(g.name).setMesh(d.createMesh(g.name).addPrimitive(prim)));
  }
  return d;
}

if (!doc) {
  if (!objFile) fail('nenhuma cena convertida e nenhum OBJ para o fallback.');
  console.log('usando o fallback OBJ (geometria estática; animações ficam para depois)');
  doc = buildFromObj(path.join(srcDir, ...objFile.split('/')));
  method = 'fallback-obj';
}

// --- 2. Texturas → WebP ------------------------------------------------------------------

const root = doc.getRoot();
for (const t of root.listTextures()) t.dispose(); // referências do conversor sem imagem
const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
void webp;

const MAP_KIND = [[/diffuse|albedo|base|color/i, 'base'], [/normal/i, 'normal'], [/rou?gh?ness/i, 'rough']];
function texturesForMesh(meshName) {
  const tokens = new Set(norm(meshName));
  const out = {};
  for (const rel of textureFiles) {
    const base = path.basename(rel);
    const kind = MAP_KIND.find(([re]) => re.test(base))?.[1];
    if (!kind) continue;
    const prefix = base.replace(/_[^_]*$/, '');
    const ptoks = norm(prefix);
    if (![...tokens].every((t) => ptoks.includes(t))) continue;
    out[kind] = path.join(srcDir, ...rel.split('/'));
  }
  return out;
}

async function toWebp(file, { quality = 85, lossless = false } = {}) {
  const img = sharp(file).resize(TEXTURE_SIZE, TEXTURE_SIZE, { fit: 'inside', withoutEnlargement: true });
  return img.webp(lossless ? { lossless: true } : { quality, effort: 5 }).toBuffer();
}

// glTF: rugosidade no canal G, metalicidade no B (zero: tecido não é metal); R fica 255.
async function roughnessToMetallicRoughness(file) {
  const { data, info } = await sharp(file).resize(TEXTURE_SIZE, TEXTURE_SIZE, { fit: 'inside', withoutEnlargement: true })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j += 3) { rgb[j] = 255; rgb[j + 1] = data[i]; rgb[j + 2] = 0; }
  return sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 80, effort: 5 }).toBuffer();
}

let textureBytes = 0;
function addTexture(name, bytes) {
  textureBytes += bytes.length;
  return doc.createTexture(name).setMimeType('image/webp').setImage(new Uint8Array(bytes));
}

for (const mesh of root.listMeshes()) {
  const maps = texturesForMesh(mesh.getName());
  const prims = mesh.listPrimitives();
  const main = prims[0]?.getMaterial();
  for (const prim of prims) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    mat.setMetallicFactor(0);
    if (mat !== main) { // primitivas secundárias (veias com cor por vértice)
      mat.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.45);
      continue;
    }
    mat.setBaseColorFactor([1, 1, 1, 1]);
    if (maps.base) mat.setBaseColorTexture(addTexture(`${mesh.getName()} base`, await toWebp(maps.base, { quality: 85 })));
    if (maps.normal) mat.setNormalTexture(addTexture(`${mesh.getName()} normal`, await toWebp(maps.normal, { quality: 92 })));
    if (maps.rough) { mat.setMetallicRoughnessTexture(addTexture(`${mesh.getName()} mr`, await roughnessToMetallicRoughness(maps.rough))); mat.setRoughnessFactor(1); } else mat.setRoughnessFactor(0.55);
  }
  console.log(`  malha "${mesh.getName()}": texturas ${Object.keys(maps).join(', ') || 'nenhuma'}`);
}

// --- 3. Animações: um clipe por armadura, recortado a um ciclo ------------------------

// Série "tamanho" de um osso: produto das escalas ao longo do tempo.
function scaleSeries(channel) {
  const s = channel.getSampler();
  const t = Array.from(s.getInput().getArray());
  const v = s.getOutput().getArray();
  return { t, size: t.map((_, i) => v[i * 3] * v[i * 3 + 1] * v[i * 3 + 2]) };
}

// Quanto cada osso "pesa" na malha: soma dos pesos de skin que apontam para ele.
function jointInfluence(d) {
  const influence = new Map();
  for (const node of d.getRoot().listNodes()) {
    const skin = node.getSkin(); const mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const joints = skin.listJoints();
    for (const prim of mesh.listPrimitives()) {
      const j = prim.getAttribute('JOINTS_0'); const w = prim.getAttribute('WEIGHTS_0');
      if (!j || !w) continue;
      const ja = j.getArray(); const wa = w.getArray(); const el = j.getElementSize();
      for (let i = 0; i < ja.length; i++) {
        const joint = joints[ja[i]];
        if (joint && Number.isFinite(wa[i])) influence.set(joint, (influence.get(joint) ?? 0) + wa[i]);
      }
      void el;
    }
  }
  return influence;
}

// Proxy do volume da parte: soma, ponderada pela influência de cada osso, do produto das
// escalas animadas (ossos sem canal de escala entram com a escala estática).
function rigSizeSeries(rig, channels, influence) {
  const scaleChannels = channels.filter((c) => c.getTargetPath() === 'scale');
  if (!scaleChannels.length) return null;
  const t = Array.from(scaleChannels[0].getSampler().getInput().getArray());
  const size = new Array(t.length).fill(0);
  const seen = new Set();
  for (const c of scaleChannels) {
    const node = c.getTargetNode(); seen.add(node);
    const wgt = influence.get(node) ?? 1;
    const series = scaleSeries(c);
    for (let i = 0; i < t.length; i++) size[i] += wgt * (series.size[Math.min(i, series.size.length - 1)]);
  }
  for (const [node, wgt] of influence) {
    if (seen.has(node) || !isDescendantOf(node, rig)) continue;
    const s = node.getScale(); const prod = s[0] * s[1] * s[2];
    for (let i = 0; i < t.length; i++) size[i] += wgt * prod;
  }
  return { t, size };
}

// Janela [relaxado → contraído → relaxado]: entre dois máximos locais consecutivos, com o
// instante de contração no mínimo da janela. Devolve tempos.
function findCycle({ t, size }) {
  const max = Math.max(...size); const min = Math.min(...size); const mid = (max + min) / 2;
  const peaks = [];
  for (let i = 1; i < size.length - 1; i++) if (size[i] >= size[i - 1] && size[i] > size[i + 1] && size[i] > mid + (max - mid) * 0.5) peaks.push(i);
  for (let k = 0; k + 1 < peaks.length; k++) {
    const a = peaks[k]; const b = peaks[k + 1];
    let best = -1;
    for (let i = a + 1; i < b; i++) if (size[i] < mid && (best < 0 || size[i] < size[best])) best = i;
    if (best >= 0) return { start: t[a], peak: t[best], end: t[b] };
  }
  return null;
}

function isDescendantOf(node, ancestor) {
  for (let n = node; n; n = n.getParentNode()) if (n === ancestor) return true;
  return false;
}

function cropChannel(d, anim, channel, start, end) {
  const s = channel.getSampler();
  const tIn = s.getInput().getArray(); const vOut = s.getOutput().getArray();
  const el = s.getOutput().getElementSize();
  const keep = [];
  for (let i = 0; i < tIn.length; i++) if (tIn[i] >= start - 1e-6 && tIn[i] <= end + 1e-6) keep.push(i);
  const times = new Float32Array(keep.map((i) => tIn[i] - start));
  const values = new Float32Array(keep.length * el);
  keep.forEach((i, k) => values.set(vOut.subarray(i * el, i * el + el), k * el));
  const buffer = d.getRoot().listBuffers()[0];
  const sampler = d.createAnimationSampler().setInterpolation(s.getInterpolation())
    .setInput(d.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer))
    .setOutput(d.createAccessor().setType(s.getOutput().getType()).setArray(values).setBuffer(buffer));
  anim.addSampler(sampler).addChannel(d.createAnimationChannel().setTargetNode(channel.getTargetNode()).setTargetPath(channel.getTargetPath()).setSampler(sampler));
}

const clipHints = {};
const sourceAnims = root.listAnimations();
if (sourceAnims.length) {
  const rigs = root.listNodes().filter((n) => !n.getMesh() && n.getParentNode()?.getName() === 'RootNode' && n.listChildren().length);
  for (const rig of rigs) {
    const channels = sourceAnims.flatMap((a) => a.listChannels()).filter((c) => isDescendantOf(c.getTargetNode(), rig));
    if (!channels.length) continue;
    const ref = rigSizeSeries(rig, channels, influence);
    const cycle = ref ? findCycle(ref) : null;
    const rigTokens = norm(rig.getName());
    const kind = rigTokens.some((t) => /ventric/.test(t)) ? 'ventricles' : rigTokens.some((t) => /top|atri/.test(t)) ? 'atria' : rig.getName();
    const clip = doc.createAnimation(kind);
    if (cycle) {
      for (const c of channels) cropChannel(doc, clip, c, cycle.start, cycle.end);
      clip.setExtras({ peak: cycle.peak - cycle.start });
      clipHints[kind] = { name: kind, peak: cycle.peak - cycle.start, duration: cycle.end - cycle.start };
      console.log(`  clipe "${kind}": ciclo ${cycle.start.toFixed(3)}–${cycle.end.toFixed(3)} s (contração em +${(cycle.peak - cycle.start).toFixed(3)} s), ${channels.length} canal(is)`);
    } else {
      for (const c of channels) cropChannel(doc, clip, c, 0, Infinity);
      clipHints[kind] = { name: kind, peak: null };
      console.log(`  clipe "${kind}": ciclo não identificado; animação inteira mantida`);
    }
  }
  for (const a of sourceAnims) a.dispose();
}

// --- 4. Dicas para o runtime (camadas, clipes, orientação) ------------------------------

const layers = { ventricles: [], atria: [], vessels: [] };
for (const n of root.listNodes()) {
  if (!n.getMesh()) continue;
  const toks = norm(n.getName());
  if (toks.some((t) => /ventric/.test(t))) layers.ventricles.push(n.getName());
  else if (toks.some((t) => /aort|pulm|vess|vaso|arter/.test(t))) layers.vessels.push(n.getName());
  else if (toks.some((t) => /top|atri|base/.test(t))) layers.atria.push(n.getName());
}
const scene = root.listScenes()[0];
scene.setExtras({ oh3d: { layers, clips: clipHints, orientation: { yaw: 0, pitch: 0, roll: 0 }, method } });
console.log(`  camadas: ventrículos=${layers.ventricles.join('|') || '-'} átrios/topo=${layers.atria.join('|') || '-'} vasos=${layers.vessels.join('|') || '-'}`);

// --- 5. Otimização e gravação cifrada --------------------------------------------------

await doc.transform(dedup(), prune());
const glbPath = path.join(tmp, 'rt.glb');
await io.write(glbPath, doc);
const glbSize = fs.statSync(glbPath).size;
console.log(`GLB em claro (temporário): ${formatBytes(glbSize)} (texturas ${formatBytes(textureBytes)})`);

const index = await packRuntime(glbPath, args.out, { key, content: { type: 'glb', method, bytes: glbSize } });
for (const s of index.slices) console.log(`  ${path.join(args.out, s.file)}  ${formatBytes(s.size)}`);
console.log(`  índice: ${path.join(args.out, 'rt.dat')} · SHA-256 do GLB ${index.sha256}`);

if (!args['no-local-key']) {
  const localKey = path.join(args.out, 'local.key');
  fs.writeFileSync(localKey, toBase64url(key) + '\n');
  console.log(`chave de desenvolvimento gravada em ${localKey} (ignorada pelo git; o navegador em host local a descobre sozinho)`);
}

if (args['keep-temp']) console.log(`pasta temporária mantida: ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });
console.log(`método: ${method}`);
