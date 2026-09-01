import type {
  BeatMark,
  BeatThreadKind,
  CharacterLifeStatus,
  CharacterNarrativeRole,
  EventTypeValue,
  PromptLanguage,
} from './types';

export interface CharacterBiographyContextCopy {
  character: string;
  species: string;
  gender: string;
  pronouns: string;
  status: string;
  narrativeRole: string;
  alsoKnownAs: string;
  birth: string;
  death: string;
  appearance: string;
  personality: string;
  backstory: string;
  parents: string;
  partners: string;
  children: string;
  siblings: string;
  links: string;
  lifeEvents: string;
  year: string;
  inPlace: string;
  authorNotes: string;
  writeFaithful: string;
  writePropose: string;
  lifeStatuses: Record<CharacterLifeStatus, string>;
  roles: Record<CharacterNarrativeRole, string>;
  eventTypes: Partial<Record<EventTypeValue, string>>;
  aliasKinds: Record<string, string>;
}

export interface ProseReviewContextCopy {
  scene: string;
  declaredBeats: string;
  sceneText: string;
  ask: (count: number) => string;
  threadKinds: Record<BeatThreadKind, string>;
  beatMarks: Record<BeatMark, string>;
}

const life = (
  unknown: string, alive: string, dead: string, missing: string,
  undead: string, immortal: string, unborn: string,
): Record<CharacterLifeStatus, string> => ({ unknown, alive, dead, missing, undead, immortal, unborn });
const roles = (
  protagonist: string, antagonist: string, secondary: string, tertiary: string, cameo: string,
): Record<CharacterNarrativeRole, string> => ({ protagonist, antagonist, secondary, tertiary, cameo });
const events = (
  birth: string, firstAppearance: string, oath: string, bond: string, journey: string,
  battle: string, betrayal: string, revelation: string, transformation: string,
  ascension: string, exile: string, loss: string, death: string, other: string,
): Partial<Record<EventTypeValue, string>> => ({
  birth, first_appearance: firstAppearance, oath, bond, journey, battle, betrayal,
  revelation, transformation, ascension, exile, loss, death, other,
});
const aliasKinds = (
  trueName: string, birthName: string, epithet: string, nickname: string, alias: string, foreignName: string,
): Record<string, string> => ({
  true_name: trueName, birth_name: birthName, epithet, nickname, alias, foreign_name: foreignName,
});
const marks = (
  obeys: string, bends: string, breaks: string, establishes: string,
  raise: string, turn: string, ease: string, resolve: string, step: string,
): Record<BeatMark, string> => ({ obeys, bends, breaks, establishes, raise, turn, ease, resolve, step });

