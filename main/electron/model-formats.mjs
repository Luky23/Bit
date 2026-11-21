const MAX_TRIANGLES = 200_000;
const DEFAULT_COLOR = [0.35, 0.72, 0.82];
const COMPONENT_BYTES = new Map([
  [5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4],
]);
const TYPE_WIDTHS = new Map([
  ["SCALAR", 1], ["VEC2", 2], ["VEC3", 3], ["VEC4", 4],
  ["MAT2", 4], ["MAT3", 9], ["MAT4", 16],
]);
const UNIT_TO_MM = new Map([
  ["micron", 0.001], ["millimeter", 1], ["centimeter", 10], ["meter", 1000],
  ["inch", 25.4], ["foot", 304.8],
]);

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("El archivo no contiene bytes válidos");
}

function textOf(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function xmlAttributes(source) {
  const attributes = {};
  for (const match of String(source).matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*["']([^"']*)["']/gu)) attributes[match[1]] = match[2];
  return attributes;
}

function xmlNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`El 3MF contiene ${label} no numérico`);
  return number;
}

function transform3mfPoint(values, point) {
  if (!values) return point;
  const [a, b, c, d, e, f, g, h, i, j, k, l] = values;
  return [
    a * point[0] + d * point[1] + g * point[2] + j,
    b * point[0] + e * point[1] + h * point[2] + k,
    c * point[0] + f * point[1] + i * point[2] + l,
  ];
}

function parse3mfTransform(value) {
  if (!value) return null;
  const values = String(value).trim().split(/\s+/u).map(Number);
  if (values.length !== 12 || !values.every(Number.isFinite)) throw new Error("El 3MF contiene una transformación no válida");
  return values;
}

function splitStlComponents(positions) {
  const triangleCount = positions.length / 9;
  if (triangleCount < 2) return [positions];
  // Construir el grafo de conectividad exige crear una clave de texto y
  // mantener un Map por vértice. En STL grandes bloquea el proceso principal
  // durante la carga; para estas mallas la separación tampoco es fiable para
  // una explosión automática, así que se conserva como una pieza única.
  if (triangleCount > 40_000) return [positions];
  const parent = Array.from({ length: triangleCount }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  const vertices = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = triangle * 9 + vertex * 3;
      const key = `${positions[offset]}|${positions[offset + 1]}|${positions[offset + 2]}`;
      const previous = vertices.get(key);
      if (previous === undefined) vertices.set(key, triangle);
      else union(triangle, previous);
    }
  }
  const groups = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(triangle);
    const group = groups.get(root) || [];
    group.push(triangle);
    groups.set(root, group);
  }
  // STL exportadores que duplican todos los vértices producen un grupo por
  // triángulo; no interpretamos ese caso como un ensamblaje falso.
  if (groups.size <= 1 || groups.size > 64) return [positions];
  return [...groups.values()].map((triangles) => {
    const result = new Float32Array(triangles.length * 9);
    triangles.forEach((triangle, index) => result.set(positions.subarray(triangle * 9, triangle * 9 + 9), index * 9));
    return result;
  });
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("Este entorno no admite compresión Deflate del 3MF");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = textOf(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("El 3MF contiene una entrada ZIP inválida");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    if (compressed.length !== compressedSize) throw new Error("El 3MF contiene datos truncados");
    entries.set(name.replace(/^\/+/, ""), method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!entries.size) throw new Error("El 3MF no contiene un directorio ZIP válido");
  return entries;
}

