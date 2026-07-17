import type { TreePersonAttr } from './treeLayout';
import type { AppLanguage } from './types';

export type TreeBranch = 'paternal' | 'maternal' | 'neutral';
export type TreeKinshipRole =
  | 'focus'
  | 'father' | 'mother' | 'parent'
  | 'grandfather' | 'grandmother' | 'grandparent'
  | 'paternal_grandfather' | 'paternal_grandmother' | 'paternal_grandparent'
  | 'maternal_grandfather' | 'maternal_grandmother' | 'maternal_grandparent'
  | 'great_grandfather' | 'great_grandmother' | 'great_grandparent'
  | 'great_great_grandfather' | 'great_great_grandmother' | 'great_great_grandparent'
  | 'paternal_ancestor' | 'maternal_ancestor' | 'ancestor'
  | 'brother' | 'sister' | 'sibling'
  | 'husband' | 'wife' | 'spouse'
  | 'son' | 'daughter' | 'child'
  | 'grandson' | 'granddaughter' | 'grandchild'
  | 'great_grandson' | 'great_granddaughter' | 'great_grandchild'
  | 'great_great_grandson' | 'great_great_granddaughter' | 'great_great_grandchild'
  | 'paternal_uncle' | 'paternal_aunt' | 'maternal_uncle' | 'maternal_aunt' | 'uncle_aunt'
  | 'paternal_granduncle' | 'paternal_grandaunt' | 'maternal_granduncle' | 'maternal_grandaunt' | 'granduncle_aunt'
  | 'great_granduncle' | 'great_grandaunt' | 'great_granduncle_aunt'
  | 'nephew' | 'niece' | 'nibling'
  | 'grandnephew' | 'grandniece' | 'grandnibling'
  | 'great_grandnephew' | 'great_grandniece' | 'great_grandnibling'
  | 'male_cousin' | 'female_cousin' | 'cousin'
  | 'father_in_law' | 'mother_in_law' | 'parent_in_law'
  | 'son_in_law' | 'daughter_in_law' | 'child_in_law'
  | 'brother_in_law' | 'sister_in_law' | 'sibling_in_law'
  | 'stepfather' | 'stepmother' | 'stepparent'
  | 'stepson' | 'stepdaughter' | 'stepchild'
  | 'co_parent'
  | 'descendant' | 'relative_by_marriage' | 'connected_relative' | 'unrelated';

/** Canonical labels shared by the tree UI and every genealogy AI context. */
export const TREE_KINSHIP_ROLE_LABEL_ES: Record<TreeKinshipRole, string> = {
  focus: 'Persona principal', father: 'Padre', mother: 'Madre', parent: 'Progenitor/a',
  grandfather: 'Abuelo', grandmother: 'Abuela', grandparent: 'Abuelo/a',
  paternal_grandfather: 'Abuelo paterno', paternal_grandmother: 'Abuela paterna', paternal_grandparent: 'Abuelo/a paterno/a',
  maternal_grandfather: 'Abuelo materno', maternal_grandmother: 'Abuela materna', maternal_grandparent: 'Abuelo/a materno/a',
  great_grandfather: 'Bisabuelo', great_grandmother: 'Bisabuela', great_grandparent: 'Bisabuelo/a',
  great_great_grandfather: 'Tatarabuelo', great_great_grandmother: 'Tatarabuela', great_great_grandparent: 'Tatarabuelo/a',
  paternal_ancestor: 'Antepasado/a paterno/a', maternal_ancestor: 'Antepasado/a materno/a', ancestor: 'Antepasado/a',
  brother: 'Hermano', sister: 'Hermana', sibling: 'Hermano/a', husband: 'Esposo', wife: 'Esposa', spouse: 'Cónyuge/pareja',
  son: 'Hijo', daughter: 'Hija', child: 'Hijo/a', grandson: 'Nieto', granddaughter: 'Nieta', grandchild: 'Nieto/a',
  great_grandson: 'Bisnieto', great_granddaughter: 'Bisnieta', great_grandchild: 'Bisnieto/a',
  great_great_grandson: 'Tataranieto', great_great_granddaughter: 'Tataranieta', great_great_grandchild: 'Tataranieto/a',
  paternal_uncle: 'Tío paterno', paternal_aunt: 'Tía paterna', maternal_uncle: 'Tío materno', maternal_aunt: 'Tía materna', uncle_aunt: 'Tío/a',
  paternal_granduncle: 'Tío abuelo paterno', paternal_grandaunt: 'Tía abuela paterna', maternal_granduncle: 'Tío abuelo materno', maternal_grandaunt: 'Tía abuela materna', granduncle_aunt: 'Tío/a abuelo/a',
  great_granduncle: 'Tío bisabuelo', great_grandaunt: 'Tía bisabuela', great_granduncle_aunt: 'Tío/a bisabuelo/a',
  nephew: 'Sobrino', niece: 'Sobrina', nibling: 'Sobrino/a',
  grandnephew: 'Sobrino nieto', grandniece: 'Sobrina nieta', grandnibling: 'Sobrino/a nieto/a',
  great_grandnephew: 'Sobrino bisnieto', great_grandniece: 'Sobrina bisnieta', great_grandnibling: 'Sobrino/a bisnieto/a',
  male_cousin: 'Primo', female_cousin: 'Prima', cousin: 'Primo/a',
  father_in_law: 'Suegro', mother_in_law: 'Suegra', parent_in_law: 'Suegro/a',
  son_in_law: 'Yerno', daughter_in_law: 'Nuera', child_in_law: 'Yerno/nuera',
  brother_in_law: 'Cuñado', sister_in_law: 'Cuñada', sibling_in_law: 'Cuñado/a',
  stepfather: 'Padrastro', stepmother: 'Madrastra', stepparent: 'Padrastro/madrastra',
  stepson: 'Hijastro', stepdaughter: 'Hijastra', stepchild: 'Hijastro/a',
  co_parent: 'Coprogenitor/a', descendant: 'Descendiente', relative_by_marriage: 'Pariente por afinidad',
  connected_relative: 'Conexión familiar', unrelated: 'Sin parentesco registrado',
};