export const CHARACTER_BIOGRAPHY_CONTEXT_COPY: Record<PromptLanguage, CharacterBiographyContextCopy> = {
  es: {
    character: 'Personaje', species: 'especie', gender: 'género', pronouns: 'pronombres (úsalos literalmente)',
    status: 'estado', narrativeRole: 'papel en el relato', alsoKnownAs: 'También conocido como', birth: 'Nacimiento',
    death: 'Muerte', appearance: 'Apariencia', personality: 'Personalidad', backstory: 'Trasfondo',
    parents: 'Progenitores', partners: 'Parejas', children: 'Descendencia', siblings: 'Hermanos', links: 'Vínculos',
    lifeEvents: 'Hechos de su vida, en orden', year: 'año', inPlace: 'en', authorNotes: 'Notas del autor',
    writeFaithful: 'Redacta la biografía del personaje a partir de lo anterior.',
    writePropose: 'Redacta la biografía del personaje a partir de lo anterior, y propón lo que falte marcándolo entre corchetes.',
    lifeStatuses: life('Sin determinar', 'Vivo', 'Muerto', 'Desaparecido', 'No muerto', 'Inmortal', 'Aún no nace'),
    roles: roles('Protagonista', 'Antagonista', 'Secundario', 'Terciario', 'Mención'),
    eventTypes: events('Nacimiento', 'Primera aparición', 'Juramento', 'Vínculo', 'Viaje', 'Batalla', 'Traición', 'Revelación', 'Transformación', 'Ascenso', 'Exilio', 'Pérdida', 'Muerte', 'Otro'),
    aliasKinds: aliasKinds('Nombre verdadero', 'Nombre de nacimiento', 'Epíteto o título', 'Apodo', 'Alias', 'Nombre en otra lengua'),
  },
  en: {
    character: 'Character', species: 'species', gender: 'gender', pronouns: 'pronouns (use them verbatim)',
    status: 'status', narrativeRole: 'role in the story', alsoKnownAs: 'Also known as', birth: 'Birth', death: 'Death',
    appearance: 'Appearance', personality: 'Personality', backstory: 'Backstory', parents: 'Parents', partners: 'Partners',
    children: 'Children', siblings: 'Siblings', links: 'Relationships', lifeEvents: 'Life events, in order', year: 'year',
    inPlace: 'in', authorNotes: 'Author notes', writeFaithful: 'Write the character biography from the information above.',
    writePropose: 'Write the character biography from the information above and propose what is missing, marking it in brackets.',
    lifeStatuses: life('Undetermined', 'Alive', 'Dead', 'Missing', 'Undead', 'Immortal', 'Not yet born'),
    roles: roles('Protagonist', 'Antagonist', 'Supporting', 'Tertiary', 'Mention'),
    eventTypes: events('Birth', 'First appearance', 'Oath', 'Bond', 'Journey', 'Battle', 'Betrayal', 'Revelation', 'Transformation', 'Ascension', 'Exile', 'Loss', 'Death', 'Other'),
    aliasKinds: aliasKinds('True name', 'Birth name', 'Epithet or title', 'Nickname', 'Alias', 'Name in another language'),
  },
  fr: {
    character: 'Personnage', species: 'espèce', gender: 'genre', pronouns: 'pronoms (utilisez-les tels quels)',
    status: 'statut', narrativeRole: 'rôle dans le récit', alsoKnownAs: 'Également connu sous le nom de', birth: 'Naissance',
    death: 'Mort', appearance: 'Apparence', personality: 'Personnalité', backstory: 'Passé', parents: 'Parents',
    partners: 'Partenaires', children: 'Descendance', siblings: 'Frères et sœurs', links: 'Liens',
    lifeEvents: 'Événements de sa vie, dans l’ordre', year: 'année', inPlace: 'à', authorNotes: 'Notes de l’auteur',
    writeFaithful: 'Rédigez la biographie du personnage à partir des informations ci-dessus.',
    writePropose: 'Rédigez la biographie du personnage à partir des informations ci-dessus et proposez ce qui manque en le plaçant entre crochets.',
    lifeStatuses: life('Indéterminé', 'Vivant', 'Mort', 'Disparu', 'Mort-vivant', 'Immortel', 'Pas encore né'),
    roles: roles('Protagoniste', 'Antagoniste', 'Secondaire', 'Tertiaire', 'Mention'),
    eventTypes: events('Naissance', 'Première apparition', 'Serment', 'Lien', 'Voyage', 'Bataille', 'Trahison', 'Révélation', 'Transformation', 'Ascension', 'Exil', 'Perte', 'Mort', 'Autre'),
    aliasKinds: aliasKinds('Vrai nom', 'Nom de naissance', 'Épithète ou titre', 'Surnom', 'Alias', 'Nom dans une autre langue'),
  },
  de: {
    character: 'Figur', species: 'Spezies', gender: 'Geschlecht', pronouns: 'Pronomen (wörtlich verwenden)',
    status: 'Status', narrativeRole: 'Rolle in der Erzählung', alsoKnownAs: 'Auch bekannt als', birth: 'Geburt', death: 'Tod',
    appearance: 'Erscheinung', personality: 'Persönlichkeit', backstory: 'Vorgeschichte', parents: 'Eltern',
    partners: 'Partner', children: 'Nachkommen', siblings: 'Geschwister', links: 'Beziehungen',
    lifeEvents: 'Lebensereignisse in Reihenfolge', year: 'Jahr', inPlace: 'in', authorNotes: 'Anmerkungen der schreibenden Person',
    writeFaithful: 'Schreibe die Biografie der Figur anhand der obigen Angaben.',
    writePropose: 'Schreibe die Biografie der Figur anhand der obigen Angaben und schlage Fehlendes in eckigen Klammern vor.',
    lifeStatuses: life('Unbestimmt', 'Lebendig', 'Tot', 'Verschollen', 'Untot', 'Unsterblich', 'Noch nicht geboren'),
    roles: roles('Hauptfigur', 'Gegenspieler', 'Nebenfigur', 'Tertiärfigur', 'Erwähnung'),
    eventTypes: events('Geburt', 'Erster Auftritt', 'Eid', 'Bindung', 'Reise', 'Schlacht', 'Verrat', 'Enthüllung', 'Verwandlung', 'Aufstieg', 'Exil', 'Verlust', 'Tod', 'Sonstiges'),
    aliasKinds: aliasKinds('Wahrer Name', 'Geburtsname', 'Beiname oder Titel', 'Spitzname', 'Alias', 'Name in einer anderen Sprache'),
  },
  pt: {
    character: 'Personagem', species: 'espécie', gender: 'género', pronouns: 'pronomes (usa-os literalmente)',
    status: 'estado', narrativeRole: 'papel na narrativa', alsoKnownAs: 'Também conhecido como', birth: 'Nascimento',
    death: 'Morte', appearance: 'Aparência', personality: 'Personalidade', backstory: 'Antecedentes',
    parents: 'Progenitores', partners: 'Parceiros', children: 'Descendência', siblings: 'Irmãos', links: 'Vínculos',
    lifeEvents: 'Acontecimentos da sua vida, por ordem', year: 'ano', inPlace: 'em', authorNotes: 'Notas do autor',
    writeFaithful: 'Redige a biografia da personagem a partir da informação anterior.',
    writePropose: 'Redige a biografia da personagem a partir da informação anterior e propõe o que falta, marcando-o entre parênteses retos.',
    lifeStatuses: life('Por determinar', 'Vivo', 'Morto', 'Desaparecido', 'Morto-vivo', 'Imortal', 'Ainda não nasceu'),
    roles: roles('Protagonista', 'Antagonista', 'Secundário', 'Terciário', 'Menção'),
    eventTypes: events('Nascimento', 'Primeira aparição', 'Juramento', 'Vínculo', 'Viagem', 'Batalha', 'Traição', 'Revelação', 'Transformação', 'Ascensão', 'Exílio', 'Perda', 'Morte', 'Outro'),
    aliasKinds: aliasKinds('Nome verdadeiro', 'Nome de nascimento', 'Epíteto ou título', 'Alcunha', 'Alias', 'Nome noutra língua'),
  },
  'pt-BR': {
    character: 'Personagem', species: 'espécie', gender: 'gênero', pronouns: 'pronomes (use-os literalmente)',
    status: 'estado', narrativeRole: 'papel na narrativa', alsoKnownAs: 'Também conhecido como', birth: 'Nascimento',
    death: 'Morte', appearance: 'Aparência', personality: 'Personalidade', backstory: 'Histórico', parents: 'Progenitores',
    partners: 'Parceiros', children: 'Descendência', siblings: 'Irmãos', links: 'Vínculos',
    lifeEvents: 'Acontecimentos da vida, em ordem', year: 'ano', inPlace: 'em', authorNotes: 'Notas do autor',
    writeFaithful: 'Escreva a biografia do personagem a partir das informações acima.',
    writePropose: 'Escreva a biografia do personagem a partir das informações acima e proponha o que falta, marcando-o entre colchetes.',
    lifeStatuses: life('Indeterminado', 'Vivo', 'Morto', 'Desaparecido', 'Morto-vivo', 'Imortal', 'Ainda não nasceu'),
    roles: roles('Protagonista', 'Antagonista', 'Coadjuvante', 'Terciário', 'Menção'),
    eventTypes: events('Nascimento', 'Primeira aparição', 'Juramento', 'Vínculo', 'Viagem', 'Batalha', 'Traição', 'Revelação', 'Transformação', 'Ascensão', 'Exílio', 'Perda', 'Morte', 'Outro'),
    aliasKinds: aliasKinds('Nome verdadeiro', 'Nome de nascimento', 'Epíteto ou título', 'Apelido', 'Alias', 'Nome em outro idioma'),
  },
  it: {
    character: 'Personaggio', species: 'specie', gender: 'genere', pronouns: 'pronomi (usali alla lettera)',
    status: 'stato', narrativeRole: 'ruolo nella narrazione', alsoKnownAs: 'Conosciuto anche come', birth: 'Nascita',
    death: 'Morte', appearance: 'Aspetto', personality: 'Personalità', backstory: 'Antefatti',
    parents: 'Genitori', partners: 'Partner', children: 'Discendenza', siblings: 'Fratelli e sorelle', links: 'Legami',
    lifeEvents: 'Eventi della sua vita, in ordine', year: 'anno', inPlace: 'a', authorNotes: 'Note dell’autore',
    writeFaithful: 'Scrivi la biografia del personaggio a partire dalle informazioni precedenti.',
    writePropose: 'Scrivi la biografia del personaggio a partire dalle informazioni precedenti e proponi ciò che manca, segnalandolo tra parentesi quadre.',
    lifeStatuses: life('Da determinare', 'Vivo', 'Morto', 'Scomparso', 'Non morto', 'Immortale', 'Non ancora nato'),
    roles: roles('Protagonista', 'Antagonista', 'Secondario', 'Terziario', 'Menzione'),
    eventTypes: events('Nascita', 'Prima apparizione', 'Giuramento', 'Legame', 'Viaggio', 'Battaglia', 'Tradimento', 'Rivelazione', 'Trasformazione', 'Ascesa', 'Esilio', 'Perdita', 'Morte', 'Altro'),
    aliasKinds: aliasKinds('Vero nome', 'Nome di nascita', 'Epiteto o titolo', 'Soprannome', 'Alias', 'Nome in un’altra lingua'),
  },
  tr: {
    character: 'Karakter', species: 'tür', gender: 'cinsiyet', pronouns: 'zamirler (aynen kullan)', status: 'durum',
    narrativeRole: 'anlatıdaki rol', alsoKnownAs: 'Diğer adları', birth: 'Doğum', death: 'Ölüm', appearance: 'Görünüş',
    personality: 'Kişilik', backstory: 'Geçmiş', parents: 'Ebeveynler', partners: 'Eşler', children: 'Çocuklar',
    siblings: 'Kardeşler', links: 'Bağlar', lifeEvents: 'Yaşam olayları, sırayla', year: 'yıl', inPlace: 'yer',
    authorNotes: 'Yazarın notları', writeFaithful: 'Yukarıdaki bilgilerden karakterin biyografisini yaz.',
    writePropose: 'Yukarıdaki bilgilerden karakterin biyografisini yaz ve eksikleri köşeli parantez içinde öner.',
    lifeStatuses: life('Belirsiz', 'Hayatta', 'Ölü', 'Kayıp', 'Yaşayan ölü', 'Ölümsüz', 'Henüz doğmadı'),
    roles: roles('Başkahraman', 'Karşıt karakter', 'Yardımcı karakter', 'Üçüncül karakter', 'Anılma'),
    eventTypes: events('Doğum', 'İlk görünüş', 'Yemin', 'Bağ', 'Yolculuk', 'Savaş', 'İhanet', 'Vahiy', 'Dönüşüm', 'Yükseliş', 'Sürgün', 'Kayıp', 'Ölüm', 'Diğer'),
    aliasKinds: aliasKinds('Gerçek ad', 'Doğum adı', 'Lakap veya unvan', 'Takma ad', 'Alias', 'Başka dilde ad'),
  },
};