async function parse3mf(bytes) {
  const entries = await readZipEntries(bytes);
  const modelEntry = [...entries.entries()].find(([name]) => /(^|\/)3dmodel\.model$/iu.test(name))?.[1];
  if (!modelEntry) throw new Error("El 3MF no contiene 3D/3dmodel.model");
  const xml = textOf(modelEntry);
  const modelTag = xml.match(/<model\b([^>]*)>/iu)?.[1] || "";
  const modelAttributes = xmlAttributes(modelTag);
  const scale = UNIT_TO_MM.get(String(modelAttributes.unit || "millimeter").toLowerCase());
  if (!scale) throw new Error(`Unidad 3MF no compatible: ${modelAttributes.unit}`);
  const parseObjects = (source, sourcePath) => {
    const objects = new Map();
    for (const objectMatch of source.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/giu)) {
      const attributes = xmlAttributes(objectMatch[1]);
      const body = objectMatch[2];
      const vertices = [...body.matchAll(/<vertex\b([^>]*)\/?\s*>/giu)].map(match => {
        const value = xmlAttributes(match[1]);
        return [xmlNumber(value.x, "una coordenada X"), xmlNumber(value.y, "una coordenada Y"), xmlNumber(value.z, "una coordenada Z")];
      });
      const triangles = [...body.matchAll(/<triangle\b([^>]*)\/?\s*>/giu)].map(match => {
        const value = xmlAttributes(match[1]);
        return [Number.parseInt(value.v1, 10), Number.parseInt(value.v2, 10), Number.parseInt(value.v3, 10)];
      });
      const references = [...body.matchAll(/<component\b([^>]*)\/?\s*>/giu)].map(match => {
        const value = xmlAttributes(match[1]);
        return { path: value["p:path"]?.replace(/^\/+/, "") || sourcePath, objectId: value.objectid, transform: parse3mfTransform(value.transform) };
      });
      if (attributes.id) objects.set(`${sourcePath}#${attributes.id}`, {
        id: attributes.id,
        name: attributes.name || `Objeto ${attributes.id}`,
        vertices,
        triangles,
        references,
        sourcePath,
      });
    }
    return objects;
  };
  const objectEntries = new Map(parseObjects(xml, "3D/3dmodel.model"));
  for (const [entryName, entryBytes] of entries) {
    if (entryName === "3D/3dmodel.model" || !/\.model$/iu.test(entryName)) continue;
    try {
      const entryXml = textOf(entryBytes);
      for (const [key, object] of parseObjects(entryXml, entryName)) objectEntries.set(key, object);
    } catch { /* Los metadatos .model no geométricos no son necesarios para el visor. */ }
  }
  if (![...objectEntries.values()].some(object => object.triangles.length || object.references.length)) {
    throw new Error("El 3MF no contiene mallas triangulares");
  }
  const items = [...xml.matchAll(/<item\b([^>]*)\/?\s*>/giu)].map(match => xmlAttributes(match[1]));
  const placements = items.length ? items : [...objectEntries.values()]
    .filter(object => object.sourcePath === "3D/3dmodel.model")
    .map(object => ({ objectid: object.id }));
  const components = [];
  const resolving = new Set();
  const appendObject = (object, transforms, inheritedName = object.name) => {
    if (!object || resolving.has(`${object.sourcePath}#${object.id}`)) throw new Error("El 3MF contiene una referencia circular");
    const key = `${object.sourcePath}#${object.id}`;
    resolving.add(key);
    if (object.vertices.length && object.triangles.length) {
      const positions = [];
      for (const triangle of object.triangles) {
        for (const index of triangle) {
          const point = object.vertices[index];
          if (!point) throw new Error("El 3MF referencia un vértice inexistente");
          const transformed = transforms.reduce((current, transform) => transform3mfPoint(transform, current), point);
          positions.push(...transformed.map(value => value * scale));
        }
      }
      if (positions.length) components.push({ id: `3mf-${components.length}`, name: inheritedName, positions: new Float32Array(positions), color: DEFAULT_COLOR });
    }
    for (const reference of object.references) {
      const target = objectEntries.get(`${reference.path}#${reference.objectId}`);
      if (!target) throw new Error(`El 3MF referencia una malla inexistente: ${reference.path}`);
      appendObject(target, reference.transform ? [reference.transform, ...transforms] : transforms, target.name || inheritedName);
    }
    resolving.delete(key);
  };
  for (const placement of placements) {
    const object = objectEntries.get(`3D/3dmodel.model#${placement.objectid}`);
    if (!object) continue;
    const transform = parse3mfTransform(placement.transform);
    appendObject(object, transform ? [transform] : []);
    const triangleCount = components.reduce((count, component) => count + component.positions.length / 9, 0);
    if (triangleCount > MAX_TRIANGLES) throw new Error("El 3MF supera el límite de triángulos admitido");
  }
  if (!components.length) throw new Error("El 3MF no contiene objetos construibles");
  return {
    components,
    units: "millimeter",
    sourceUnit: String(modelAttributes.unit || "millimeter").toLowerCase(),
    componentStrategy: components.length > 1 ? "build-items" : "single-mesh",
    // Los 3MF de CAD/laminadores suelen definir Z como vertical. La vista
    // superior conserva la orientación natural de la pieza al abrirla.
    // Esquina superior derecha visual: superior + frontal + lateral derecho.
    preferredView: "iso-nw",
  };
}

function parseStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart().toLowerCase();
  // Un STL binario puede empezar por "solid" y contener bytes que no son
  // UTF-8. Solo intentamos leerlo como ASCII si la decodificación completa
  // es válida; de lo contrario seguimos por la ruta binaria.
  let ascii = false;
  if (header.startsWith("solid")) {
    try { ascii = /vertex\s+/iu.test(textOf(bytes)); } catch { ascii = false; }
  }
  const positions = [];
  if (!ascii && bytes.length >= 84) {
    const count = view.getUint32(80, true);
    if (count > MAX_TRIANGLES) throw new Error("El STL supera el límite de triángulos admitido");
    const end = 84 + count * 50;
    if (end <= bytes.length) {
      for (let triangle = 0; triangle < count; triangle += 1) {
        const start = 84 + triangle * 50 + 12;
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const offset = start + vertex * 12;
          positions.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
        }
      }
      return splitStlComponents(new Float32Array(positions)).map((componentPositions, index) => ({
        id: `stl-${index}`,
        name: index === 0 ? "Malla STL" : `Pieza STL ${index + 1}`,
        positions: componentPositions,
        color: DEFAULT_COLOR,
      }));
    }
  }

  let source;
  try { source = textOf(bytes); }
  catch { throw new Error("El STL no es ASCII UTF-8 válido ni contiene una malla binaria válida"); }
  const vertexPattern = /\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/giu;
  for (const match of source.matchAll(vertexPattern)) {
    positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
    if (positions.length / 9 > MAX_TRIANGLES) throw new Error("El STL supera el límite de triángulos admitido");
  }
  if (!positions.length || positions.length % 9 !== 0) throw new Error("El STL no contiene triángulos válidos");
  return splitStlComponents(new Float32Array(positions)).map((componentPositions, index) => ({
    id: `stl-${index}`,
    name: index === 0 ? "Malla STL" : `Pieza STL ${index + 1}`,
    positions: componentPositions,
    color: DEFAULT_COLOR,
  }));
}

function colorForMaterial(name) {
  if (!name) return DEFAULT_COLOR;
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const hue = (Math.abs(hash) % 360) / 60;
  const chroma = 0.38;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map((value) => value + 0.42);
}