export const TREE_KINSHIP_ROLE_LABEL_EN: Record<TreeKinshipRole, string> = {
  focus: 'Focus person', father: 'Father', mother: 'Mother', parent: 'Parent',
  grandfather: 'Grandfather', grandmother: 'Grandmother', grandparent: 'Grandparent',
  paternal_grandfather: 'Paternal grandfather', paternal_grandmother: 'Paternal grandmother', paternal_grandparent: 'Paternal grandparent',
  maternal_grandfather: 'Maternal grandfather', maternal_grandmother: 'Maternal grandmother', maternal_grandparent: 'Maternal grandparent',
  great_grandfather: 'Great-grandfather', great_grandmother: 'Great-grandmother', great_grandparent: 'Great-grandparent',
  great_great_grandfather: 'Great-great-grandfather', great_great_grandmother: 'Great-great-grandmother', great_great_grandparent: 'Great-great-grandparent',
  paternal_ancestor: 'Paternal ancestor', maternal_ancestor: 'Maternal ancestor', ancestor: 'Ancestor',
  brother: 'Brother', sister: 'Sister', sibling: 'Sibling', husband: 'Husband', wife: 'Wife', spouse: 'Spouse/partner',
  son: 'Son', daughter: 'Daughter', child: 'Child', grandson: 'Grandson', granddaughter: 'Granddaughter', grandchild: 'Grandchild',
  great_grandson: 'Great-grandson', great_granddaughter: 'Great-granddaughter', great_grandchild: 'Great-grandchild',
  great_great_grandson: 'Great-great-grandson', great_great_granddaughter: 'Great-great-granddaughter', great_great_grandchild: 'Great-great-grandchild',
  paternal_uncle: 'Paternal uncle', paternal_aunt: 'Paternal aunt', maternal_uncle: 'Maternal uncle', maternal_aunt: 'Maternal aunt', uncle_aunt: 'Uncle/aunt',
  paternal_granduncle: 'Paternal granduncle', paternal_grandaunt: 'Paternal grandaunt', maternal_granduncle: 'Maternal granduncle', maternal_grandaunt: 'Maternal grandaunt', granduncle_aunt: 'Granduncle/grandaunt',
  great_granduncle: 'Great-granduncle', great_grandaunt: 'Great-grandaunt', great_granduncle_aunt: 'Great-granduncle/grandaunt',
  nephew: 'Nephew', niece: 'Niece', nibling: 'Niece/nephew', grandnephew: 'Grandnephew', grandniece: 'Grandniece', grandnibling: 'Grandnephew/grandniece',
  great_grandnephew: 'Great-grandnephew', great_grandniece: 'Great-grandniece', great_grandnibling: 'Great-grandnephew/grandniece',
  male_cousin: 'Male cousin', female_cousin: 'Female cousin', cousin: 'Cousin',
  father_in_law: 'Father-in-law', mother_in_law: 'Mother-in-law', parent_in_law: 'Parent-in-law',
  son_in_law: 'Son-in-law', daughter_in_law: 'Daughter-in-law', child_in_law: 'Child-in-law',
  brother_in_law: 'Brother-in-law', sister_in_law: 'Sister-in-law', sibling_in_law: 'Sibling-in-law',
  stepfather: 'Stepfather', stepmother: 'Stepmother', stepparent: 'Stepparent',
  stepson: 'Stepson', stepdaughter: 'Stepdaughter', stepchild: 'Stepchild', co_parent: 'Co-parent',
  descendant: 'Descendant', relative_by_marriage: 'Relative by marriage', connected_relative: 'Family connection', unrelated: 'No recorded kinship',
};

export const TREE_KINSHIP_ROLE_LABEL_FR: Record<TreeKinshipRole, string> = {
  focus: 'Personne de référence', father: 'Père', mother: 'Mère',
  parent: 'Parent', grandfather: 'Grand-père', grandmother: 'Grand-mère',
  grandparent: 'Grand-parent', paternal_grandfather: 'Grand-père paternel', paternal_grandmother: 'Grand-mère paternelle',
  paternal_grandparent: 'Grand-parent paternel', maternal_grandfather: 'Grand-père maternel', maternal_grandmother: 'Grand-mère maternelle',
  maternal_grandparent: 'Grand-parent maternel', great_grandfather: 'Arrière-grand-père', great_grandmother: 'Arrière-grand-mère',
  great_grandparent: 'Arrière-grand-parent', great_great_grandfather: 'Arrière-arrière-grand-père', great_great_grandmother: 'Arrière-arrière-grand-mère',
  great_great_grandparent: 'Arrière-arrière-grand-parent', paternal_ancestor: 'Ancêtre paternel', maternal_ancestor: 'Ancêtre maternel',
  ancestor: 'Ancêtre', brother: 'Frère', sister: 'Sœur',
  sibling: 'Frère/sœur', husband: 'Époux', wife: 'Épouse',
  spouse: 'Conjoint(e)/partenaire', son: 'Fils', daughter: 'Fille',
  child: 'Enfant', grandson: 'Petit-fils', granddaughter: 'Petite-fille',
  grandchild: 'Petit-enfant', great_grandson: 'Arrière-petit-fils', great_granddaughter: 'Arrière-petite-fille',
  great_grandchild: 'Arrière-petit-enfant', great_great_grandson: 'Arrière-arrière-petit-fils', great_great_granddaughter: 'Arrière-arrière-petite-fille',
  great_great_grandchild: 'Arrière-arrière-petit-enfant', paternal_uncle: 'Oncle paternel', paternal_aunt: 'Tante paternelle',
  maternal_uncle: 'Oncle maternel', maternal_aunt: 'Tante maternelle', uncle_aunt: 'Oncle/tante',
  paternal_granduncle: 'Grand-oncle paternel', paternal_grandaunt: 'Grand-tante paternelle', maternal_granduncle: 'Grand-oncle maternel',
  maternal_grandaunt: 'Grand-tante maternelle', granduncle_aunt: 'Grand-oncle/grand-tante', great_granduncle: 'Arrière-grand-oncle',
  great_grandaunt: 'Arrière-grand-tante', great_granduncle_aunt: 'Arrière-grand-oncle/arrière-grand-tante', nephew: 'Neveu',
  niece: 'Nièce', nibling: 'Neveu/nièce', grandnephew: 'Petit-neveu',
  grandniece: 'Petite-nièce', grandnibling: 'Petit-neveu/petite-nièce', great_grandnephew: 'Arrière-petit-neveu',
  great_grandniece: 'Arrière-petite-nièce', great_grandnibling: 'Arrière-petit-neveu/arrière-petite-nièce', male_cousin: 'Cousin',
  female_cousin: 'Cousine', cousin: 'Cousin/cousine', father_in_law: 'Beau-père',
  mother_in_law: 'Belle-mère', parent_in_law: 'Beau-père/belle-mère', son_in_law: 'Gendre',
  daughter_in_law: 'Bru', child_in_law: 'Gendre/bru', brother_in_law: 'Beau-frère',
  sister_in_law: 'Belle-sœur', sibling_in_law: 'Beau-frère/belle-sœur', stepfather: 'Beau-père',
  stepmother: 'Belle-mère', stepparent: 'Beau-père/belle-mère', stepson: 'Beau-fils',
  stepdaughter: 'Belle-fille', stepchild: 'Beau-fils/belle-fille', co_parent: 'Co-parent',
  descendant: 'Descendant', relative_by_marriage: 'Parent par alliance', connected_relative: 'Lien familial',
  unrelated: 'Aucune parenté enregistrée',
};

