import test from "node:test";
import assert from "node:assert/strict";
import { resolveInstalledVisionModel } from "../src/screen/screen-analysis.mjs";
import { callOllamaVision } from "../src/screen/vision-tools.mjs";

function client(models) {
  return {
    list: async () => models.map(([name]) => ({ name })),
    show: async (name) => ({ vision: models.find(([id]) => id === name)?.[1] === true }),
  };
}

test("reemplaza llava ausente por un modelo instalado con visión comprobada", async () => {
  assert.equal(await resolveInstalledVisionModel("llava", client([["text:3b", false], ["visual:3b", true]])), "visual:3b");
});

test("respeta el modelo configurado si está instalado y admite imágenes", async () => {
  assert.equal(await resolveInstalledVisionModel("visual", client([["qwen2.5vl:3b", true], ["visual:latest", true]])), "visual:latest");
});

test("no selecciona modelos de texto aunque el nombre sugiera visión", async () => {
  await assert.rejects(resolveInstalledVisionModel("llava", client([["vision:3b", false]])), /No hay un modelo visual instalado/u);
});

test("conserva los errores de conexión de Ollama", async () => {
  await assert.rejects(resolveInstalledVisionModel("llava", { list: async () => { throw new Error("sin conexión"); } }), /sin conexión/u);
});

test("la llamada visual envía la imagen al modelo instalado y nunca intenta descargar", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path === "/api/tags") return Response.json({ models: [{ name: "visual:3b" }] });
    if (path === "/api/show") return Response.json({ capabilities: ["vision"] });
    if (path === "/api/chat") return Response.json({ message: { content: "Veo una ventana." } });
    throw new Error(`Ruta inesperada: ${path}`);
  });
  assert.equal(await callOllamaVision({ visionModel: "llava", prompt: "¿Qué ves?", imageBase64: "aGVsbG8=" }), "Veo una ventana.");
  assert.deepEqual(calls.map(({ path }) => path), ["/api/tags", "/api/show", "/api/chat"]);
  assert.equal(calls[2].body.model, "visual:3b");
  assert.deepEqual(calls[2].body.messages[0].images, ["aGVsbG8="]);
  assert.equal(calls[2].body.keep_alive, 0);
  assert.equal(calls[2].body.options.num_predict, 160, 'limita la generación visual en CPU');
});

test("sin modelos visuales no envía imágenes a Ollama", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).pathname, "/api/tags");
    return Response.json({ models: [] });
  });
  await assert.rejects(callOllamaVision({ visionModel: "llava", prompt: "¿Qué ves?", imageBase64: "aGVsbG8=" }), /No hay un modelo visual instalado/u);
});

test('detener cancela la petición visual en curso sin esperar al timeout',async t=>{
 const controller=new AbortController();let entered;const started=new Promise(resolve=>{entered=resolve});
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/api/tags')return Response.json({models:[{name:'visual:3b'}]});
  if(path==='/api/show')return Response.json({capabilities:['vision']});
  entered();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Consulta cancelada','AbortError')),{once:true}));
 });
 const pending=callOllamaVision({visionModel:'visual:3b',prompt:'Describe la imagen',imageBase64:'aGVsbG8=',signal:controller.signal,timeoutMs:100});
 await started;controller.abort(new DOMException('Consulta cancelada','AbortError'));
 await assert.rejects(pending,/cancelada/u);
});
