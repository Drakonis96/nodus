import { ConfirmModal } from './ConfirmModal';
import { t, tx } from '../i18n';

export type LinkedKnowledgeDeleteStep = 'sources' | 'knowledge';

export interface LinkedKnowledgeDeleteItem {
  id: string;
  title: string;
}

/**
 * Shared two-step delete flow for study sources. The source is not mutated until
 * the second dialog has an explicit answer, so Escape/backdrop can still cancel
 * the complete operation without leaving a half-applied deletion behind.
 */
export function LinkedKnowledgeDeleteFlow({
  items,
  step,
  zIndex,
  onContinue,
  onChoose,
  onCancel,
}: {
  items: LinkedKnowledgeDeleteItem[];
  step: LinkedKnowledgeDeleteStep;
  zIndex?: number;
  onContinue: () => void;
  onChoose: (purgeLinkedKnowledge: boolean) => void;
  onCancel: () => void;
}) {
  if (!items.length) return null;
  const single = items.length === 1;

  if (step === 'sources') {
    return <ConfirmModal
      title={t(single ? 'Mover documento a la papelera' : 'Mover documentos a la papelera')}
      message={single
        ? tx('«{name}» dejará de aparecer. Podrás recuperarlo desde la administración de datos.', { name: items[0].title })
        : tx('Los {n} documentos seleccionados dejarán de aparecer. Podrás recuperarlos desde la administración de datos.', { n: items.length })}
      confirmLabel={t('Continuar')}
      danger
      zIndex={zIndex}
      onConfirm={onContinue}
      onCancel={onCancel}
    />;
  }

  return <ConfirmModal
    title={t('¿Eliminar también las ideas vinculadas?')}
    message={t('Se eliminarán las ideas que solo proceden de estos documentos, junto con sus embeddings, evidencia y conexiones. Las ideas compartidas con otras fuentes se conservarán.')}
    confirmLabel={t('Eliminar ideas y embeddings')}
    rememberLabel={t('Conservar ideas')}
    cancelLabel={t('Cancelar operación')}
    danger
    zIndex={zIndex}
    onConfirm={() => onChoose(true)}
    onRemember={() => onChoose(false)}
    onCancel={onCancel}
  />;
}