export const TREE_KINSHIP_ROLE_LABEL_DE: Record<TreeKinshipRole, string> = {
  focus: 'Bezugsperson', father: 'Vater', mother: 'Mutter',
  parent: 'Elternteil', grandfather: 'Großvater', grandmother: 'Großmutter',
  grandparent: 'Großelternteil', paternal_grandfather: 'Großvater väterlicherseits', paternal_grandmother: 'Großmutter väterlicherseits',
  paternal_grandparent: 'Großelternteil väterlicherseits', maternal_grandfather: 'Großvater mütterlicherseits', maternal_grandmother: 'Großmutter mütterlicherseits',
  maternal_grandparent: 'Großelternteil mütterlicherseits', great_grandfather: 'Urgroßvater', great_grandmother: 'Urgroßmutter',
  great_grandparent: 'Urgroßelternteil', great_great_grandfather: 'Ururgroßvater', great_great_grandmother: 'Ururgroßmutter',
  great_great_grandparent: 'Ururgroßelternteil', paternal_ancestor: 'Vorfahre väterlicherseits', maternal_ancestor: 'Vorfahre mütterlicherseits',
  ancestor: 'Vorfahre', brother: 'Bruder', sister: 'Schwester',
  sibling: 'Geschwister', husband: 'Ehemann', wife: 'Ehefrau',
  spouse: 'Partner/in', son: 'Sohn', daughter: 'Tochter',
  child: 'Kind', grandson: 'Enkel', granddaughter: 'Enkelin',
  grandchild: 'Enkelkind', great_grandson: 'Urenkel', great_granddaughter: 'Urenkelin',
  great_grandchild: 'Urenkelkind', great_great_grandson: 'Ururenkel', great_great_granddaughter: 'Ururenkelin',
  great_great_grandchild: 'Ururenkelkind', paternal_uncle: 'Onkel väterlicherseits', paternal_aunt: 'Tante väterlicherseits',
  maternal_uncle: 'Onkel mütterlicherseits', maternal_aunt: 'Tante mütterlicherseits', uncle_aunt: 'Onkel/Tante',
  paternal_granduncle: 'Großonkel väterlicherseits', paternal_grandaunt: 'Großtante väterlicherseits', maternal_granduncle: 'Großonkel mütterlicherseits',
  maternal_grandaunt: 'Großtante mütterlicherseits', granduncle_aunt: 'Großonkel/Großtante', great_granduncle: 'Urgroßonkel',
  great_grandaunt: 'Urgroßtante', great_granduncle_aunt: 'Urgroßonkel/Urgroßtante', nephew: 'Neffe',
  niece: 'Nichte', nibling: 'Neffe/Nichte', grandnephew: 'Großneffe',
  grandniece: 'Großnichte', grandnibling: 'Großneffe/Großnichte', great_grandnephew: 'Urgroßneffe',
  great_grandniece: 'Urgroßnichte', great_grandnibling: 'Urgroßneffe/Urgroßnichte', male_cousin: 'Cousin',
  female_cousin: 'Cousine', cousin: 'Cousin/Cousine', father_in_law: 'Schwiegervater',
  mother_in_law: 'Schwiegermutter', parent_in_law: 'Schwiegerelternteil', son_in_law: 'Schwiegersohn',
  daughter_in_law: 'Schwiegertochter', child_in_law: 'Schwiegerkind', brother_in_law: 'Schwager',
  sister_in_law: 'Schwägerin', sibling_in_law: 'Schwager/Schwägerin', stepfather: 'Stiefvater',
  stepmother: 'Stiefmutter', stepparent: 'Stiefelternteil', stepson: 'Stiefsohn',
  stepdaughter: 'Stieftochter', stepchild: 'Stiefkind', co_parent: 'Mitelternteil',
  descendant: 'Nachkomme', relative_by_marriage: 'Verwandte/r durch Heirat', connected_relative: 'Familienverbindung',
  unrelated: 'Keine erfasste Verwandtschaft',
};

export const TREE_KINSHIP_ROLE_LABEL_PT: Record<TreeKinshipRole, string> = {
  focus: 'Pessoa principal', father: 'Pai', mother: 'Mãe',
  parent: 'Progenitor/a', grandfather: 'Avô', grandmother: 'Avó',
  grandparent: 'Avô/avó', paternal_grandfather: 'Avô paterno', paternal_grandmother: 'Avó paterna',
  paternal_grandparent: 'Avô/avó paterno/a', maternal_grandfather: 'Avô materno', maternal_grandmother: 'Avó materna',
  maternal_grandparent: 'Avô/avó materno/a', great_grandfather: 'Bisavô', great_grandmother: 'Bisavó',
  great_grandparent: 'Bisavô/bisavó', great_great_grandfather: 'Trisavô', great_great_grandmother: 'Trisavó',
  great_great_grandparent: 'Trisavô/trisavó', paternal_ancestor: 'Antepassado/a paterno/a', maternal_ancestor: 'Antepassado/a materno/a',
  ancestor: 'Antepassado/a', brother: 'Irmão', sister: 'Irmã',
  sibling: 'Irmão/irmã', husband: 'Esposo', wife: 'Esposa',
  spouse: 'Cônjuge/companheiro/a', son: 'Filho', daughter: 'Filha',
  child: 'Filho/a', grandson: 'Neto', granddaughter: 'Neta',
  grandchild: 'Neto/a', great_grandson: 'Bisneto', great_granddaughter: 'Bisneta',
  great_grandchild: 'Bisneto/a', great_great_grandson: 'Trineto', great_great_granddaughter: 'Trineta',
  great_great_grandchild: 'Trineto/a', paternal_uncle: 'Tio paterno', paternal_aunt: 'Tia paterna',
  maternal_uncle: 'Tio materno', maternal_aunt: 'Tia materna', uncle_aunt: 'Tio/a',
  paternal_granduncle: 'Tio-avô paterno', paternal_grandaunt: 'Tia-avó paterna', maternal_granduncle: 'Tio-avô materno',
  maternal_grandaunt: 'Tia-avó materna', granduncle_aunt: 'Tio-avô/tia-avó', great_granduncle: 'Tio-bisavô',
  great_grandaunt: 'Tia-bisavó', great_granduncle_aunt: 'Tio-bisavô/tia-bisavó', nephew: 'Sobrinho',
  niece: 'Sobrinha', nibling: 'Sobrinho/a', grandnephew: 'Sobrinho-neto',
  grandniece: 'Sobrinha-neta', grandnibling: 'Sobrinho-neto/sobrinha-neta', great_grandnephew: 'Sobrinho-bisneto',
  great_grandniece: 'Sobrinha-bisneta', great_grandnibling: 'Sobrinho-bisneto/sobrinha-bisneta', male_cousin: 'Primo',
  female_cousin: 'Prima', cousin: 'Primo/a', father_in_law: 'Sogro',
  mother_in_law: 'Sogra', parent_in_law: 'Sogro/a', son_in_law: 'Genro',
  daughter_in_law: 'Nora', child_in_law: 'Genro/nora', brother_in_law: 'Cunhado',
  sister_in_law: 'Cunhada', sibling_in_law: 'Cunhado/a', stepfather: 'Padrasto',
  stepmother: 'Madrasta', stepparent: 'Padrasto/madrasta', stepson: 'Enteado',
  stepdaughter: 'Enteada', stepchild: 'Enteado/a', co_parent: 'Coprogenitor/a',
  descendant: 'Descendente', relative_by_marriage: 'Parente por afinidade', connected_relative: 'Ligação familiar',
  unrelated: 'Sem parentesco registado',
};