function parseObj(bytes) {
  const source = textOf(bytes);
  const vertices = [];
  const components = new Map();
  let triangleCount = 0;
  let objectName = "Objeto";
  let groupName = "";
  let materialName = "";

  function component() {
    const label = [objectName, groupName, materialName].filter(Boolean).join(" / ");
    const key = label || "Malla OBJ";
    if (!components.has(key)) {
      components.set(key, {
        id: `obj-${components.size}`,
        name: key,
        positions: [],
        color: colorForMaterial(materialName),
      });
    }
    return components.get(key);
  }

  function vertexIndex(token) {
    const raw = Number.parseInt(token.split("/")[0], 10);
    if (!Number.isInteger(raw) || raw === 0) throw new Error("El OBJ contiene un índice de vértice no válido");
    const index = raw > 0 ? raw - 1 : vertices.length + raw;
    if (index < 0 || index >= vertices.length) throw new Error("El OBJ referencia un vértice inexistente");
    return index;
  }

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [kind, ...parts] = line.split(/\s+/u);
    if (kind === "v") {
      if (parts.length < 3) throw new Error("El OBJ contiene un vértice incompleto");
      const vertex = parts.slice(0, 3).map(Number);
      if (!vertex.every(Number.isFinite)) throw new Error("El OBJ contiene coordenadas no numéricas");
      vertices.push(vertex);
    } else if (kind === "o") {
      objectName = parts.join(" ") || "Objeto";
      groupName = "";
    } else if (kind === "g") {
      groupName = parts.join(" ");
    } else if (kind === "usemtl") {
      materialName = parts.join(" ");
    } else if (kind === "f") {
      if (parts.length < 3) throw new Error("El OBJ contiene una cara sin triángulos");
      const indices = parts.map(vertexIndex);
      const target = component();
      triangleCount += indices.length - 2;
      if (triangleCount > MAX_TRIANGLES) throw new Error("El OBJ supera el límite de triángulos admitido");
      for (let index = 1; index < indices.length - 1; index += 1) {
        for (const vertexId of [indices[0], indices[index], indices[index + 1]]) {
          target.positions.push(...vertices[vertexId]);
        }
      }
    }
  }
  const result = [...components.values()]
    .filter((entry) => entry.positions.length)
    .map((entry) => ({ ...entry, positions: new Float32Array(entry.positions) }));
  if (!result.length) throw new Error("El OBJ no contiene caras triangulables");
  return result;
}

function decodeDataUri(uri) {
  const separator = uri.indexOf(",");
  if (separator < 0) throw new Error("El glTF contiene un URI de datos incompleto");
  const metadata = uri.slice(0, separator);
  const payload = uri.slice(separator + 1);
  if (/;base64/iu.test(metadata)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function parseGlb(bytes) {
  if (bytes.length < 20) throw new Error("El archivo GLB está truncado");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("El GLB no tiene una cabecera glTF 2.0 válida");
  }
  const totalLength = view.getUint32(8, true);
  if (totalLength > bytes.length || totalLength < 20) throw new Error("La longitud declarada por el GLB no es válida");
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= totalLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length > totalLength - offset) throw new Error("El GLB contiene un bloque truncado");
    const chunk = bytes.subarray(offset, offset + length);
    if (type === 0x4e4f534a) json = JSON.parse(textOf(chunk).replace(/[\u0000\u0020]+$/gu, ""));
    if (type === 0x004e4942) binary = chunk;
    offset += length;
  }
  if (!json) throw new Error("El GLB no contiene un bloque JSON");
  return { json, binary };
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return result;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.map(Number);
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, x, y, z) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

function normalizedValue(value, type, signed) {
  if (type === 5126) return value;
  if (signed) return Math.max(value / (type === 5120 ? 127 : 32767), -1);
  return value / (type === 5121 ? 255 : type === 5123 ? 65535 : 4294967295);
}

function makeAccessorReader(json, buffers) {
  return function readAccessor(index, expectedWidth) {
    const accessor = json.accessors?.[index];
    if (!accessor) throw new Error("El glTF referencia un accessor inexistente");
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 0) throw new Error("El glTF contiene un tamaño de accessor no válido");
    const width = TYPE_WIDTHS.get(accessor.type);
    const componentSize = COMPONENT_BYTES.get(accessor.componentType);
    if (!width || !componentSize || (expectedWidth && width !== expectedWidth)) {
      throw new Error("El glTF utiliza un tipo de accessor no compatible");
    }
    if (accessor.sparse) throw new Error("Los accessors dispersos glTF todavía no son compatibles");
    const values = new Float32Array(accessor.count * width);
    if (accessor.bufferView === undefined) return { values, width, accessor };
    const bufferView = json.bufferViews?.[accessor.bufferView];
    if (
      !bufferView
      || !Number.isSafeInteger(bufferView.byteLength)
      || bufferView.byteLength < 0
      || bufferView.extensions?.EXT_meshopt_compression
    ) {
      throw new Error("El glTF utiliza una vista de buffer no compatible");
    }
    const buffer = buffers[bufferView.buffer];
    if (!buffer) throw new Error("El glTF referencia un buffer inexistente");
    const stride = bufferView.byteStride || componentSize * width;
    const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const viewEnd = (bufferView.byteOffset || 0) + bufferView.byteLength;
    const accessorEnd = start + Math.max(0, accessor.count - 1) * stride + componentSize * width;
    if (stride < componentSize * width || viewEnd > buffer.length || accessorEnd > viewEnd) {
      throw new Error("El glTF contiene un accessor fuera de los límites del buffer");
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let element = 0; element < accessor.count; element += 1) {
      for (let column = 0; column < width; column += 1) {
        const offset = start + element * stride + column * componentSize;
        let value;
        switch (accessor.componentType) {
          case 5120: value = view.getInt8(offset); break;
          case 5121: value = view.getUint8(offset); break;
          case 5122: value = view.getInt16(offset, true); break;
          case 5123: value = view.getUint16(offset, true); break;
          case 5125: value = view.getUint32(offset, true); break;
          case 5126: value = view.getFloat32(offset, true); break;
          default: throw new Error("Tipo de componente glTF no compatible");
        }
        values[element * width + column] = accessor.normalized
          ? normalizedValue(value, accessor.componentType, accessor.componentType === 5120 || accessor.componentType === 5122)
          : value;
      }
    }
    return { values, width, accessor };
  };
}

