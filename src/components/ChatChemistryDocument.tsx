import type { ChemistryDocument, ChemistryChemfigExport } from '@shared/chemistryDocument';
import { ChatVisual } from './ChatVisual';
import { t } from '../i18n';

/** Application-produced versioned record. It is never accepted as a model tool invocation. */
export function ChatChemistryDocument({ source }: { source: string }) {
  let document: ChemistryDocument;
  try {
    if (source.length > 2_000_000) throw new Error();
    document = JSON.parse(source);
    if (!document || document.version !== 2
      || !(document.status === 'verified' && document.scope === 'reference-graph-and-molfile-roundtrip'
        || document.status === 'partial' && document.scope === 'graph-valid-validation-incomplete')
      || !Array.isArray(document.species) || document.species.length < 1 || document.species.length > (document.reaction ? 12 : 4)
      || document.species.some(s => !s || !s.input || typeof s.input.value !== 'string' || typeof s.svg !== 'string' || !Array.isArray(s.references)
        || s.references.some(ref => !ref || !['user', 'opsin', 'pubchem'].includes(ref.provider)))
      || (document.reaction && (document.mechanism || document.reaction.scope !== 'balanced-scheme-not-mechanism'
        || typeof document.reaction.svg !== 'string' || document.reaction.chemfig?.status !== 'validated' || typeof document.reaction.chemfig.source !== 'string'
        || !Array.isArray(document.reaction.limitations) || document.reaction.limitations.some(text => typeof text !== 'string')
        || !Array.isArray(document.reaction.species) || document.reaction.species.length !== document.species.length
        || !document.reaction.species.some(s => s?.role === 'reactant') || !document.reaction.species.some(s => s?.role === 'product')
        || document.reaction.species.some((s, i) => !s || s.id !== document.species[i].id || typeof s.smiles !== 'string' || !['reactant', 'product', 'agent'].includes(s.role) || !Number.isInteger(s.coefficient) || s.coefficient < 1 || s.coefficient > 12)))
      || (document.mechanism && (typeof document.mechanism.svg !== 'string' || !Array.isArray(document.mechanism.limitations)
        || document.mechanism.limitations.some(text => typeof text !== 'string')
        || (document.mechanism.panels != null && (!Array.isArray(document.mechanism.panels) || document.mechanism.panels.length > 8
          || document.mechanism.panels.some(panel => !panel || typeof panel.svg !== 'string' || !panel.chemfig || panel.panels != null)))))) throw new Error();
  } catch {
    return <div className="chat-visual-error" role="alert">{t("Chemistry Studio: documento químico inválido.")}</div>;
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = window.document.createElement('a'); link.href = url; link.download = 'chemistry-document-v2.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const chemfigButton = (exported?: ChemistryChemfigExport) => {
    if (!exported) return null;
    if (exported.status !== 'validated' || typeof exported.source !== 'string') return <p>{t('ChemFig no exportado:')} {exported.reason ?? t("No ha superado la validación.")}</p>;
    return <button className="btn btn-secondary my-2 text-xs" type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([exported.source!], { type: 'text/plain' }));
      const link = window.document.createElement('a'); link.href = url; link.download = 'structure.chemfig.tex'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{t("Descargar fragmento ChemFig contrastado")}</button>;
  };
  const mechanism = document.mechanism;
  const reaction = document.reaction;
  const mechanismTitle = (rule: string) => ({ sn2: t("SN2: mecanismo condicional"), e2: t("E2: alternativas anti-periplanares"), aldol: t("Adición aldólica: mecanismo por etapas"), 'diels-alder': t("Diels–Alder: cicloadición suprafacial"), 'amide-resonance': t("Contribuyentes de resonancia de amida") }[rule] ?? t("Mecanismo químico"));
  // A partial document is drawn by the same renderer, so only the badge may claim
  // less: never let a partially validated drawing wear a "checked" label.
  const partial = document.status === 'partial';
  const provenance = (checked: string) => partial ? t("Grafo válido; verificación incompleta") : checked;
  return <section aria-label="Chemistry Studio" className="space-y-3">
    {reaction && <div>
      <ChatVisual svg={reaction.svg} alt={t("Esquema balanceado; mecanismo no verificado")} kindLabel="Chemistry Studio" provenanceLabel={provenance(t("Esquema balanceado; mecanismo no verificado"))} />
      {reaction.limitations.map((text, i) => <p key={i}>{text}</p>)}
      {chemfigButton(reaction.chemfig)}
    </div>}
    {mechanism && typeof mechanism.svg === 'string' && Array.isArray(mechanism.limitations) && <div>
      {!mechanism.panels && <ChatVisual svg={mechanism.svg} alt={mechanismTitle(mechanism.rule)} kindLabel="Chemistry Studio" provenanceLabel={provenance(t("Regla y balance contrastados"))} />}
      {mechanism.limitations.map((text, i) => <p key={i}>{text}</p>)}
      {/^https:\/\/openstax\.org\/books\/organic-chemistry\/pages\//.test(mechanism.source) && <p><a href={mechanism.source} target="_blank" rel="noreferrer">{t("Fundamento de la regla")}</a></p>}
      {chemfigButton(mechanism.chemfig)}
      {mechanism.panels?.map((panel, i) => <div key={i}>
        <p>{panel.title ?? t('Panel {number}').replace('{number}', String(i + 1))}</p>
        <ChatVisual svg={panel.svg} alt={panel.title ?? t('Panel {number}').replace('{number}', String(i + 1))} kindLabel="Chemistry Studio" provenanceLabel={provenance(t("Etapa o alternativa contrastada"))} />
        {chemfigButton(panel.chemfig)}
      </div>)}
    </div>}
    {document.species.map((species, i) => <div key={i}>
      {reaction && <p>{reaction.species[i].coefficient} × {species.input.value} ({reaction.species[i].role === 'reactant' ? t("Reactivo") : reaction.species[i].role === 'product' ? t("Producto") : t("Agente; excluido del balance")})</p>}
      {!mechanism && !reaction && <>
      <ChatVisual svg={species.svg} alt={species.input.value} kindLabel="Chemistry Studio" provenanceLabel={provenance(t("Grafo contrastado"))} />
      {species.depiction && species.depiction !== 'skeletal' && <p>{species.depiction === 'newman' ? species.projection?.convention : species.depiction === 'fischer' ? t("Fischer: enlaces horizontales hacia el observador; verticales hacia atrás.") : t("Haworth: sustituyentes verticales por encima o por debajo del plano idealizado del anillo.")}</p>}
      {chemfigButton(species.chemfig)}
      </>}
      <p>{species.input.kind === 'smiles' ? t("Validado frente al SMILES aportado; no acredita un nombre de compuesto.") : t("Identidad de referencia y estereoquímica conservadas en la conversión molecular.")}</p>
      <p>{species.references.map((ref, j) => {
        const safeURL = typeof ref.url === 'string' && /^https:\/\/(www\.ebi\.ac\.uk\/opsin\/ws\/|pubchem\.ncbi\.nlm\.nih\.gov\/compound\/\d+$)/.test(ref.url);
        return <span key={j}>{j > 0 ? ' · ' : ''}{safeURL ? <a href={ref.url} target="_blank" rel="noreferrer">{ref.provider}</a> : ref.provider}</span>;
      })}</p>
    </div>)}
    <p>{t("La comprobación cubre el grafo y la convención o regla indicada; no garantiza todos los detalles visuales ni predice condiciones, rendimiento o producto mayoritario.")}</p>
    <button className="btn btn-secondary my-2 text-xs" type="button" onClick={download}>{t("Descargar estructura y evidencias (JSON)")}</button>
  </section>;
}
