import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { academicSnapshot, PDF_BYTES, PNG_BYTES, publish, sha256 } from './lib/nodusServerFixtures.mjs';
import { repoRoot, withServer } from './lib/nodusServerHarness.mjs';

await withServer({ label: 'server-web-parity-qa', ai: true }, async (server) => {
  const spaceId = await server.createSpace('Atlas de memoria');
  await server.setPublicationPolicy(spaceId, ['allowUserContent', 'allowLibraryDocuments', 'allowPassages']);
  const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Parity QA publisher');
  const image = await readFile(path.join(repoRoot, 'src', 'assets', 'mobile-teaser', '08-deep-research.webp'));
  const hash = sha256(image);
  const uploaded = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/assets/${hash}`, {
    body: image,
    headers: { 'content-type': 'image/webp' },
  });
  assert.equal(uploaded.status, 200, await uploaded.text());

  const libraryPackage = new AdmZip();
  libraryPackage.addFile('document.md', Buffer.from('# Archivo, memoria y ciudad\n\nLa memoria colectiva transforma el archivo en un espacio vivo.\n\n![Mapa conceptual](assets/figure.png)'));
  libraryPackage.addFile('assets/figure.png', PNG_BYTES);
  libraryPackage.addFile('original/document.pdf', PDF_BYTES);
  libraryPackage.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'nodus.library-document-package',
    formatVersion: 2,
    documentId: 'library-doc-1',
    title: 'Archivo, memoria y ciudad',
    figures: 1,
    cleanMarkdown: true,
    original: { path: 'original/document.pdf', fileName: 'archivo-memoria.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES.length },
  })));
  const libraryBytes = libraryPackage.toBuffer();
  const libraryHash = sha256(libraryBytes);
  const uploadedLibrary = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/library/packages/${libraryHash}`, {
    body: libraryBytes,
    headers: { 'content-type': 'application/zip' },
  });
  assert.equal(uploadedLibrary.status, 200, await uploadedLibrary.text());

  const stamp = '2026-08-27T12:00:00.000Z';
  await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot({
    library: {
      format: 'nodus.server-library',
      formatVersion: 1,
      generatedAt: stamp,
      collections: [{ id: 'collection-1', name: 'Teoría del archivo', icon: null, color: '#8b5cf6', parentId: null, position: 0, directItemCount: 1, updatedAt: stamp }],
      documents: [{
        id: 'library-doc-1', title: 'Archivo, memoria y ciudad', itemType: 'book', creators: ['Ada Lovelace'],
        abstract: 'Una lectura sobre archivos vivos.', date: '1843', year: 1843, language: 'es', publisher: 'Nodus Press',
        publicationTitle: null, volume: null, issue: null, pages: null, edition: null, place: null, rights: null,
        doi: null, pmid: null, pmcid: null, arxiv: null, isbn: [], issn: [], url: null, citationKey: 'lovelace1843',
        reference: 'Lovelace, A. (1843). Archivo, memoria y ciudad.', tags: ['memoria', 'archivo'], collectionIds: ['collection-1'],
        updatedAt: stamp, cleanAvailable: true, wordCount: 16, figureCount: 1, packageHash: libraryHash,
        packageBytes: libraryBytes.length, originalAvailable: true, originalFileName: 'archivo-memoria.pdf', originalMimeType: 'application/pdf', originalBytes: PDF_BYTES.length,
      }],
    },
    assets: [{
      hash,
      thumbHash: null,
      mime: 'image/webp',
      thumbMime: null,
      bytes: image.length,
      thumbBytes: null,
      kind: 'deep_research_image',
      table: 'decorative_images',
      key: ['deep_research', 'dr-illustrated'],
    }],
    tables: {
      themes: [
        { theme_id: 't-1', label: 'Memoria', created_at: stamp },
        { theme_id: 't-2', label: 'Archivo', created_at: stamp },
        { theme_id: 't-3', label: 'Materialidad', created_at: stamp },
      ],
      idea_theme_links: [
        { nodus_id: 'w-1', global_id: 'i-a', theme_id: 't-1', confidence: 0.9, basis: 'llm' },
        { nodus_id: 'w-2', global_id: 'i-b', theme_id: 't-1', confidence: 0.8, basis: 'llm' },
        { nodus_id: 'w-1', global_id: 'i-a', theme_id: 't-2', confidence: 0.92, basis: 'llm' },
        { nodus_id: 'w-2', global_id: 'i-c', theme_id: 't-3', confidence: 0.78, basis: 'llm' },
      ],
      writing_saved_drafts: [{
        id: 'dr-illustrated',
        title: 'Memoria, archivo y materialidad',
        brief_json: JSON.stringify({ kind: 'deep_research', objective: 'Reconstruir el estado de la cuestión', language: 'es' }),
        selection_json: '{}',
        model_json: '{}',
        draft_json: JSON.stringify({
          generatedAt: stamp,
          brief: { kind: 'deep_research', objective: 'Reconstruir el estado de la cuestión', language: 'es' },
          title: 'Memoria, archivo y materialidad',
          abstract: 'Un análisis comparado de las principales posiciones del corpus.',
          outline: [
            { id: 's1', title: 'El archivo como tecnología', purpose: '', keyClaims: [], sources: [] },
            { id: 's2', title: 'La memoria como práctica', purpose: '', keyClaims: [], sources: [] },
          ],
          draftMarkdown: '## El archivo como tecnología\n\nEl corpus presenta el archivo como una infraestructura activa de la memoria.\n\n## La memoria como práctica\n\nLas posiciones comparadas muestran tensiones productivas entre conservación y transformación.',
          matrix: [],
          bibliography: [],
          nextSteps: ['Ampliar el corpus comparado.'],
          limitations: ['Corpus de demostración.'],
          stats: { selectedIdeas: 3, selectedWorks: 2 },
        }),
        created_at: stamp,
        updated_at: stamp,
      }],
    },
  }));

  process.stdout.write(`${JSON.stringify({
    origin: server.origin,
    email: server.adminEmail,
    password: server.adminPassword,
    spaceId,
  })}\n`);

  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
});
