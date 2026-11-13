import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebSearchRequest, buildWebSearchQuery, parseSearchResults, isPublicSearchSourceUrl, isOfficialSourceUrl } from '../src/net-gateway.mjs';
import { runAgentTurn } from '../src/core/agent.mjs';

test('novedades se reconocen por la intención y no por una lista de marcas', () => {
  for (const prompt of [
    'cual es la nueva computadora de asus', 'Qué trae el nuevo portátil de Acer',
    'Contame sobre los últimos auriculares de Bose', 'Información del teléfono más reciente de Motorola',
    'Qué anunció Lenovo recientemente', 'Cuál es la situación actual en Islandia',
    'Qué novedades hay de Blender', 'Las novedades de una marca desconocida',
  ]) assert.equal(isWebSearchRequest(prompt), true, prompt);
  for (const prompt of [
    'Escriba una nueva historia', 'Crea un nuevo archivo', 'Cómo aprendo un nuevo idioma',
    'Explique la primera ley de Newton', 'Cuál es mi nueva computadora',
    'Lee el último documento de mi carpeta', 'Explica la Nueva España del siglo XVI',
  ]) assert.equal(isWebSearchRequest(prompt), false, prompt);
});

test('la búsqueda conserva fuentes públicas nuevas sin declararlas oficiales ni admitir destinos locales', () => {
  const results = parseSearchResults(`<rss><channel>
    <item><title>ASUS anuncia un portátil</title><link>https://www.asus.com/news/announcement/</link><description>Nuevo equipo anunciado.</description></item>
    <item><title>Otro fabricante</title><link>https://www.acer.com/news/</link><description>Otra novedad.</description></item>
    <item><title>Red local</title><link>https://192.168.1.1/</link><description>Privado.</description></item>
    <item><title>Localhost</title><link>https://localhost/</link><description>Privado.</description></item>
  </channel></rss>`);
  assert.equal(results.length, 2);
  assert.equal(isOfficialSourceUrl(results[0].url), false);
  for (const url of ['http://www.asus.com/', 'https://localhost/', 'https://127.0.0.1/',
    'https://[::1]/', 'https://user:secret@www.asus.com/', 'https://www.asus.com:8443/',
    'https://bit.local/', 'https://weather.example/', 'file:///C:/private.txt', 'javascript:alert(1)']) {
    assert.equal(isPublicSearchSourceUrl(url), false, url);
  }
  const sorted = parseSearchResults(`<rss><channel>
    <item><title>Fabricante</title><link>https://www.asus.com/news/</link><description>Dato.</description></item>
    <item><title>Organismo reconocido</title><link>https://www.nasa.gov/news/</link><description>Dato.</description></item>
  </channel></rss>`);
  assert.equal(new URL(sorted[0].url).hostname, 'www.nasa.gov');
});

test('la pregunta de ASUS llega a búsqueda y al modelo con fuentes aunque el fabricante no esté enumerado', async () => {
  let searches = 0;
  const result = await runAgentTurn({
    message: 'cual es la nueva computadora de asus', config: { fastModel: 'local' },
    deps: {
      executeTool: async (name, args) => {
        assert.equal(name, 'web.search'); assert.match(args.query, /asus/iu); searches++;
        return [{ title: 'Comunicado de ASUS', url: 'https://www.asus.com/news/', snippet: 'ASUS anunció el equipo de prueba con pantalla de 14 pulgadas.' }];
      },
      chatClient: { generate: async (_model, request) => {
        assert.equal(searches, 1);
        assert.ok(request.messages.some(item => item.content.includes('pantalla de 14 pulgadas')));
        assert.equal(request.tools, undefined);
        return { message: { content: 'El equipo anunciado tiene pantalla de 14 pulgadas.' } };
      } },
    },
  });
  assert.equal(result.sources.length, 1); assert.match(result.text, /14 pulgadas/u);
});

test('datos cambiantes se verifican para distintos temas, sin enviar pedidos locales', () => {
  for (const prompt of [
    '¿Cuándo sale GTA 6?', 'cuando se estrena la nueva pelicula de Batman',
    'Fecha de lanzamiento de un videojuego', '¿Ya salió el nuevo teléfono?',
    '¿Cuánto cuesta una PlayStation 5?', '¿Cuál es la última versión de Firefox?',
    '¿Quién ganó el partido de ayer?', '¿Sigue disponible ese producto?',
    '¿Qué se sabe actualmente de GTA 6?',
  ]) assert.equal(isWebSearchRequest(prompt), true, prompt);
  for (const prompt of [
    'Explicame la fotosíntesis', '¿Cuándo salió GTA 3 en 2001?',
    '¿Cuánto cuesta calcular una raíz cuadrada?',
    'Lee mis notas sobre el precio actual del proyecto',
    '¿Cuál es la última versión de mi archivo local?',
  ]) assert.equal(isWebSearchRequest(prompt), false, prompt);
});

