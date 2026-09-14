import type { CapabilityChatResult } from '../../skill-capabilities/contracts';
import { ChatModelViewer } from './ChatModelViewer';
import { ChatVisual } from './ChatVisual';
import { Icon } from './ui';

interface Envelope { capabilityId: string; pluginId: string; result: CapabilityChatResult }

export function ChatCapabilityResult({ source }: { source: string }) {
  let value: Envelope;
  try {
    value = JSON.parse(source) as Envelope;
    if (!value || typeof value.capabilityId !== 'string' || typeof value.pluginId !== 'string' || !value.result || typeof value.result.kind !== 'string') throw new Error();
  } catch { return <div className="chat-visual-error" role="alert">The capability result is invalid.</div>; }
  const result = value.result;
  if (result.kind === 'svg') return <ChatVisual svg={result.svg} kindLabel={value.capabilityId} provenanceLabel={value.pluginId} />;
  if (result.kind === 'image') return <ChatVisual source={result.source} alt={result.alt} kindLabel={value.capabilityId} provenanceLabel={value.pluginId} />;
  return <section className="chat-visual chat-capability-result" data-testid="chat-capability-result">
    <span className="chat-visual-head"><span className="chat-visual-kind"><Icon name="sparkles" size={13} />{value.capabilityId}</span><span className="chat-visual-original">{value.pluginId}</span></span>
    {result.kind === 'model' && <>{result.panels.map(panel => {
      const match = /^nodus-capability:\/\/chat\/([a-f0-9]{64})\/([a-f0-9-]{36})$/.exec(panel.source);
      return match ? <ChatModelViewer key={panel.source} owner={match[1]} node={{ kind: 'model', attachmentId: match[2], title: panel.title, alt: panel.alt, bytes: panel.bytes, name: panel.name, mimeType: panel.mimeType }} /> : <p role="alert">Invalid model reference.</p>;
    })}<details><summary>Provenance</summary><pre>{JSON.stringify(result.metadata, null, 2)}</pre></details></>}
    {result.kind === 'text' && <pre className="whitespace-pre-wrap">{result.text}</pre>}
    {result.kind === 'json' && <pre>{JSON.stringify(result.value, null, 2)}</pre>}
    {result.kind === 'table' && <div className="overflow-auto"><table><thead><tr>{result.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex}>{String(cell ?? '')}</td>)}</tr>)}</tbody></table></div>}
    {result.kind === 'file' && <button type="button" className="chat-skill-primary" onClick={() => void window.nodus.downloadCapabilityFile(result.source)}><Icon name="download" size={15} />{result.title || result.name}</button>}
  </section>;
}
