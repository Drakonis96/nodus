import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MultiSelectDropdown } from '../../../src/components/library/MultiSelectDropdown';
import { setActiveLang } from '../../../src/i18n';
const fixture = window as any;
fixture.changes = [];
const tags = Array.from({ length: 12 }, (_, index) => ({ value: `tag-${index + 1}`, label: `Etiqueta ${index + 1}`, count: 12 - index }));
function App() {
  const [types, setTypes] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  return <div style={{ padding: 16, width: 520, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
    <MultiSelectDropdown testId="types" label="Tipo" icon="file" selected={types}
      options={[{ value: 'book', label: 'Libro', count: 4 }, { value: 'article', label: 'Artículo', count: 9 }, { value: 'thesis', label: 'Tesis', count: 1 }]}
      onChange={(next) => { fixture.changes.push(next); setTypes(next); }} />
    <MultiSelectDropdown testId="tags" label="Etiquetas" icon="tag" selected={selectedTags} options={tags} onChange={setSelectedTags} />
  </div>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