export const PROSE_REVIEW_CONTEXT_COPY: Record<PromptLanguage, ProseReviewContextCopy> = {
  es: { scene: 'ESCENA', declaredBeats: 'LO QUE DIJISTE QUE TENÍA QUE PASAR', sceneText: 'EL TEXTO DE LA ESCENA', ask: (n) => `Dime, en ${n} línea(s) y en ese mismo orden, cuáles aparecen.`, threadKinds: { rule: 'regla', conflict: 'conflicto', arc: 'arco' }, beatMarks: marks('Se cumple', 'Se dobla', 'Se rompe', 'Se establece', 'Sube', 'Gira', 'Baja', 'Se cierra', 'Avanza') },
  en: { scene: 'SCENE', declaredBeats: 'WHAT YOU SAID HAD TO HAPPEN', sceneText: 'THE SCENE TEXT', ask: (n) => `In ${n} line(s), in the same order, tell me which ones appear.`, threadKinds: { rule: 'rule', conflict: 'conflict', arc: 'arc' }, beatMarks: marks('Holds', 'Bends', 'Breaks', 'Is established', 'Rises', 'Turns', 'Eases', 'Closes', 'Advances') },
  fr: { scene: 'SCÈNE', declaredBeats: 'CE QUI DEVAIT SE PRODUIRE SELON VOUS', sceneText: 'LE TEXTE DE LA SCÈNE', ask: (n) => `Indiquez-moi, en ${n} ligne(s) et dans le même ordre, lesquels apparaissent.`, threadKinds: { rule: 'règle', conflict: 'conflit', arc: 'arc' }, beatMarks: marks('Est respectée', 'Se plie', 'Se brise', 'Est établie', 'Monte', 'Bascule', 'Retombe', 'Se clôt', 'Avance') },
  de: { scene: 'SZENE', declaredBeats: 'WAS LAUT IHNEN GESCHEHEN MUSSTE', sceneText: 'DER SZENENTEXT', ask: (n) => `Nenne mir in ${n} Zeile(n) und in derselben Reihenfolge, welche davon vorkommen.`, threadKinds: { rule: 'Regel', conflict: 'Konflikt', arc: 'Bogen' }, beatMarks: marks('Wird eingehalten', 'Wird gebeugt', 'Bricht', 'Wird etabliert', 'Steigt', 'Wendet sich', 'Flaut ab', 'Schließt', 'Schreitet voran') },
  pt: { scene: 'CENA', declaredBeats: 'O QUE DISSE QUE TINHA DE ACONTECER', sceneText: 'O TEXTO DA CENA', ask: (n) => `Diz-me, em ${n} linha(s) e pela mesma ordem, quais aparecem.`, threadKinds: { rule: 'regra', conflict: 'conflito', arc: 'arco' }, beatMarks: marks('Cumpre-se', 'Dobra-se', 'Quebra-se', 'Estabelece-se', 'Sobe', 'Vira', 'Desce', 'Fecha-se', 'Avança') },
  'pt-BR': { scene: 'CENA', declaredBeats: 'O QUE VOCÊ DISSE QUE TINHA DE ACONTECER', sceneText: 'O TEXTO DA CENA', ask: (n) => `Diga, em ${n} linha(s) e na mesma ordem, quais aparecem.`, threadKinds: { rule: 'regra', conflict: 'conflito', arc: 'arco' }, beatMarks: marks('É cumprida', 'É flexibilizada', 'É quebrada', 'É estabelecida', 'Sobe', 'Vira', 'Diminui', 'É encerrado', 'Avança') },
  it: { scene: 'SCENA', declaredBeats: 'CIÒ CHE HAI DETTO DOVEVA ACCADERE', sceneText: 'IL TESTO DELLA SCENA', ask: (n) => `Dimmi, in ${n} riga/righe e nello stesso ordine, quali compaiono.`, threadKinds: { rule: 'regola', conflict: 'conflitto', arc: 'arco' }, beatMarks: marks('Viene rispettata', 'Si piega', 'Si infrange', 'Viene stabilita', 'Sale', 'Svolta', 'Scende', 'Si chiude', 'Avanza') },
  tr: { scene: 'SAHNE', declaredBeats: 'OLMASI GEREKTİĞİNİ SÖYLEDİĞİN ŞEYLER', sceneText: 'SAHNE METNİ', ask: (n) => `Hangilerinin yer aldığını aynı sırayla ${n} satırda söyle.`, threadKinds: { rule: 'kural', conflict: 'çatışma', arc: 'yay' }, beatMarks: marks('Uygulanır', 'Esnetilir', 'Bozulur', 'Kurulur', 'Yükselir', 'Döner', 'Azalır', 'Kapanır', 'İlerler') },
};

export function characterBiographyContextCopy(language: PromptLanguage = 'es'): CharacterBiographyContextCopy {
  return CHARACTER_BIOGRAPHY_CONTEXT_COPY[language] ?? CHARACTER_BIOGRAPHY_CONTEXT_COPY.es;
}

export function proseReviewContextCopy(language: PromptLanguage = 'es'): ProseReviewContextCopy {
  return PROSE_REVIEW_CONTEXT_COPY[language] ?? PROSE_REVIEW_CONTEXT_COPY.es;
}