test('un lanzamiento consulta fuentes antes de responder y no usa el recuerdo del modelo', async () => {
  let searched = false;
  const result = await runAgentTurn({
    message: '¿Cuándo sale GTA 6?', config: { fastModel: 'local' },
    deps: {
      executeTool: async (name, args) => {
        assert.equal(name, 'web.search');
        assert.match(args.query, /GTA 6/u);
        searched = true;
        return [{ title: 'Anuncio oficial', url: 'https://www.rockstargames.com/newswire', snippet: 'La fecha anunciada debe comprobarse en este comunicado.' }];
      },
      chatClient: { generate: async (_model, request) => {
        assert.equal(searched, true);
        assert.ok(request.messages.some(item => item.content.includes('La fecha anunciada')));
        return { message: { content: 'Estos resultados no permiten confirmar una fecha.' } };
      } },
    },
  });
  assert.equal(result.sources.length, 1);
});

test('preguntas sobre visitas futuras consultan información actual', () => {
  for (const prompt of ['cuando viene el papa a argentina', '¿Cuándo visitará el Papa Argentina?', '¿Cuándo llega el presidente a Italia?']) {
    assert.equal(isWebSearchRequest(prompt), true, prompt);
  }
  for (const prompt of ['¿Cuándo vino el papa a Argentina en 1987?', '¿Cuándo nació Mozart?', 'Mi papá viene mañana']) {
    assert.equal(isWebSearchRequest(prompt), false, prompt);
  }
});

test('el próximo Mundial busca en FIFA y recibe la fecha actual sin usar conocimiento viejo como fuente', async () => {
  let searched = false;
  const result = await runAgentTurn({
    message: 'cuando es el proximo mundial',
    config: { fastModel: 'local' },
    deps: {
      now: () => new Date('2026-11-11T15:00:00Z'),
      executeTool: async (name, args) => {
        assert.equal(name, 'web.search');
        assert.match(args.query, /site:fifa\.com/u);
        searched = true;
        return [{ title: 'Próxima edición del Mundial', url: 'https://inside.fifa.com/tournament-organisation/world-cup-2030', snippet: 'La Copa Mundial de 2030 se disputará en España, Portugal y Marruecos.' }];
      },
      chatClient: { generate: async (_model, request) => {
        assert.equal(searched, true);
        assert.match(request.messages[0].content, /2026-11-11/u);
        assert.match(request.messages[0].content, /No presentes un evento pasado como próximo/u);
        assert.ok(request.messages.some(item => item.content.includes('La Copa Mundial de 2030')));
        assert.equal(request.tools, undefined);
        return { message: { content: 'El próximo Mundial masculino será en 2030.' } };
      } },
    },
  });
  assert.match(result.text, /2030/u);
  assert.equal(result.sources.length, 1);
});

test('las preguntas de visitas se convierten en términos de búsqueda sin perder el destino', () => {
  assert.equal(buildWebSearchQuery('cuando viene el papa a argentina?'), 'papa argentina visita fecha');
  assert.equal(buildWebSearchQuery('¿Cuándo visitará el Papa Argentina?'), 'Papa Argentina visita fecha');
  assert.equal(buildWebSearchQuery('Buscá en internet noticias de Córdoba'), 'noticias de Córdoba');
});

test('las próximas ediciones y los cargos actuales requieren búsqueda, la historia no', () => {
  for (const prompt of ['cuando es el proximo mundial', '¿Dónde será el próximo Mundial de fútbol?', '¿Cuándo es el Mundial?', 'Quién es el presidente de Argentina actualmente']) {
    assert.equal(isWebSearchRequest(prompt), true, prompt);
  }
  for (const prompt of ['¿Quién ganó el Mundial de 1986?', 'Explicame el próximo número de esta secuencia', 'Historia de los mundiales']) {
    assert.equal(isWebSearchRequest(prompt), false, prompt);
  }
});