function primitiveIndices(mode, source) {
  if (mode === 4) {
    if (source.length % 3 !== 0) throw new Error("El glTF contiene una lista de triángulos incompleta");
    return source;
  }
  const triangles = [];
  if (mode === 5) {
    for (let index = 2; index < source.length; index += 1) {
      if (index % 2) triangles.push(source[index - 1], source[index - 2], source[index]);
      else triangles.push(source[index - 2], source[index - 1], source[index]);
    }
    return triangles;
  }
  if (mode === 6) {
    for (let index = 2; index < source.length; index += 1) triangles.push(source[0], source[index - 1], source[index]);
    return triangles;
  }
  throw new Error("El glTF contiene una primitiva que no es una malla de triángulos");
}

function parseGltf(json, binary, assetData) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Solo se admite glTF 2.0 válido");
  }
  if (typeof json.asset?.version !== "string" || json.asset.version.split(".")[0] !== "2") {
    throw new Error("Solo se admite glTF 2.0 válido");
  }
  if (json.buffers !== undefined && !Array.isArray(json.buffers)) throw new Error("El glTF contiene una lista de buffers no válida");
  const assets = assetData instanceof Map ? assetData : new Map(Object.entries(assetData || {}));
  const buffers = (json.buffers || []).map((buffer) => {
    if (!buffer || typeof buffer !== "object" || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) {
      throw new Error("El glTF contiene una definición de buffer no válida");
    }
    let bytes;
    if (buffer.uri?.startsWith("data:")) bytes = decodeDataUri(buffer.uri);
    else if (buffer.uri) bytes = assets.has(buffer.uri) ? bytesOf(assets.get(buffer.uri)) : null;
    else bytes = binary;
    if (!bytes) throw new Error(`Falta el buffer local del glTF: ${buffer.uri || "(sin URI)"}`);
    if (bytes.length < buffer.byteLength) throw new Error("Un buffer glTF es más corto que la longitud declarada");
    return bytes;
  });
  const readAccessor = makeAccessorReader(json, buffers);
  const components = [];
  let triangleCount = 0;
  const appendMesh = (meshIndex, world, nodeName = "") => {
    const mesh = json.meshes?.[meshIndex];
    if (!mesh) throw new Error("El glTF referencia una malla inexistente");
    for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
      if (primitive.extensions?.KHR_draco_mesh_compression) {
        throw new Error("La malla usa Draco; este formato comprimido requiere conversión a glTF sin compresión");
      }
      if (primitive.targets?.length) throw new Error("Las mallas glTF con morph targets todavía no son compatibles");
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) continue;
      const { values: positions, accessor } = readAccessor(positionAccessor, 3);
      if (accessor.componentType !== 5126 && !accessor.normalized) {
        throw new Error("Las posiciones glTF enteras deben estar normalizadas");
      }
      let rawIndices;
      if (primitive.indices === undefined) {
        rawIndices = Array.from({ length: accessor.count }, (_, index) => index);
      } else {
        const indexAccessor = readAccessor(primitive.indices, 1);
        if (![5121, 5123, 5125].includes(indexAccessor.accessor.componentType)) {
          throw new Error("Los índices glTF deben usar enteros sin signo");
        }
        rawIndices = Array.from(indexAccessor.values);
      }
      const indices = primitiveIndices(primitive.mode ?? 4, rawIndices);
      if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= accessor.count)) {
        throw new Error("El glTF contiene un índice de vértice fuera de rango");
      }
      triangleCount += indices.length / 3;
      if (triangleCount > MAX_TRIANGLES) throw new Error("El glTF supera el límite de triángulos admitido");
      const transformed = new Float32Array(indices.length * 3);
      for (let index = 0; index < indices.length; index += 1) {
        const source = indices[index] * 3;
        const point = transformPoint(world, positions[source], positions[source + 1], positions[source + 2]);
        transformed.set(point, index * 3);
      }
      const material = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor;
      const color = Array.isArray(material) ? material.slice(0, 3).map(Number) : DEFAULT_COLOR;
      const label = nodeName || mesh.name || `Malla ${meshIndex + 1}`;
      const suffix = (mesh.primitives || []).length > 1 ? ` · ${primitiveIndex + 1}` : "";
      components.push({
        id: `gltf-${components.length}`,
        name: `${label}${suffix}`,
        positions: transformed,
        color,
      });
    }
  };
  const nodes = json.nodes || [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes || nodes
    .map((_, index) => index)
    .filter((index) => !nodes.some((node) => node.children?.includes(index)));
  if (nodes.length) {
    const visiting = new Set();
    const visit = (index, parentMatrix) => {
      const node = nodes[index];
      if (!node || visiting.has(index)) throw new Error("El glTF contiene una jerarquía de nodos circular o no válida");
      visiting.add(index);
      const world = multiplyMatrices(parentMatrix, nodeMatrix(node));
      if (node.mesh !== undefined) appendMesh(node.mesh, world, node.name || "");
      for (const child of node.children || []) visit(child, world);
      visiting.delete(index);
    };
    for (const root of roots) visit(root, identityMatrix());
  } else {
    for (const [index] of (json.meshes || []).entries()) appendMesh(index, identityMatrix());
  }
  if (!components.length) throw new Error("El glTF no contiene geometría triangular compatible");
  return components;
}

