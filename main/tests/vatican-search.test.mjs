import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNetGateway, isOfficialSourceUrl } from '../src/net-gateway.mjs';

test('fuentes: admite la Santa Sede y rechaza dominios que la imitan', () => {
  assert.equal(isOfficialSourceUrl('https://www.vaticannews.va/es.html'), true);
  assert.equal(isOfficialSourceUrl('https://press.vatican.va/content/'), true);
  assert.equal(isOfficialSourceUrl('https://vaticannews.va.evil.example/'), false);
  assert.equal(isOfficialSourceUrl('https://fakevatican.va/'), false);
});

test('busca la fecha dentro del artículo y decodifica las tildes sin cargar un modelo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bit-date-page-test-'));
  const requests = [];
  const gateway = createNetGateway({
    auditPath: join(directory, 'audit.log'),
    fetchImpl: async url => {
      requests.push(new URL(url));
      if (new URL(url).hostname === 'www.bing.com') return new Response('<rss><channel><item><title>Programa</title><link>https://www.vaticannews.va/es/papa/news/programa.html</link><description>Consulte el programa del viaje.</description></item></channel></rss>');
      return new Response('<html><script>Argentina visita el 1 de enero de 2031.</script><p>El pont&iacute;fice visitar&aacute; Argentina del 8 al 11 de noviembre de 2031.</p></html>');
    },
  });
  const results = await gateway.searchWeb('papa argentina visita fecha');
  assert.equal(requests.length, 3);
  assert.equal(results[0].snippet, 'El pontífice visitará Argentina del 8 al 11 de noviembre de 2031.');
});

test('búsqueda papal: reintenta con fuentes del Vaticano si no hay resultados aceptados', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bit-vatican-test-'));
  const queries = [];
  const gateway = createNetGateway({
    auditPath: join(directory, 'audit.log'),
    fetchImpl: async url => {
      queries.push(new URL(url).searchParams.get('q'));
      return new Response(queries.length === 1 ? '<rss><channel></channel></rss>' : '<rss><channel><item><title>Agenda papal</title><link>https://www.vaticannews.va/es.html</link><description>Información oficial de viajes.</description></item></channel></rss>');
    },
  });
  const results = await gateway.searchWeb('cuando viene el papa a argentina');
  assert.equal(results.length, 1);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /site:vaticannews\.va/u);
  assert.match(queries[1], /argentina/u);
});
