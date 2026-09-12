import { sanitizeChatSvg, svgImageUrl } from '../lib/chatSvg';
import type { ViewDocumentV1, ViewNode, ViewSpan } from '@shared/capabilities';
import { ChatVisual } from './ChatVisual';
import { Icon } from './ui';
import { ChatModelViewer } from './ChatModelViewer';
import { ViewChart, ViewComparison, ViewMath, ViewPassage, ViewTree } from './capabilityViewData';
import { ViewAudio, ViewImage, ViewImageTiles, ViewMap } from './capabilityViewAssets';
import { t } from '../i18n';

/** Renders a declarative view a capability returned.
 *
 *  Everything here is data the main process already validated: there is no HTML to inject,
 *  no script to run and no component a package can name. A node kind this build does not
 *  know is skipped rather than guessed at, so an older Nodus renders a newer package's
 *  result without breaking on the parts it cannot show.
 */

function Spans({ spans }: { spans: ViewSpan[] }) {
  return <>{spans.map((span, index) => {
    const text = span.emphasis === 'strong' ? <strong>{span.text}</strong>
      : span.emphasis === 'em' ? <em>{span.text}</em>
        : span.emphasis === 'code' ? <code>{span.text}</code>
          : span.text;
    // Links are https by contract and open outside the app, never in place.
    return span.href
      ? <a key={index} href={span.href} target="_blank" rel="noreferrer noopener">{text}</a>
      : <span key={index}>{text}</span>;
  })}</>;
}

function Node({ node, owner, capabilityId, presentation = 'chat' }: { node: ViewNode; owner?: string; capabilityId?: string; presentation?: 'chat' | 'document' | 'snapshot' }) {
  switch (node.kind) {
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[node.level - 1];
      return <Tag className="capability-view-heading">{node.text}</Tag>;
    }
    case 'paragraph':
      return <p><Spans spans={node.spans} /></p>;
    case 'list':
      return node.ordered
        ? <ol className="capability-view-list">{node.items.map((item, index) => <li key={index}><Spans spans={item} /></li>)}</ol>
        : <ul className="capability-view-list">{node.items.map((item, index) => <li key={index}><Spans spans={item} /></li>)}</ul>;
    case 'badges':
      return <p className="capability-view-badges">{node.items.map((item, index) => <span key={index} className="capability-view-badge" data-tone={item.tone ?? 'neutral'}>{item.label}</span>)}</p>;
    case 'notice':
      return <div className="capability-view-notice" data-tone={node.tone} role={node.tone === 'danger' ? 'alert' : 'note'}>
        {node.title && <b>{node.title}</b>}<span><Spans spans={node.spans} /></span>
      </div>;
    case 'svg': {
      const clean = presentation === 'chat' ? null : sanitizeChatSvg(node.svg);
      return presentation === 'chat' ? <ChatVisual svg={node.svg} alt={node.alt} kindLabel={node.title} /> : clean ? <img className="document-view-svg" src={svgImageUrl(clean.svg)} alt={node.alt} /> : null;
    }
    case 'table':
      return <div className="capability-view-table">
        <table>
          {node.caption && <caption>{node.caption}</caption>}
          <thead><tr>{node.columns.map((column, index) => <th key={index} style={column.align === 'end' ? { textAlign: 'right' } : undefined}>{column.label}</th>)}</tr></thead>
          <tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) =>
            <td key={cellIndex} style={node.columns[cellIndex]?.align === 'end' ? { textAlign: 'right' } : undefined}>{cell === null ? '' : String(cell)}</td>)}</tr>)}</tbody>
        </table>
      </div>;
    case 'code':
      return <pre className="capability-view-code"><code>{node.text}</code></pre>;
    case 'links':
      return <ul className="capability-view-links">{node.items.map((item, index) =>
        <li key={index}><a href={item.href} target="_blank" rel="noreferrer noopener">{item.label}</a>{item.description && <span>{item.description}</span>}</li>)}</ul>;
    case 'details':
      return <details className="capability-view-details" open={presentation === 'snapshot' ? true : undefined}><summary>{node.summary}</summary>{node.children.map((child, index) => <Node key={index} node={child} owner={owner} capabilityId={capabilityId} presentation={presentation} />)}</details>;
    case 'download':
      // The bytes were stored as an attachment when the result was produced; the id is
      // resolved against the conversation that owns it, never against a path the view chose.
      return <button type="button" className="chat-skill-primary capability-view-download"
        disabled={!owner}
        onClick={() => void window.nodus.downloadCapabilityFile(`nodus-capability://chat/${owner}/${node.attachmentId}`)}>
        <Icon name="download" size={15} />{node.label}
        <span className="capability-view-download-meta">{node.name} · {formatBytes(node.bytes)}</span>
      </button>;
    case 'model':
      // `nodus:3d`. The package supplied bytes the core validated and stored; what draws
      // them is the core's own viewer, never anything that came with the package.
      return <ChatModelViewer node={node} owner={owner} staticPreview={presentation === 'snapshot'} />;
    case 'image':
      return <ViewImage node={node} owner={owner} />;
    case 'audio':
      return <ViewAudio node={node} owner={owner} />;
    case 'math':
      return <ViewMath node={node} />;
    case 'chart':
      return <ViewChart node={node} />;
    case 'tree':
      return <ViewTree node={node} />;
    case 'passage':
      return <ViewPassage node={node} />;
    case 'comparison':
      return <ViewComparison node={node} />;
    case 'map':
      return <ViewMap node={node} />;
    case 'imageTiles':
      return <ViewImageTiles node={node} capabilityId={capabilityId} />;
    case 'status':
      return <p className="capability-view-status" data-state={node.state} role="status">
        <Icon name={node.state === 'ok' ? 'check' : node.state === 'failed' ? 'alert' : 'clock'} size={14} />
        <b>{node.label}</b>{node.description && <span>{node.description}</span>}
      </p>;
    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CapabilityView({ view, owner, capabilityId, presentation = 'chat' }: { view: ViewDocumentV1; owner?: string; capabilityId?: string; presentation?: 'chat' | 'document' | 'snapshot' }) {
  return <div className={`capability-view capability-view-${presentation}`} aria-label={view.summary}>
    {view.title && <h3 className="capability-view-title">{view.title}</h3>}
    {view.nodes.map((node, index) => <Node key={index} node={node} owner={owner} capabilityId={capabilityId} presentation={presentation} />)}
  </div>;
}

/** A view that travelled inline in the reply, with the provider it came from. */
export function ChatCapabilityView({ source }: { source: string }) {
  let payload: { capabilityId: string; plugin?: { id: string; version: string }; owner?: string; view: ViewDocumentV1 };
  try {
    payload = JSON.parse(source);
    if (!payload?.view?.nodes?.length) throw new Error('empty view');
  } catch {
    return <div className="chat-visual-error" role="alert">{t('El resultado de la capability no se pudo leer.')}</div>;
  }
  return <section className="chat-visual chat-capability-result">
    <span className="chat-visual-head">
      <span className="chat-visual-kind"><Icon name="sparkles" size={13} />{payload.capabilityId}</span>
      {payload.plugin && <span className="chat-visual-original">{payload.plugin.id} {payload.plugin.version}</span>}
    </span>
    <CapabilityView view={payload.view} owner={payload.owner} capabilityId={payload.capabilityId} />
  </section>;
}
