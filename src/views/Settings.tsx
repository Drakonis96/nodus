import { useState } from 'react';
import type { AppSettings } from '@shared/types';
import { ProvidersSettings } from './ProvidersSettings';

export function Settings({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<unknown> }) {
  const [saved, setSaved] = useState<string | null>(null);

  const patch = async (p: Partial<AppSettings>) => {
    await window.nodus.updateSettings(p);
    await onChange();
  };

  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(null), 2000);
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">Ajustes</h1>

      <ProvidersSettings settings={settings} onChange={onChange} />

      <Section title="IA (avanzado)">
        <Row label="Modelo de embeddings (OpenAI)">
          <input className="input" value={settings.embeddingModel} onChange={(e) => patch({ embeddingModel: e.target.value })} />
        </Row>
        <Row label="Llamadas simultáneas">
          <input
            type="number"
            min={1}
            max={5}
            className="input w-20"
            value={settings.concurrency}
            onChange={(e) => patch({ concurrency: parseInt(e.target.value) || 1 })}
          />
        </Row>
        <Row label="Email Unpaywall (fallback de texto)">
          <input className="input" value={settings.unpaywallEmail} onChange={(e) => patch({ unpaywallEmail: e.target.value })} />
        </Row>
      </Section>

      <Section title="Zotero y sincronización">
        <Row label="Modo de sincronización">
          <select className="input" value={settings.syncMode} onChange={(e) => patch({ syncMode: e.target.value as any })}>
            <option value="manual">Manual</option>
            <option value="realtime">Tiempo real</option>
          </select>
        </Row>
        <Row label="Tag de escaneo profundo">
          <input className="input" value={settings.readTag} onChange={(e) => patch({ readTag: e.target.value })} />
        </Row>
        <Row label="Ruta de storage de Zotero">
          <input
            className="input w-full"
            value={settings.zoteroStoragePath}
            onChange={(e) => patch({ zoteroStoragePath: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="Extracción de texto (PDFs grandes)">
        <Row label="Reusar texto indexado por Zotero">
          <input
            type="checkbox"
            checked={settings.preferZoteroFulltext}
            onChange={(e) => patch({ preferZoteroFulltext: e.target.checked })}
          />
        </Row>
        <Row label="OCR para PDFs escaneados">
          <input type="checkbox" checked={settings.ocrEnabled} onChange={(e) => patch({ ocrEnabled: e.target.checked })} />
        </Row>
        <Row label="Idiomas de OCR (Tesseract)">
          <input
            className="input"
            value={settings.ocrLanguages}
            onChange={(e) => patch({ ocrLanguages: e.target.value })}
            placeholder="spa+eng"
          />
        </Row>
        <Row label="Máx. páginas a OCR por obra">
          <input
            type="number"
            min={1}
            max={2000}
            className="input w-24"
            value={settings.ocrMaxPages}
            onChange={(e) => patch({ ocrMaxPages: parseInt(e.target.value) || 1 })}
          />
        </Row>
        <p className="text-xs text-neutral-500">
          El OCR es local pero descarga los datos de idioma de Tesseract la primera vez. Desactivado por defecto.
        </p>
      </Section>

      <Section title="Apariencia">
        <Row label="Tema">
          <select className="input" value={settings.theme} onChange={(e) => patch({ theme: e.target.value as any })}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </Row>
        <Row label="Velocidad de animaciones">
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.animationSpeed}
            onChange={(e) => patch({ animationSpeed: parseFloat(e.target.value) })}
          />
        </Row>
      </Section>

      <Section title="Datos">
        <div className="flex gap-2">
          <button className="btn btn-ghost border border-neutral-700" onClick={() => window.nodus.exportData().then((r) => r && flash(`Exportado: ${r.path}`))}>
            Exportar (.nodus)
          </button>
          <button
            className="btn btn-ghost border border-neutral-700"
            onClick={() => window.nodus.importData().then((r) => flash(r.message))}
          >
            Importar (.nodus)
          </button>
        </div>
      </Section>

      {saved && <div className="fixed bottom-20 right-6 card px-4 py-2 text-sm text-emerald-400">{saved}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-neutral-300">{label}</label>
      <div>{children}</div>
    </div>
  );
}
