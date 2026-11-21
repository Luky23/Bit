import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parse3DModel } from "../electron/model-formats.mjs";

const triangle = [
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
];

function gltfJson(uri) {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36, ...(uri ? { uri } : {}) }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: "Panel", mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}

function triangleBuffer() {
  const buffer = Buffer.alloc(36);
  triangle.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function makeGlb(json, binary) {
  const jsonData = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.concat([jsonData, Buffer.alloc((4 - jsonData.length % 4) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const result = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBinary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(paddedJson.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(result, 20);
  const binaryHeader = 20 + paddedJson.length;
  result.writeUInt32LE(paddedBinary.length, binaryHeader);
  result.writeUInt32LE(0x004e4942, binaryHeader + 4);
  paddedBinary.copy(result, binaryHeader + 8);
  return result;
}

function make3mf(xml = `<model unit="millimeter"><resources><object id="1" name="Base"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="20" z="30"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`) {
  const name = Buffer.from("3D/3dmodel.model");
  const data = Buffer.from(xml);
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10); local.writeUInt32LE(0, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 12); central.writeUInt32LE(0, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, eocd]);
}

test("3D parser: importa STL ASCII y binario como geometría triangular real", () => {
  const ascii = Buffer.from("solid prueba\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid prueba\n");
  const binary = Buffer.alloc(134);
  binary.writeUInt32LE(1, 80);
  triangle.forEach((value, index) => binary.writeFloatLE(value, 96 + index * 4));
  assert.deepEqual([...parse3DModel({ name: "pieza.stl", data: ascii }).components[0].positions], triangle);
  assert.deepEqual([...parse3DModel({ name: "pieza.stl", data: binary }).components[0].positions], triangle);
});

test("3D parser: un STL binario con cabecera solid no se intenta decodificar como UTF-8", () => {
  const binary = Buffer.alloc(84 + 50);
  binary.write("solid modelo", 0, "ascii");
  binary.writeUInt32LE(1, 80);
  binary.writeFloatLE(0, 96); binary.writeFloatLE(0, 100); binary.writeFloatLE(0, 104);
  binary.writeFloatLE(1, 108); binary.writeFloatLE(0, 112); binary.writeFloatLE(0, 116);
  binary.writeFloatLE(0, 120); binary.writeFloatLE(1, 124); binary.writeFloatLE(0, 128);
  binary[133] = 0xff;
  const model = parse3DModel({ name: "modelo.stl", data: binary });
  assert.equal(model.components[0].positions.length, 9);
});

test("3D parser: conserva grupos independientes del OBJ para seleccionar y explosionar", () => {
  const source = [
    "o Ensamble",
    "v 0 0 0", "v 1 0 0", "v 0 1 0", "v 0 0 1",
    "g Base", "f 1 2 3",
    "g Tapa", "f 1 3 4",
  ].join("\n");
  const model = parse3DModel({ name: "ensamble.obj", data: Buffer.from(source) });
  assert.equal(model.components.length, 2);
  assert.deepEqual(model.components.map((component) => component.name), ["Ensamble / Base", "Ensamble / Tapa"]);
  assert.equal(model.bounds.radius > 0, true);
});

test("3D parser: importa GLB y glTF con buffer local sin cargar módulos remotos", () => {
  const binary = triangleBuffer();
  const glb = makeGlb(gltfJson(), binary);
  const external = parse3DModel({
    name: "panel.gltf",
    data: Buffer.from(JSON.stringify(gltfJson("triangle.bin"))),
    assets: { "triangle.bin": binary },
  });
  const embedded = parse3DModel({ name: "panel.glb", data: glb });
  assert.deepEqual([...embedded.components[0].positions], triangle);
  assert.deepEqual([...external.components[0].positions], triangle);
  assert.equal(embedded.components[0].name, "Panel");
});

test("3MF: abre ZIP/XML real, conserva unidades y calcula dimensiones", async () => {
  const model = await parse3DModel({ name: "AH_Prueba v11.3mf", data: make3mf() });
  assert.equal(model.format, "3mf");
  assert.equal(model.units, "millimeter");
  assert.equal(model.componentStrategy, "single-mesh");
  assert.equal(model.components.length, 1);
  assert.deepEqual(model.bounds.size, [10, 20, 30]);
});

test("3MF: aplica transformaciones anidadas y de construcción a una sola pieza", async () => {
  const xml = `<model unit="centimeter"><resources>
    <object id="1"><mesh><vertices><vertex x="1" y="2" z="3"/><vertex x="2" y="2" z="3"/><vertex x="1" y="3" z="3"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 4 0 0"/></components></object>
    </resources><build><item objectid="2" transform="0 1 0 -1 0 0 0 0 1 10 20 30"/></build></model>`;
  const model = await parse3DModel({ name: "pieza.3mf", data: make3mf(xml) });
  assert.deepEqual([...model.components[0].positions], [80, 250, 330, 80, 260, 330, 70, 250, 330]);
  assert.deepEqual(model.bounds.center, [75, 255, 330]);
});

test("3D parser: rechaza rutas glTF externas faltantes y cabeceras GLB inválidas", () => {
  assert.throws(
    () => parse3DModel({ name: "panel.gltf", data: Buffer.from(JSON.stringify(gltfJson("missing.bin"))) }),
    /Falta el buffer local/u,
  );
  assert.throws(
    () => parse3DModel({ name: "panel.glb", data: Buffer.alloc(32) }),
    /cabecera glTF 2\.0/u,
  );
});
