import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AiProvider, ZoteroCollection } from '@shared/types';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [ping, setPing] = useState<{ ok: boolean; userId?: string; message?: string } | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readTag, setReadTag] = useState('leído');
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [apiKey, setApiKey] = useState('');
  const [storagePath, setStoragePath] = useState('');

  const checkZotero = async () => {
    const res = await window.nodus.zoteroPing();
    setPing(res);
    if (res.ok) {
      const cols = await window.nodus.zoteroCollections().catch(() => []);
      setCollections(cols);
    }
  };

  useEffect(() => {
    void checkZotero();
  }, []);

  const finish = async () => {
    if (apiKey.trim()) await window.nodus.setApiKey(apiKey.trim());
    await window.nodus.updateSettings({
      monitoredCollections: Array.from(selected),
      readTag,
      aiProvider: provider,
      aiModel: model,
      zoteroStoragePath: storagePath,
      onboardingComplete: true,
    });
    // First full ingest of the chosen collections.
    void window.nodus.syncNow();
    onDone();
  };

  const steps = ['Conectar Zotero', 'Colecciones', 'Escaneo profundo', 'Proveedor de IA'];

  return (
    <div className="h-full flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card w-full max-w-2xl p-8"
      >
        <div className="text-2xl font-semibold mb-1">Bienvenido a Nodus</div>
        <p className="text-neutral-400 text-sm mb-6">
          Teje tu biblioteca de Zotero en un grafo navegable de ideas y autores. Todo es local.
        </p>

        <div className="flex gap-2 mb-6">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 text-center text-xs py-1.5 rounded-lg ${
                i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-900 text-neutral-600'
              }`}
            >
              {s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm">
              Nodus usa la API local de Zotero 7 (solo lectura). Abre Zotero y verifica la conexión.
            </p>
            <button className="btn btn-primary" onClick={checkZotero}>
              Verificar conexión
            </button>
            {ping && (
              <div className={`text-sm ${ping.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {ping.ok ? `Conectado (userID ${ping.userId})` : `No disponible: ${ping.message ?? 'sin respuesta'}`}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">Elige las colecciones a monitorizar (escaneo ligero).</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {collections.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={selected.has(c.key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      e.target.checked ? next.add(c.key) : next.delete(c.key);
                      setSelected(next);
                    }}
                  />
                  {c.name} <span className="text-neutral-600">({c.itemCount})</span>
                </label>
              ))}
              {collections.length === 0 && <div className="text-neutral-500 text-sm">No hay colecciones cargadas.</div>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="block text-sm">
              Tag que dispara el escaneo profundo
              <input className="input w-full mt-1" value={readTag} onChange={(e) => setReadTag(e.target.value)} />
            </label>
            <label className="block text-sm">
              Ruta de la carpeta <code>storage</code> de Zotero (opcional, para localizar PDFs)
              <input
                className="input w-full mt-1"
                value={storagePath}
                placeholder="/Users/tu/Zotero/storage"
                onChange={(e) => setStoragePath(e.target.value)}
              />
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <label className="block text-sm">
              Proveedor
              <select
                className="input w-full mt-1"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as AiProvider;
                  setProvider(p);
                  setModel(p === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o');
                }}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            <label className="block text-sm">
              Modelo
              <input className="input w-full mt-1" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="block text-sm">
              Clave de IA (se guarda cifrada, nunca se exporta)
              <input
                type="password"
                className="input w-full mt-1"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="flex justify-between mt-8">
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Atrás
          </button>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              Siguiente
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Empezar
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