export const TREE_KINSHIP_ROLE_LABEL_PT_BR: Record<TreeKinshipRole, string> = {
  focus: 'Pessoa de referência', father: 'Pai', mother: 'Mãe',
  parent: 'Pai/mãe', grandfather: 'Avô', grandmother: 'Avó',
  grandparent: 'Avô/avó', paternal_grandfather: 'Avô paterno', paternal_grandmother: 'Avó paterna',
  paternal_grandparent: 'Avô/avó paterno/a', maternal_grandfather: 'Avô materno', maternal_grandmother: 'Avó materna',
  maternal_grandparent: 'Avô/avó materno/a', great_grandfather: 'Bisavô', great_grandmother: 'Bisavó',
  great_grandparent: 'Bisavô/bisavó', great_great_grandfather: 'Trisavô', great_great_grandmother: 'Trisavó',
  great_great_grandparent: 'Trisavô/trisavó', paternal_ancestor: 'Ancestral paterno/a', maternal_ancestor: 'Ancestral materno/a',
  ancestor: 'Ancestral', brother: 'Irmão', sister: 'Irmã',
  sibling: 'Irmão/irmã', husband: 'Esposo', wife: 'Esposa',
  spouse: 'Cônjuge/parceiro(a)', son: 'Filho', daughter: 'Filha',
  child: 'Filho/a', grandson: 'Neto', granddaughter: 'Neta',
  grandchild: 'Neto/a', great_grandson: 'Bisneto', great_granddaughter: 'Bisneta',
  great_grandchild: 'Bisneto/a', great_great_grandson: 'Trineto', great_great_granddaughter: 'Trineta',
  great_great_grandchild: 'Trineto/a', paternal_uncle: 'Tio paterno', paternal_aunt: 'Tia paterna',
  maternal_uncle: 'Tio materno', maternal_aunt: 'Tia materna', uncle_aunt: 'Tio/tia',
  paternal_granduncle: 'Tio-avô paterno', paternal_grandaunt: 'Tia-avó paterna', maternal_granduncle: 'Tio-avô materno',
  maternal_grandaunt: 'Tia-avó materna', granduncle_aunt: 'Tio-avô/tia-avó', great_granduncle: 'Tio-bisavô',
  great_grandaunt: 'Tia-bisavó', great_granduncle_aunt: 'Tio-bisavô/tia-bisavó', nephew: 'Sobrinho',
  niece: 'Sobrinha', nibling: 'Sobrinho/a', grandnephew: 'Sobrinho-neto',
  grandniece: 'Sobrinha-neta', grandnibling: 'Sobrinho/a-neto/a', great_grandnephew: 'Sobrinho-bisneto',
  great_grandniece: 'Sobrinha-bisneta', great_grandnibling: 'Sobrinho/a-bisneto/a', male_cousin: 'Primo',
  female_cousin: 'Prima', cousin: 'Primo/a', father_in_law: 'Sogro',
  mother_in_law: 'Sogra', parent_in_law: 'Sogro/a', son_in_law: 'Genro',
  daughter_in_law: 'Nora', child_in_law: 'Genro/nora', brother_in_law: 'Cunhado',
  sister_in_law: 'Cunhada', sibling_in_law: 'Cunhado/a', stepfather: 'Padrasto',
  stepmother: 'Madrasta', stepparent: 'Padrasto/madrasta', stepson: 'Enteado',
  stepdaughter: 'Enteada', stepchild: 'Enteado/a', co_parent: 'Coprogenitor(a)',
  descendant: 'Descendente', relative_by_marriage: 'Parente por afinidade', connected_relative: 'Conexão familiar',
  unrelated: 'Sem parentesco registrado',
};

/** Every role table by language, for {@link treeKinshipLabel}. */
export const TREE_KINSHIP_ROLE_LABELS: Record<AppLanguage, Record<TreeKinshipRole, string>> = {
  es: TREE_KINSHIP_ROLE_LABEL_ES,
  en: TREE_KINSHIP_ROLE_LABEL_EN,
  fr: TREE_KINSHIP_ROLE_LABEL_FR,
  de: TREE_KINSHIP_ROLE_LABEL_DE,
  pt: TREE_KINSHIP_ROLE_LABEL_PT,
  'pt-BR': TREE_KINSHIP_ROLE_LABEL_PT_BR,
};

/** The languages kinship labels exist in; derived so it cannot drift from the tables. */
const KINSHIP_LANGUAGES = Object.keys(TREE_KINSHIP_ROLE_LABELS) as AppLanguage[];

/**
 * Phrasing for the affinity paths no fixed role covers ("spouse of your cousin").
 * Each language keeps whatever possessive is invariant for it: Spanish "su",
 * English "their" and French "votre" work for any gender, so they read naturally;
 * German and Portuguese would need to agree with the following noun's gender, which
 * is unknowable here, so they use a bare genitive instead.
 */
const SPOUSE_WORD: Record<AppLanguage, readonly [string, string, string]> = {
  es: ['Esposo', 'Esposa', 'Cónyuge'],
  en: ['Husband', 'Wife', 'Spouse'],
  fr: ['Époux', 'Épouse', 'Conjoint'],
  de: ['Ehemann', 'Ehefrau', 'Ehepartner'],
  pt: ['Marido', 'Esposa', 'Cônjuge'],
  'pt-BR': ['Marido', 'Esposa', 'Cônjuge'],
};

const SPOUSE_OF: Record<AppLanguage, (spouse: string, relation: string) => string> = {
  es: (spouse, relation) => `${spouse} de su ${relation}`,
  en: (spouse, relation) => `${spouse} of their ${relation}`,
  fr: (spouse, relation) => `${spouse} de votre ${relation}`,
  de: (spouse, relation) => `${spouse} von ${relation}`,
  pt: (spouse, relation) => `${spouse} de ${relation}`,
  'pt-BR': (spouse, relation) => `${spouse} de ${relation}`,
};

/** "<relation> of their spouse" — the noun is fixed, so the possessive can agree. */
const OF_SPOUSE: Record<AppLanguage, (base: string) => string> = {
  es: (base) => `${base} de su cónyuge`,
  en: (base) => `${base} of their spouse`,
  fr: (base) => `${base} de votre conjoint`,
  de: (base) => `${base} Ihres Ehepartners`,
  pt: (base) => `${base} do seu cônjuge`,
  'pt-BR': (base) => `${base} do seu cônjuge`,
};

const CONNECTION_LABEL: Record<AppLanguage, string> = {
  es: 'Conexión familiar',
  en: 'Family connection',
  fr: 'Lien familial',
  de: 'Familiäre Verbindung',
  pt: 'Ligação familiar',
  'pt-BR': 'Conexão familiar',
};

export interface TreeKinshipContext {
  role: TreeKinshipRole;
  branch: TreeBranch;
  /** Signed shade adjustment; ancestors inside one branch alternate intensity. */
  tone: number;
  depth: number;
  /**
   * Exact generated labels for unbounded generations, cousin removals and rare
   * affinity paths — the cases no fixed role label can express. Absent for ordinary
   * roles, which read from {@link TREE_KINSHIP_ROLE_LABELS} instead.
   */
  labels?: Partial<Record<AppLanguage, string>>;
  cousinDegree?: number;
  cousinRemoval?: number;
}

