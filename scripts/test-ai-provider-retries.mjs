// Los dos fallos del proveedor que no son culpa de quien llama.
//
// Un 503 puntual no puede tumbar una operación larga —corregir una transcripción entera,
// indexar un corpus— cuando la petición ni siquiera llegó a ejecutarse. Y un 429 en una
// capa gratuita se espera, en vez de dar por perdido el trabajo.
//
// La prueba ejercita la política sobre un doble del cliente, porque lo que hay que
// verificar es CUÁNTAS veces se llama y con qué esperas, no que la red funcione.

import assert from 'node:assert/strict';
import test from 'node:test';

/** Copia literal de la política de `aiClient.withProviderRetries`. */
async function withProviderRetries(freeTier, make, sleep) {
  const isRateLimited = (e) => (e?.status ?? e?.response?.status) === 429;
  const isTransientServerError = (e) => {
    const status = e?.status ?? e?.response?.status;
    return typeof status === 'number' && status >= 500 && status < 600;
  };
  const maxRateWaits = freeTier ? 4 : 0;
  const maxServerRetries = 2;
  let serverRetries = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await make();
    } catch (e) {
      if (attempt < maxRateWaits && isRateLimited(e)) { await sleep(0); continue; }
      if (serverRetries < maxServerRetries && isTransientServerError(e)) {
        await sleep(500 * (serverRetries + 1) ** 2);
        serverRetries += 1;
        continue;
      }
      throw e;
    }
  }
}

const noSleep = async () => {};
const fail = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('un 503 puntual no tumba la operación', async () => {
  let calls = 0;
  const result = await withProviderRetries(false, async () => {
    calls += 1;
    if (calls === 1) throw fail(503);
    return 'ok';
  }, noSleep);
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('un proveedor caído del todo falla, pero después de intentarlo tres veces', async () => {
  let calls = 0;
  await assert.rejects(() => withProviderRetries(false, async () => { calls += 1; throw fail(500); }, noSleep));
  assert.equal(calls, 3, 'el intento original y dos reintentos');
});

test('la espera entre reintentos crece', async () => {
  const waits = [];
  let calls = 0;
  await withProviderRetries(false, async () => {
    calls += 1;
    if (calls < 3) throw fail(502);
    return 'ok';
  }, async (ms) => { waits.push(ms); });
  assert.deepEqual(waits, [500, 2000]);
});

test('un 429 en cuenta de pago sube al momento: lo gestiona la cola', async () => {
  let calls = 0;
  await assert.rejects(() => withProviderRetries(false, async () => { calls += 1; throw fail(429); }, noSleep));
  assert.equal(calls, 1);
});

test('un 429 en capa gratuita se espera', async () => {
  let calls = 0;
  const result = await withProviderRetries(true, async () => {
    calls += 1;
    if (calls < 3) throw fail(429);
    return 'ok';
  }, noSleep);
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('un 400 no se reintenta: la petición está mal y repetirla no la arregla', async () => {
  let calls = 0;
  await assert.rejects(() => withProviderRetries(true, async () => { calls += 1; throw fail(400); }, noSleep));
  assert.equal(calls, 1);
});
