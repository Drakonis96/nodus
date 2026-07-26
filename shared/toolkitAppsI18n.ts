import type { AppLanguage } from './types';
import type { ToolkitAppManifest } from './toolkitApps';

type IncludedAppMeta = { title: string; summary: string };

const INCLUDED_META: Record<string, Record<AppLanguage, IncludedAppMeta>> = {
  'Ruleta de opciones': {
    es: { title: 'Ruleta de opciones', summary: 'Añade tus alternativas, gira la ruleta y deja que el azar elija una por ti.' },
    en: { title: 'Options wheel', summary: 'Add your alternatives, spin the wheel and let chance choose one for you.' },
    fr: { title: 'Roue des options', summary: 'Ajoutez vos possibilités, tournez la roue et laissez le hasard choisir.' },
    de: { title: 'Optionsrad', summary: 'Fügen Sie Möglichkeiten hinzu, drehen Sie das Rad und lassen Sie den Zufall entscheiden.' },
    pt: { title: 'Roda de opções', summary: 'Adiciona as alternativas, gira a roda e deixa o acaso escolher por ti.' },
    'pt-BR': { title: 'Roleta de opções', summary: 'Adicione as alternativas, gire a roleta e deixe o acaso escolher por você.' },
    it: { title: 'Ruota delle opzioni', summary: 'Aggiungi le alternative, gira la ruota e lascia scegliere al caso.' },
    tr: { title: 'Seçenek çarkı', summary: 'Alternatiflerinizi ekleyin, çarkı çevirin ve seçimi şansa bırakın.' },
  },
  'Repartidor de temas': {
    es: { title: 'Repartidor de temas', summary: 'Reparte temas únicos entre grupos e incluye temas excepcionales solo cuando los necesites.' },
    en: { title: 'Topic distributor', summary: 'Assign unique topics to groups and include exceptional topics only when needed.' },
    fr: { title: 'Répartiteur de sujets', summary: 'Répartissez des sujets uniques entre les groupes et ajoutez des sujets exceptionnels si nécessaire.' },
    de: { title: 'Themenverteiler', summary: 'Verteilen Sie eindeutige Themen auf Gruppen und ergänzen Sie Ausnahmethemen nur bei Bedarf.' },
    pt: { title: 'Distribuidor de temas', summary: 'Distribui temas únicos pelos grupos e inclui temas excecionais apenas quando necessário.' },
    'pt-BR': { title: 'Distribuidor de temas', summary: 'Distribua temas únicos entre os grupos e inclua temas excepcionais somente quando necessário.' },
    it: { title: 'Distributore di argomenti', summary: 'Distribuisci argomenti unici tra i gruppi e includi quelli eccezionali solo quando servono.' },
    tr: { title: 'Konu dağıtıcısı', summary: 'Benzersiz konuları gruplara dağıtın ve özel konuları yalnızca gerektiğinde ekleyin.' },
  },
  'Lluvia de ideas': {
    es: { title: 'Lluvia de ideas', summary: 'Recoge ideas del alumnado por QR y muéstralas automáticamente en un mural compartido.' },
    en: { title: 'Brainstorm', summary: 'Collect students’ ideas by QR and display them automatically on a shared wall.' },
    fr: { title: 'Remue-méninges', summary: 'Recueillez les idées des élèves par QR et affichez-les automatiquement sur un mur partagé.' },
    de: { title: 'Ideensammlung', summary: 'Sammeln Sie Ideen der Lernenden per QR und zeigen Sie sie automatisch auf einer gemeinsamen Ideenwand.' },
    pt: { title: 'Chuva de ideias', summary: 'Recolhe ideias dos alunos por QR e apresenta-as automaticamente num mural partilhado.' },
    'pt-BR': { title: 'Chuva de ideias', summary: 'Receba ideias dos estudantes por QR e exiba-as automaticamente em um mural compartilhado.' },
    it: { title: 'Raccolta di idee', summary: 'Raccogli le idee degli studenti tramite QR e mostrale automaticamente su una bacheca condivisa.' },
    tr: { title: 'Fikir fırtınası', summary: 'Öğrencilerin fikirlerini QR ile toplayın ve paylaşılan bir panoda otomatik olarak gösterin.' },
  },
};

/** Included apps have Spanish source metadata; user-created apps keep their own copy. */
export function localizedIncludedToolkitAppMeta(
  manifest: Pick<ToolkitAppManifest, 'title' | 'summary'>,
  language: AppLanguage
): IncludedAppMeta {
  return INCLUDED_META[manifest.title]?.[language] ?? { title: manifest.title, summary: manifest.summary };
}

export function includedToolkitAppMetaTranslations(): Record<string, Record<AppLanguage, IncludedAppMeta>> {
  return INCLUDED_META;
}