export interface TreeKinshipInput {
  focusId: string;
  parentEdges: { parent: string; child: string }[];
  spouseEdges: { a: string; b: string }[];
  siblingEdges?: { a: string; b: string }[];
  persons?: TreePersonAttr[];
}

/** Falls back <lang> → EN, like the renderer's `t()`. */
export function treeKinshipLabel(context: TreeKinshipContext, language: AppLanguage = 'es'): string {
  // A generated label describes this exact path, so prefer it in any language over
  // the role's generic label ("Descendiente") — that is why it wins the lookup.
  const generated = context.labels;
  if (generated) return generated[language] ?? generated.en ?? TREE_KINSHIP_ROLE_LABEL_EN[context.role];
  return (TREE_KINSHIP_ROLE_LABELS[language] ?? TREE_KINSHIP_ROLE_LABEL_EN)[context.role]
    ?? TREE_KINSHIP_ROLE_LABEL_EN[context.role];
}

function sexRole(sex: string | undefined, male: TreeKinshipRole, female: TreeKinshipRole, unknown: TreeKinshipRole): TreeKinshipRole {
  return sex === 'male' ? male : sex === 'female' ? female : unknown;
}

function ordinalEn(value: number): string {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

/** French ordinals only inflect at 1 ("1er degré" vs "1re génération"); the rest take "e". */
function ordinalFr(value: number, feminine = false): string {
  if (value === 1) return feminine ? '1re' : '1er';
  return `${value}e`;
}

/** Portuguese ordinals agree in gender at every value: "3.º grau", "3.ª geração". */
function ordinalPt(value: number, feminine = false): string {
  return `${value}.${feminine ? 'ª' : 'º'}`;
}

/** German ordinals are just the number plus a period: "5. Generation". */
function ordinalDe(value: number): string {
  return `${value}.`;
}

function descendantContext(sex: string | undefined, depth: number): TreeKinshipContext {
  let role: TreeKinshipRole;
  if (depth === 1) role = sexRole(sex, 'son', 'daughter', 'child');
  else if (depth === 2) role = sexRole(sex, 'grandson', 'granddaughter', 'grandchild');
  else if (depth === 3) role = sexRole(sex, 'great_grandson', 'great_granddaughter', 'great_grandchild');
  else if (depth === 4) role = sexRole(sex, 'great_great_grandson', 'great_great_granddaughter', 'great_great_grandchild');
  else role = 'descendant';
  return {
    role, branch: 'neutral', tone: 0, depth,
    ...(depth > 4
      ? {
        labels: {
          es: `Descendiente de ${depth}.ª generación`,
          en: `${ordinalEn(depth)}-generation descendant`,
          fr: `Descendant à la ${ordinalFr(depth, true)} génération`,
          pt: `Descendente da ${ordinalPt(depth, true)} geração`,
          'pt-BR': `Descendente da ${ordinalPt(depth, true)} geração`,
          de: `Nachkomme der ${ordinalDe(depth)} Generation`,
        },
      }
      : {}),
  };
}

function niblingContext(sex: string | undefined, depth: number, branch: TreeBranch, tone: number): TreeKinshipContext {
  let role: TreeKinshipRole;
  if (depth === 1) role = sexRole(sex, 'nephew', 'niece', 'nibling');
  else if (depth === 2) role = sexRole(sex, 'grandnephew', 'grandniece', 'grandnibling');
  else role = sexRole(sex, 'great_grandnephew', 'great_grandniece', 'great_grandnibling');
  return {
    role, branch, tone, depth,
    ...(depth > 3
      ? {
        labels: {
          es: `Sobrino/a de ${depth}.ª generación`,
          en: `${ordinalEn(depth)}-generation niece/nephew`,
          fr: `Neveu/nièce à la ${ordinalFr(depth, true)} génération`,
          pt: `Sobrinho/a da ${ordinalPt(depth, true)} geração`,
          'pt-BR': `Sobrinho/a da ${ordinalPt(depth, true)} geração`,
          de: `Neffe/Nichte der ${ordinalDe(depth)} Generation`,
        },
      }
      : {}),
  };
}

function uncleContext(sex: string | undefined, level: number, branch: TreeBranch, tone: number): TreeKinshipContext {
  let role: TreeKinshipRole;
  if (level === 1) {
    role = branch === 'paternal'
      ? sexRole(sex, 'paternal_uncle', 'paternal_aunt', 'uncle_aunt')
      : branch === 'maternal'
        ? sexRole(sex, 'maternal_uncle', 'maternal_aunt', 'uncle_aunt')
        : sexRole(sex, 'paternal_uncle', 'paternal_aunt', 'uncle_aunt');
  } else if (level === 2) {
    role = branch === 'paternal'
      ? sexRole(sex, 'paternal_granduncle', 'paternal_grandaunt', 'granduncle_aunt')
      : branch === 'maternal'
        ? sexRole(sex, 'maternal_granduncle', 'maternal_grandaunt', 'granduncle_aunt')
        : sexRole(sex, 'paternal_granduncle', 'paternal_grandaunt', 'granduncle_aunt');
  } else role = sexRole(sex, 'great_granduncle', 'great_grandaunt', 'great_granduncle_aunt');
  const branchEs = branch === 'paternal' ? ' paterno/a' : branch === 'maternal' ? ' materno/a' : '';
  const branchEn = branch === 'paternal' ? ' paternal' : branch === 'maternal' ? ' maternal' : '';
  const branchFr = branch === 'paternal' ? ' paternel(le)' : branch === 'maternal' ? ' maternel(le)' : '';
  const branchPt = branch === 'paternal' ? ' paterno/a' : branch === 'maternal' ? ' materno/a' : '';
  const branchDe = branch === 'paternal' ? ' väterlicherseits' : branch === 'maternal' ? ' mütterlicherseits' : '';
  return {
    role, branch, tone, depth: level,
    ...(level > 3
      ? {
        labels: {
          es: `Tío/a${branchEs} de ${level}.ª generación`,
          en: `${ordinalEn(level)}-generation${branchEn} uncle/aunt`,
          fr: `Oncle/tante${branchFr} à la ${ordinalFr(level, true)} génération`,
          pt: `Tio/a${branchPt} da ${ordinalPt(level, true)} geração`,
          'pt-BR': `Tio/a${branchPt} da ${ordinalPt(level, true)} geração`,
          de: `Onkel/Tante${branchDe} der ${ordinalDe(level)} Generation`,
        },
      }
      : {}),
  };
}

function cousinContext(sex: string | undefined, degree: number, removal: number, branch: TreeBranch, tone: number): TreeKinshipContext {
  const role = sexRole(sex, 'male_cousin', 'female_cousin', 'cousin');
  if (degree === 1 && removal === 0) return { role, branch, tone, depth: 0, cousinDegree: degree, cousinRemoval: removal };
  const genderEs = sex === 'male' ? 'Primo' : sex === 'female' ? 'Prima' : 'Primo/a';
  const genderEn = sex === 'male' ? 'male cousin' : sex === 'female' ? 'female cousin' : 'cousin';
  const genderFr = sex === 'male' ? 'Cousin' : sex === 'female' ? 'Cousine' : 'Cousin/e';
  const genderPt = sex === 'male' ? 'Primo' : sex === 'female' ? 'Prima' : 'Primo/a';
  const genderDe = sex === 'male' ? 'Cousin' : sex === 'female' ? 'Cousine' : 'Cousin/Cousine';
  const removalEs = removal === 1 ? ', 1 generación de diferencia' : removal > 1 ? `, ${removal} generaciones de diferencia` : '';
  const removalEn = removal === 1 ? ', once removed' : removal === 2 ? ', twice removed' : removal > 2 ? `, ${removal} times removed` : '';
  const removalFr = removal === 1 ? ", à 1 génération d'écart" : removal > 1 ? `, à ${removal} générations d'écart` : '';
  const removalPt = removal === 1 ? ', 1 geração de diferença' : removal > 1 ? `, ${removal} gerações de diferença` : '';
  const removalDe = removal === 1 ? ', 1 Generation entfernt' : removal > 1 ? `, ${removal} Generationen entfernt` : '';
  return {
    role, branch, tone, depth: 0, cousinDegree: degree, cousinRemoval: removal,
    labels: {
      es: `${genderEs} de ${degree}.º grado${removalEs}`,
      en: `${ordinalEn(degree)} ${genderEn}${removalEn}`,
      fr: `${genderFr} au ${ordinalFr(degree)} degré${removalFr}`,
      pt: `${genderPt} de ${ordinalPt(degree)} grau${removalPt}`,
      'pt-BR': `${genderPt} de ${ordinalPt(degree)} grau${removalPt}`,
      de: `${genderDe} ${ordinalDe(degree)} Grades${removalDe}`,
    },
  };
}

interface AncestorPath { distance: number; path: string[] }

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export function deriveTreeKinship(input: TreeKinshipInput): Map<string, TreeKinshipContext> {
  const sexOf = new Map((input.persons ?? []).map((person) => [person.id, person.sex]));
  const allIds = new Set<string>([input.focusId, ...(input.persons ?? []).map((person) => person.id)]);
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const { parent, child } of input.parentEdges) {
    allIds.add(parent); allIds.add(child);
    pushUnique(parentsOf, child, parent);
    pushUnique(childrenOf, parent, child);
  }
  const spousesOf = new Map<string, string[]>();
  for (const { a, b } of input.spouseEdges) {
    allIds.add(a); allIds.add(b);
    pushUnique(spousesOf, a, b);
    pushUnique(spousesOf, b, a);
  }
  const siblingsOf = new Map<string, Set<string>>();
  const addSibling = (a: string, b: string) => {
    if (a === b) return;
    (siblingsOf.get(a) ?? siblingsOf.set(a, new Set()).get(a)!).add(b);
    (siblingsOf.get(b) ?? siblingsOf.set(b, new Set()).get(b)!).add(a);
  };
  for (const { a, b } of input.siblingEdges ?? []) { allIds.add(a); allIds.add(b); addSibling(a, b); }
  for (const children of childrenOf.values()) {
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) addSibling(children[i], children[j]);
  }

  const rootsFor = (focusId: string): { paternalRoot?: string; maternalRoot?: string } => {
    const focusParents = [...new Set(parentsOf.get(focusId) ?? [])];
    const father = focusParents.find((id) => sexOf.get(id) === 'male');
    const mother = focusParents.find((id) => sexOf.get(id) === 'female');
    const remaining = focusParents.filter((id) => id !== father && id !== mother).sort();
    const paternalRoot = father ?? remaining[0];
    const maternalRoot = mother ?? remaining.find((id) => id !== paternalRoot);
    return { paternalRoot, maternalRoot };
  };
  const branchForRoot = (focusId: string, root: string | undefined): TreeBranch => {
    const { paternalRoot, maternalRoot } = rootsFor(focusId);
    return root === paternalRoot ? 'paternal' : root === maternalRoot ? 'maternal' : 'neutral';
  };

  const ancestorsFrom = (start: string): Map<string, AncestorPath> => {
    const paths = new Map<string, AncestorPath>([[start, { distance: 0, path: [] }]]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      const currentPath = paths.get(current)!;
      for (const parent of [...(parentsOf.get(current) ?? [])].sort()) {
        const next = { distance: currentPath.distance + 1, path: [...currentPath.path, parent] };
        const previous = paths.get(parent);
        if (!previous || next.distance < previous.distance) { paths.set(parent, next); queue.push(parent); }
      }
    }
    return paths;
  };
  const ancestorPaths = new Map([...allIds].map((id) => [id, ancestorsFrom(id)]));
  const unambiguousParentSex = (parentId: string, childId: string): string | undefined => {
    const sex = sexOf.get(parentId);
    if (sex !== 'male' && sex !== 'female') return undefined;
    return (parentsOf.get(childId) ?? []).some((otherId) => otherId !== parentId && sexOf.get(otherId) === sex) ? undefined : sex;
  };
  const toneForPath = (path: string[]): number => {
    let tone = 0;
    for (let index = 1; index < path.length; index++) {
      const parentId = path[index];
      const childId = path[index - 1];
      const reliableSex = unambiguousParentSex(parentId, childId);
      const parentIndex = [...(parentsOf.get(childId) ?? [])].sort().indexOf(parentId);
      const direction = reliableSex === 'male' ? -1 : reliableSex === 'female' ? 1 : parentIndex % 2 === 0 ? -1 : 1;
      tone += direction * Math.max(0.07, 0.2 / index);
    }
    return Math.max(-0.34, Math.min(0.34, tone));
  };
  const ancestorContext = (focusId: string, id: string, info: AncestorPath): TreeKinshipContext => {
    const branch = branchForRoot(focusId, info.path[0]);
    const childTowardFocus = info.distance === 1 ? focusId : info.path[info.path.length - 2];
    const sex = unambiguousParentSex(id, childTowardFocus);
    let role: TreeKinshipRole;
    if (info.distance === 1) role = sexRole(sex, 'father', 'mother', 'parent');
    else if (info.distance === 2) role = branch === 'paternal'
      ? sexRole(sex, 'paternal_grandfather', 'paternal_grandmother', 'paternal_grandparent')
      : branch === 'maternal'
        ? sexRole(sex, 'maternal_grandfather', 'maternal_grandmother', 'maternal_grandparent')
        : sexRole(sex, 'grandfather', 'grandmother', 'grandparent');
    else if (info.distance === 3) role = sexRole(sex, 'great_grandfather', 'great_grandmother', 'great_grandparent');
    else if (info.distance === 4) role = sexRole(sex, 'great_great_grandfather', 'great_great_grandmother', 'great_great_grandparent');
    else role = branch === 'paternal' ? 'paternal_ancestor' : branch === 'maternal' ? 'maternal_ancestor' : 'ancestor';
    const context: TreeKinshipContext = { role, branch, tone: toneForPath(info.path), depth: info.distance };
    if (info.distance > 4) {
      const branchEs = branch === 'paternal' ? ' paterno/a' : branch === 'maternal' ? ' materno/a' : '';
      const branchEn = branch === 'paternal' ? ' paternal' : branch === 'maternal' ? ' maternal' : '';
      const branchFr = branch === 'paternal' ? ' paternel(le)' : branch === 'maternal' ? ' maternel(le)' : '';
      const branchPt = branch === 'paternal' ? ' paterno/a' : branch === 'maternal' ? ' materno/a' : '';
      const branchDe = branch === 'paternal' ? ' väterlicherseits' : branch === 'maternal' ? ' mütterlicherseits' : '';
      context.labels = {
        es: `Ascendiente${branchEs} de ${info.distance}.ª generación`,
        en: `${ordinalEn(info.distance)}-generation${branchEn} ancestor`,
        fr: `Ascendant${branchFr} à la ${ordinalFr(info.distance, true)} génération`,
        pt: `Ascendente${branchPt} da ${ordinalPt(info.distance, true)} geração`,
        'pt-BR': `Ascendente${branchPt} da ${ordinalPt(info.distance, true)} geração`,
        de: `Vorfahre${branchDe} der ${ordinalDe(info.distance)} Generation`,
      };
    }
    return context;
  };

  const deriveBlood = (focusId: string): Map<string, TreeKinshipContext> => {
    const blood = new Map<string, TreeKinshipContext>([[focusId, { role: 'focus', branch: 'neutral', tone: 0, depth: 0 }]]);
    const focusUp = ancestorPaths.get(focusId) ?? new Map<string, AncestorPath>();
    for (const target of allIds) {
      if (target === focusId) continue;
      const up = focusUp.get(target);
      if (up && up.distance > 0) {
        blood.set(target, ancestorContext(focusId, target, up));
        continue;
      }
      const targetUp = ancestorPaths.get(target) ?? new Map<string, AncestorPath>();
      const down = targetUp.get(focusId);
      if (down && down.distance > 0) { blood.set(target, descendantContext(sexOf.get(target), down.distance)); continue; }
      if (siblingsOf.get(focusId)?.has(target)) {
        blood.set(target, { role: sexRole(sexOf.get(target), 'brother', 'sister', 'sibling'), branch: 'neutral', tone: 0, depth: 0 });
        continue;
      }
      const common = [...focusUp.entries()]
        .filter(([id, info]) => info.distance > 0 && (targetUp.get(id)?.distance ?? 0) > 0)
        .map(([id, focusInfo]) => ({ id, focusInfo, targetInfo: targetUp.get(id)! }))
        .sort((a, b) => (a.focusInfo.distance + a.targetInfo.distance) - (b.focusInfo.distance + b.targetInfo.distance)
          || Math.max(a.focusInfo.distance, a.targetInfo.distance) - Math.max(b.focusInfo.distance, b.targetInfo.distance)
          || a.id.localeCompare(b.id))[0];
      if (!common) continue;
      const upDistance = common.focusInfo.distance;
      const downDistance = common.targetInfo.distance;
      const branch = branchForRoot(focusId, common.focusInfo.path[0]);
      const tone = toneForPath(common.focusInfo.path);
      if (upDistance === 1 && downDistance === 1) {
        blood.set(target, { role: sexRole(sexOf.get(target), 'brother', 'sister', 'sibling'), branch: 'neutral', tone: 0, depth: 0 });
      } else if (downDistance === 1) blood.set(target, uncleContext(sexOf.get(target), upDistance - 1, branch, tone));
      else if (upDistance === 1) blood.set(target, niblingContext(sexOf.get(target), downDistance - 1, branch, tone));
      else blood.set(target, cousinContext(sexOf.get(target), Math.min(upDistance, downDistance) - 1, Math.abs(upDistance - downDistance), branch, tone));
    }

    // Explicit sibling edges can describe collateral branches whose common
    // parent has not been recorded. Walk them at every known ancestor depth.
    for (const [ancestorId, upInfo] of focusUp) {
      for (const siblingId of siblingsOf.get(ancestorId) ?? []) {
        const queue = [{ id: siblingId, down: 0 }];
        const seen = new Set<string>();
        while (queue.length) {
          const current = queue.shift()!;
          if (seen.has(current.id)) continue;
          seen.add(current.id);
          if (!blood.has(current.id)) {
            const branch = upInfo.distance > 0 ? branchForRoot(focusId, upInfo.path[0]) : 'neutral';
            const tone = toneForPath(upInfo.path);
            if (upInfo.distance === 0) blood.set(current.id, current.down === 0
              ? { role: sexRole(sexOf.get(current.id), 'brother', 'sister', 'sibling'), branch: 'neutral', tone: 0, depth: 0 }
              : niblingContext(sexOf.get(current.id), current.down, branch, tone));
            else if (current.down === 0) blood.set(current.id, uncleContext(sexOf.get(current.id), upInfo.distance, branch, tone));
            else blood.set(current.id, cousinContext(sexOf.get(current.id), Math.min(upInfo.distance, current.down), Math.abs(upInfo.distance - current.down), branch, tone));
          }
          for (const child of childrenOf.get(current.id) ?? []) queue.push({ id: child, down: current.down + 1 });
        }
      }
    }
    return blood;
  };

  const result = deriveBlood(input.focusId);
  const bloodResult = new Map(result);
  const spouseRole = (sex: string | undefined) => sexRole(sex, 'husband', 'wife', 'spouse');
  for (const spouse of spousesOf.get(input.focusId) ?? []) {
    result.set(spouse, { role: spouseRole(sexOf.get(spouse)), branch: 'neutral', tone: 0, depth: 0 });
  }

  const affinityFromSpouse = (context: TreeKinshipContext): TreeKinshipContext => {
    const standard = (role: TreeKinshipRole): TreeKinshipContext => ({ role, branch: 'neutral', tone: 0, depth: context.depth });
    if (context.role === 'father') return standard('father_in_law');
    if (context.role === 'mother') return standard('mother_in_law');
    if (context.role === 'parent') return standard('parent_in_law');
    if (context.role === 'brother') return standard('brother_in_law');
    if (context.role === 'sister') return standard('sister_in_law');
    if (context.role === 'sibling') return standard('sibling_in_law');
    if (context.role === 'son') return standard('stepson');
    if (context.role === 'daughter') return standard('stepdaughter');
    if (context.role === 'child') return standard('stepchild');
    return {
      role: 'relative_by_marriage', branch: 'neutral', tone: 0, depth: context.depth + 1,
      labels: Object.fromEntries(KINSHIP_LANGUAGES.map((language) =>
        [language, OF_SPOUSE[language](treeKinshipLabel(context, language))])),
    };
  };
  for (const spouse of spousesOf.get(input.focusId) ?? []) {
    for (const [personId, context] of deriveBlood(spouse)) {
      if (personId === spouse || personId === input.focusId || result.has(personId)) continue;
      result.set(personId, affinityFromSpouse(context));
    }
  }

  const spouseOfBlood = (known: TreeKinshipContext, otherId: string): TreeKinshipContext => {
    const sex = sexOf.get(otherId);
    const standard = (role: TreeKinshipRole): TreeKinshipContext => ({ role, branch: known.branch, tone: known.tone, depth: known.depth });
    if (known.role === 'father' || known.role === 'mother' || known.role === 'parent') return standard(sexRole(sex, 'stepfather', 'stepmother', 'stepparent'));
    if (known.role === 'son' || known.role === 'daughter' || known.role === 'child') return standard(sexRole(sex, 'son_in_law', 'daughter_in_law', 'child_in_law'));
    if (known.role === 'brother' || known.role === 'sister' || known.role === 'sibling') return standard(sexRole(sex, 'brother_in_law', 'sister_in_law', 'sibling_in_law'));
    const index = sex === 'male' ? 0 : sex === 'female' ? 1 : 2;
    return {
      role: 'relative_by_marriage', branch: known.branch, tone: known.tone, depth: known.depth + 1,
      labels: Object.fromEntries(KINSHIP_LANGUAGES.map((language) => [
        language,
        SPOUSE_OF[language](SPOUSE_WORD[language][index], treeKinshipLabel(known, language).toLocaleLowerCase(language)),
      ])),
    };
  };
  for (const { a, b } of input.spouseEdges) {
    const knownId = bloodResult.has(a) ? a : bloodResult.has(b) ? b : null;
    const otherId = knownId === a ? b : knownId === b ? a : null;
    if (!knownId || !otherId || knownId === input.focusId || result.has(otherId)) continue;
    result.set(otherId, spouseOfBlood(bloodResult.get(knownId)!, otherId));
  }

  // Unmarried co-parents have a real, explicit relationship through their
  // shared child and should never degrade to a generic connection.
  const focusChildren = new Set(childrenOf.get(input.focusId) ?? []);
  for (const personId of allIds) {
    if (personId === input.focusId || result.has(personId)) continue;
    if ((childrenOf.get(personId) ?? []).some((child) => focusChildren.has(child))) {
      result.set(personId, { role: 'co_parent', branch: 'neutral', tone: 0, depth: 1 });
    }
  }

  type ConnectionStep = Record<AppLanguage, string>;
  const adjacency = new Map<string, { id: string; step: ConnectionStep }[]>();
  const addConnection = (from: string, to: string, step: ConnectionStep) => {
    const values = adjacency.get(from) ?? [];
    if (!values.some((value) => value.id === to && value.step.es === step.es)) values.push({ id: to, step });
    adjacency.set(from, values);
  };
  /** [male, female, unknown] for each step of a "family connection" path. */
  const STEP_WORDS: Record<'parent' | 'child' | 'spouse' | 'sibling', Record<AppLanguage, readonly [string, string, string]>> = {
    parent: {
      es: ['padre', 'madre', 'progenitor/a'], en: ['father', 'mother', 'parent'], fr: ['père', 'mère', 'parent'],
      de: ['Vater', 'Mutter', 'Elternteil'], pt: ['pai', 'mãe', 'progenitor/a'], 'pt-BR': ['pai', 'mãe', 'genitor/a'],
    },
    child: {
      es: ['hijo', 'hija', 'hijo/a'], en: ['son', 'daughter', 'child'], fr: ['fils', 'fille', 'enfant'],
      de: ['Sohn', 'Tochter', 'Kind'], pt: ['filho', 'filha', 'filho/a'], 'pt-BR': ['filho', 'filha', 'filho/a'],
    },
    spouse: {
      es: ['esposo', 'esposa', 'cónyuge'], en: ['husband', 'wife', 'spouse'], fr: ['époux', 'épouse', 'conjoint'],
      de: ['Ehemann', 'Ehefrau', 'Ehepartner'], pt: ['marido', 'esposa', 'cônjuge'], 'pt-BR': ['marido', 'esposa', 'cônjuge'],
    },
    sibling: {
      es: ['hermano', 'hermana', 'hermano/a'], en: ['brother', 'sister', 'sibling'], fr: ['frère', 'sœur', 'frère/sœur'],
      de: ['Bruder', 'Schwester', 'Geschwister'], pt: ['irmão', 'irmã', 'irmão/ã'], 'pt-BR': ['irmão', 'irmã', 'irmão/ã'],
    },
  };
  const stepFor = (sex: string | undefined, kind: keyof typeof STEP_WORDS): ConnectionStep => {
    const index = sex === 'male' ? 0 : sex === 'female' ? 1 : 2;
    return Object.fromEntries(KINSHIP_LANGUAGES.map((language) => [language, STEP_WORDS[kind][language][index]])) as ConnectionStep;
  };
  for (const { parent, child } of input.parentEdges) {
    addConnection(child, parent, stepFor(sexOf.get(parent), 'parent'));
    addConnection(parent, child, stepFor(sexOf.get(child), 'child'));
  }
  for (const { a, b } of input.spouseEdges) {
    addConnection(a, b, stepFor(sexOf.get(b), 'spouse'));
    addConnection(b, a, stepFor(sexOf.get(a), 'spouse'));
  }
  for (const [a, siblings] of siblingsOf) for (const b of siblings) {
    addConnection(a, b, stepFor(sexOf.get(b), 'sibling'));
  }
  const connectionPaths = new Map<string, ConnectionStep[]>([[input.focusId, []]]);
  const connectionQueue = [input.focusId];
  while (connectionQueue.length) {
    const current = connectionQueue.shift()!;
    const path = connectionPaths.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (connectionPaths.has(next.id)) continue;
      connectionPaths.set(next.id, [...path, next.step]);
      connectionQueue.push(next.id);
    }
  }
  for (const personId of allIds) {
    if (result.has(personId)) continue;
    const path = connectionPaths.get(personId);
    if (path) {
      result.set(personId, {
        role: 'connected_relative', branch: 'neutral', tone: 0, depth: path.length,
        labels: Object.fromEntries(KINSHIP_LANGUAGES.map((language) =>
          [language, `${CONNECTION_LABEL[language]}: ${path.map((step) => step[language]).join(' → ')}`])),
      });
    } else result.set(personId, { role: 'unrelated', branch: 'neutral', tone: 0, depth: 0 });
  }
  return result;
}

export function adjustBranchColor(hex: string, tone: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match || tone === 0) return hex;
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  const adjusted = channels.map((channel) => {
    const next = tone > 0 ? channel + (255 - channel) * tone : channel * (1 + tone);
    return Math.round(Math.max(0, Math.min(255, next))).toString(16).padStart(2, '0');
  });
  return `#${adjusted.join('')}`;
}

/** Equal RGB blend used once the user-selected paternal and maternal lines meet. */
export function mixBranchColors(firstHex: string, secondHex: string): string {
  const parse = (hex: string): number[] | null => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return null;
    return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16));
  };
  const first = parse(firstHex);
  const second = parse(secondHex);
  if (!first) return secondHex;
  if (!second) return firstHex;
  return `#${first.map((channel, index) => Math.round((channel + second[index]) / 2).toString(16).padStart(2, '0')).join('')}`;
}

/** Keep user-selected branch colours legible over the dark tree canvas. */
export function branchColorForTheme(hex: string, tone: number, light: boolean): string {
  const tonalColor = adjustBranchColor(hex, tone);
  return light ? tonalColor : adjustBranchColor(tonalColor, 0.28);
}