function calculateBounds(components) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const component of components) {
    for (let index = 0; index < component.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = component.positions[index + axis];
        if (!Number.isFinite(value)) throw new Error("El modelo contiene coordenadas no finitas");
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  if (!Number.isFinite(min[0])) throw new Error("El modelo está vacío");
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const size = min.map((value, axis) => max[axis] - value);
  const radius = Math.max(...size) / 2;
  return { min, max, center, size, radius: radius || 1 };
}

export function parse3DModel({ name, data, assets = {} } = {}) {
  if (typeof name !== "string") throw new Error("Falta el nombre del archivo 3D");
  const bytes = bytesOf(data);
  const extension = name.split(".").pop().toLowerCase();
  let components;
  if (extension === "3mf") return parse3mf(bytes).then(result => ({ name, format: extension, components: result.components, bounds: calculateBounds(result.components), units: result.units, sourceUnit: result.sourceUnit, componentStrategy: result.componentStrategy, preferredView: result.preferredView }));
  if (extension === "stl") components = parseStl(bytes);
  else if (extension === "obj") components = parseObj(bytes);
  else if (extension === "glb") {
    const { json, binary } = parseGlb(bytes);
    components = parseGltf(json, binary, assets);
  } else if (extension === "gltf") {
    const json = JSON.parse(textOf(bytes));
    components = parseGltf(json, null, assets);
  } else {
    throw new Error(`Formato 3D no compatible: .${extension}`);
  }
  const bounds = calculateBounds(components);
  return { name, format: extension, components, bounds };
}
