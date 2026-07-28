// The worldbuilding character layer (schema v91-v93) against a REAL migrated vault.
//
// The two failure modes this file exists for are both silent ones:
//   - a person with no `character_profiles` row rendering as a blank sheet with no
//     error, because a read inner-joined instead of synthesising the defaults;
//   - a character's life events coming back in arbitrary order, because an invented
//     calendar ("13 de Lluvia, 1204 T.E.") yields a NULL `date_sort` and nothing in
//     the UI says so.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-characters-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-worldbuilding-characters.mjs'), '--electron-characters-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-characters-test-'));
installRuntimeHooks(root);

try {
  const repo = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  const version = getDb().pragma('user_version', { simple: true });
  assert.equal(version, SCHEMA_VERSION, `DB migrated to schema v${SCHEMA_VERSION}`);
  assert.ok(version >= 91, 'the character overlay arrived at v91');

  // ── 0. No migration body may contain a backtick ───────────────────────────
  // Every migration is a template literal, so a backtick inside one (say, quoting a table
  // name in a comment) silently TERMINATES the string and turns the rest of the file into
  // a syntax error a long way from the cause. This has happened twice.
  {
    const { migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
    const offenders = migrations.filter((m) => m.up.includes('`')).map((m) => m.version);
    assert.deepEqual(offenders, [], 'migration bodies must not contain backticks');
  }

  // ── 1. Creation writes both halves and reads back joined ──────────────────
  const kaelen = repo.createCharacter({
    displayName: 'Kaelen Vor',
    species: 'Semielfo',
    gender: 'no binario',
    pronouns: 'elle/le',
    lifeStatus: 'alive',
    narrativeRole: 'protagonist',
    accent: 'violet',
    appearance: 'Alto y enjuto, cicatriz vertical sobre el ojo izquierdo, capa gris raída.',
    personality: 'Reservado, incapaz de mentir a quien le ha jurado lealtad.',
    backstory: 'Criado en las Cocinas del Alcázar tras la caída de su casa.',
    visualSeed: 'semielfo de rasgos afilados, pelo negro recogido, ojos ámbar',
    birthDate: '13 de Lluvia, 1204 T.E.',
    birthYearSort: 1204,
    names: [
      { name: 'Kaelen Vor', kind: null },
      { name: 'El Cuervo de Vael', kind: 'epithet' },
      { name: 'Kae', kind: 'nickname' },
    ],
  });

  assert.equal(kaelen.displayName, 'Kaelen Vor');
  assert.equal(kaelen.profile.species, 'Semielfo');
  assert.equal(kaelen.profile.pronouns, 'elle/le', 'pronouns are stored verbatim');
  assert.equal(kaelen.profile.lifeStatus, 'alive');
  assert.equal(kaelen.profile.narrativeRole, 'protagonist');
  assert.equal(kaelen.profile.birthYearSort, 1204);
  assert.equal(kaelen.names.length, 3, 'aliases stored');
  assert.equal(
    kaelen.birthDate,
    '13 de Lluvia, 1204 T.E.',
    'the invented date is kept verbatim, not normalised'
  );
  // The Earth-calendar parser cannot read it — which is precisely why birthYearSort exists.
  const kaelenRow = getDb().prepare('SELECT birth_date_sort FROM persons WHERE person_id = ?').get(kaelen.personId);
  assert.equal(kaelenRow.birth_date_sort, null, 'an invented date yields no Earth sort key');

  // `sex` is never set from a character sheet: it cannot describe a god or a dragon,
  // and leaving it 'unknown' is what keeps PersonPortrait on the neutral placeholder
  // instead of a human silhouette.
  assert.equal(kaelen.sex, 'unknown', 'characters never carry a genealogical sex');

  const fetched = repo.getCharacter(kaelen.personId);
  assert.equal(fetched.profile.appearance, kaelen.profile.appearance);
  assert.equal(fetched.profile.visualSeed, kaelen.profile.visualSeed);

  // ── 2. A person with NO overlay row reads as a character with defaults ────
  // This is how a merge, a sync package or a future import leaves the DB.
  const orphan = entities.createPerson({ displayName: 'Sin ficha' });
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM character_profiles WHERE person_id = ?').get(orphan.personId).c,
    0,
    'the fixture really has no overlay row'
  );
  const orphanCharacter = repo.getCharacter(orphan.personId);
  assert.ok(orphanCharacter, 'a person without an overlay is still a character');
  assert.equal(orphanCharacter.profile.lifeStatus, 'unknown', 'defaults are synthesised');
  assert.equal(orphanCharacter.profile.appearance, null);
  assert.ok(
    repo.listCharacters().some((c) => c.personId === orphan.personId),
    'and it appears in the grid rather than being dropped by an inner join'
  );

  // Writing to it creates the row instead of failing.
  const adopted = repo.updateCharacter(orphan.personId, { lifeStatus: 'missing', species: 'Humano' });
  assert.equal(adopted.profile.lifeStatus, 'missing');
  assert.equal(adopted.profile.species, 'Humano');

  // ── 3. Events order by the in-world year, and undated ones sort LAST ──────
  const place = entities.findOrCreatePlace('Alcázar de Vael');
  const mk = (type, date, year, order = 0) => {
    const event = entities.createEvent({
      type,
      date,
      placeId: place.placeId,
      participants: [{ personId: kaelen.personId, role: 'principal' }],
    });
    if (year !== null) repo.setEventWorldDate(event.eventId, year, order);
    return event.eventId;
  };
  const exile = mk('exile', 'Otoño de 1229 T.E.', 1229);
  const oath = mk('oath', 'Primavera de 1221 T.E.', 1221);
  const undated = mk('revelation', 'no se sabe cuándo', null);
  const oathLater = mk('betrayal', 'Verano de 1221 T.E.', 1221, 1);

  assert.deepEqual(
    repo.listCharacterEvents(kaelen.personId).map((e) => e.eventId),
    [oath, oathLater, exile, undated],
    'events sort by world year, then world order, with the unplaced one last'
  );
  const [first] = repo.listCharacterEvents(kaelen.personId);
  assert.equal(first.worldYear, 1221, 'the world year travels with the event');
  assert.equal(first.placeName, 'Alcázar de Vael', 'the shared event mapping is reused, not reimplemented');

  // Clearing a world date removes the row and pushes the event to the end.
  repo.setEventWorldDate(oath, null, 0);
  assert.equal(repo.getEventWorldDate(oath), null, 'clearing removes the row');
  assert.equal(
    repo.listCharacterEvents(kaelen.personId).at(-1) !== undefined,
    true,
    'the list still resolves after clearing'
  );
  assert.ok(
    repo.listCharacterEvents(kaelen.personId).slice(-2).map((e) => e.eventId).includes(oath),
    'an event with no world year falls to the end'
  );
  repo.setEventWorldDate(oath, 1221, 0);

  // ── 4. Search matches aliases, not just the display name ──────────────────
  assert.deepEqual(
    repo.listCharacters({ search: 'cuervo' }).map((c) => c.personId),
    [kaelen.personId],
    'a character is found by its epithet'
  );
  assert.equal(repo.listCharacters({ search: 'Kae' }).length, 1, 'and by its nickname');

  // ── 5. Filters ────────────────────────────────────────────────────────────
  assert.deepEqual(
    repo.listCharacters({ role: 'protagonist' }).map((c) => c.personId),
    [kaelen.personId]
  );
  assert.deepEqual(
    repo.listCharacters({ status: 'missing' }).map((c) => c.personId),
    [orphan.personId]
  );
  assert.equal(repo.listCharacters({ role: 'antagonist' }).length, 0);

  const counts = repo.characterCounts();
  assert.equal(counts.total, 2);
  assert.equal(counts.byRole.protagonist, 1);
  assert.equal(counts.byStatus.alive, 1);
  assert.equal(counts.byStatus.missing, 1);

  // ── 6. A partial update never wipes the fields it was not given ───────────
  const renamed = repo.updateCharacter(kaelen.personId, { displayName: 'Kaelen Vor el Cuervo' });
  assert.equal(renamed.displayName, 'Kaelen Vor el Cuervo');
  assert.equal(renamed.profile.appearance, kaelen.profile.appearance, 'the description survives a rename');
  assert.equal(renamed.profile.visualSeed, kaelen.profile.visualSeed, 'and so does the visual seed');
  assert.equal(renamed.profile.narrativeRole, 'protagonist');

  // Explicit nulls DO clear.
  const cleared = repo.updateCharacter(kaelen.personId, { accent: null });
  assert.equal(cleared.profile.accent, null, 'an explicit null clears the field');
  assert.equal(cleared.profile.species, 'Semielfo', 'without touching its neighbours');

  // ── 7. Deleting cascades the overlay and the world dates ──────────────────
  const db = getDb();
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM event_world_dates').get().c > 0, 'world dates exist to cascade');
  repo.deleteCharacter(kaelen.personId);
  assert.equal(repo.getCharacter(kaelen.personId), null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM character_profiles WHERE person_id = ?').get(kaelen.personId).c,
    0,
    'the overlay cascades away'
  );
  // The events themselves survive (as in genealogy), so their world dates must too —
  // an orphaned world date would resurface if the event were relinked.
  assert.equal(
    db
      .prepare('SELECT COUNT(*) AS c FROM event_world_dates w LEFT JOIN events e ON e.event_id = w.event_id WHERE e.event_id IS NULL')
      .get().c,
    0,
    'no world date is left pointing at a missing event'
  );

  // ── 8. Arc and voice patch field by field, never wholesale ────────────────
  // The sheet autosaves one textarea at a time. If a save sent the whole arc object,
  // every blur would wipe the four fields the author was not editing.
  const arcSubject = repo.createCharacter({ displayName: 'Serel', arc: { want: 'El trono' }, voice: { register: 'Cortesano' } });
  assert.equal(arcSubject.profile.arc.want, 'El trono');
  assert.equal(arcSubject.profile.voice.register, 'Cortesano');
  const arcPatched = repo.updateCharacter(arcSubject.personId, { arc: { flaw: 'No sabe pedir ayuda' } });
  assert.equal(arcPatched.profile.arc.flaw, 'No sabe pedir ayuda');
  assert.equal(arcPatched.profile.arc.want, 'El trono', 'patching one arc field leaves its siblings alone');
  assert.equal(arcPatched.profile.voice.register, 'Cortesano', 'and does not touch the voice');
  const voicePatched = repo.updateCharacter(arcSubject.personId, { voice: { sample: '—No me hagas repetirlo.' } });
  assert.equal(voicePatched.profile.voice.sample, '—No me hagas repetirlo.');
  assert.equal(voicePatched.profile.arc.want, 'El trono', 'and the arc survives a voice edit');

  // ── 9. Image gallery: bytes out of the list, prompt kept, avatar copied ───
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const shot = repo.addCharacterImage({
    personId: arcSubject.personId,
    blob: png,
    mimeType: 'image/png',
    kind: 'full_body',
    label: 'De pie en la sala del trono',
    prompt: 'semielfo de rasgos afilados, cuerpo entero, sala del trono',
    provider: 'gemini',
    model: 'test-model',
    style: 'cinematic',
    generated: true,
  });
  assert.equal(shot.kind, 'full_body');
  assert.equal(shot.generated, true);
  assert.equal(shot.bytes, png.length);
  assert.equal(shot.prompt, 'semielfo de rasgos afilados, cuerpo entero, sala del trono', 'the prompt travels with the image');
  // Listing must NOT carry the blob: a gallery of a whole cast would otherwise push
  // every byte of every image through the IPC bridge just to draw thumbnails.
  const listed = repo.listCharacterImages(arcSubject.personId);
  assert.equal(listed.length, 1);
  assert.equal('blob' in listed[0], false, 'the list omits the bytes');
  assert.deepEqual(repo.getCharacterImageBlob(shot.imageId).blob, png, 'the bytes are fetched on demand');

  // A second image takes the next slot rather than colliding at 0.
  const second = repo.addCharacterImage({ personId: arcSubject.personId, blob: png, kind: 'expression' });
  assert.equal(second.sortOrder, 1);

  // Promoting to avatar COPIES the bytes: deleting the gallery row must not blank it.
  assert.equal(entities.getPersonPortrait(arcSubject.personId), null, 'no avatar yet');
  repo.setCharacterAvatarFromImage(shot.imageId);
  assert.deepEqual(entities.getPersonPortrait(arcSubject.personId).blob, png, 'the avatar got the bytes');
  repo.deleteCharacterImage(shot.imageId);
  const avatarAfterDelete = entities.getPersonPortrait(arcSubject.personId);
  // Asserted as a presence check first: a pointer-based avatar would leave this null and
  // the deepEqual below would crash on a null deref instead of naming the invariant.
  assert.ok(avatarAfterDelete, 'deleting the gallery image must NOT blank the avatar (the bytes are copied, not referenced)');
  assert.deepEqual(avatarAfterDelete.blob, png, 'and the avatar bytes are unchanged');
  assert.equal(repo.getCharacter(arcSubject.personId).portrait.generated, true, 'and it is still flagged as generated');

  // ── 10. Abilities keep a cost AND a limit ─────────────────────────────────
  const ability = repo.addCharacterAbility(arcSubject.personId, {
    name: 'Voz de mando',
    description: 'Una orden que no se puede desobedecer.',
    cost: 'Pierde la voz un día entero.',
    limits: 'Solo funciona si el oyente ya le teme.',
  });
  assert.equal(ability.cost, 'Pierde la voz un día entero.');
  assert.equal(ability.limits, 'Solo funciona si el oyente ya le teme.');
  assert.equal(ability.sortOrder, 0);
  const ability2 = repo.addCharacterAbility(arcSubject.personId, { name: 'Paso de sombra' });
  assert.equal(ability2.sortOrder, 1, 'abilities append rather than collide');
  const abilityEdited = repo.updateCharacterAbility(ability2.abilityId, { limits: 'Solo de noche.' });
  assert.equal(abilityEdited.limits, 'Solo de noche.');
  assert.equal(abilityEdited.name, 'Paso de sombra', 'a partial ability edit keeps the name');
  repo.deleteCharacterAbility(ability2.abilityId);
  assert.equal(repo.listCharacterAbilities(arcSubject.personId).length, 1);

  // ── 11. Secret aliases, and the grid never shows a secret epithet ─────────
  const { characterEpithet } = require(path.join(repoRoot, 'shared/characterLabels.ts'));
  repo.setCharacterName(arcSubject.personId, 'La Heredera', 'epithet', false, null);
  repo.setCharacterName(arcSubject.personId, 'Hija de Nadie', 'epithet', true, 'Solo Kaelen y el archivero');
  const withSecrets = repo.getCharacter(arcSubject.personId);
  const secretName = withSecrets.names.find((entry) => entry.name === 'Hija de Nadie');
  assert.equal(secretName.secret, true);
  assert.equal(secretName.knownBy, 'Solo Kaelen y el archivero');
  assert.equal(withSecrets.names.find((entry) => entry.name === 'La Heredera').secret, false);
  assert.equal(
    characterEpithet(withSecrets.names),
    'La Heredera',
    'the public epithet wins: a secret name must not be printed on the card'
  );
  // And the filter, not the alphabet, is what decides. `person_names` comes back ordered
  // by name, so a secret epithet that sorts FIRST is the case a naive `find` would leak.
  repo.setCharacterName(arcSubject.personId, 'Ala Rota', 'epithet', true, null);
  assert.equal(
    characterEpithet(repo.getCharacter(arcSubject.personId).names),
    'La Heredera',
    'a secret epithet sorting before the public one must still be skipped'
  );
  repo.deleteCharacterName(arcSubject.personId, 'Ala Rota');

  // With ONLY a secret epithet there is nothing public to show.
  repo.deleteCharacterName(arcSubject.personId, 'La Heredera');
  assert.equal(characterEpithet(repo.getCharacter(arcSubject.personId).names), null);

  // ── 12. A proposed biography is never mistaken for accepted canon ─────────
  assert.equal(withSecrets.biography, null);
  repo.setProposedBiography(arcSubject.personId, 'Serel creció entre cortinas y silencios…');
  const proposed = repo.getCharacter(arcSubject.personId);
  assert.equal(proposed.profile.biographyProposed, 'Serel creció entre cortinas y silencios…');
  assert.ok(proposed.profile.biographyProposedAt, 'the proposal is dated');
  assert.equal(proposed.biography, null, 'proposing does NOT write the accepted biography');
  const accepted = repo.acceptProposedBiography(arcSubject.personId);
  assert.equal(accepted.biography, 'Serel creció entre cortinas y silencios…', 'accepting promotes it to canon');
  assert.equal(accepted.profile.biographyProposed, null, 'and clears the proposal');
  assert.equal(repo.acceptProposedBiography(arcSubject.personId), null, 'accepting twice is a no-op');

  // ── 13. Relation valence is directional: A may love who despises them ─────
  const social = require(path.join(repoRoot, 'electron/db/socialRepo.ts'));
  const other = repo.createCharacter({ displayName: 'Kaelen otra vez' });
  const loves = social.createSocialRelation({
    personId: arcSubject.personId, targetKind: 'person', targetId: other.personId,
    role: 'Amante', valence: 'lover',
  });
  const despises = social.createSocialRelation({
    personId: other.personId, targetKind: 'person', targetId: arcSubject.personId,
    role: 'Némesis', valence: 'nemesis',
  });
  assert.equal(loves.valence, 'lover');
  assert.equal(despises.valence, 'nemesis', 'the reverse bond carries its own valence');
  const revalued = social.updateSocialRelation(loves.relationId, { valence: 'rival' });
  assert.equal(revalued.valence, 'rival');
  assert.equal(revalued.role, 'Amante', 'changing the valence leaves the role text alone');
  assert.equal(
    social.getSocialRelation(despises.relationId).valence,
    'nemesis',
    'and does not touch the opposite direction'
  );

  // ── 14. Groups: one table for factions, cultures and the rest ─────────────
  const groups = require(path.join(repoRoot, 'electron/db/worldGroupsRepo.ts'));
  const guild = groups.createWorldGroup({ kind: 'faction', name: 'Los Cuervos', status: 'active' });
  const culture = groups.createWorldGroup({ kind: 'culture', name: 'Vael' });
  assert.equal(guild.kind, 'faction');
  assert.equal(guild.status, 'active');
  // The sections are filtered views of ONE collection, which is the whole point of the
  // single table: listing by kind must not leak the others.
  assert.deepEqual(groups.listWorldGroups('faction').map((g) => g.name), ['Los Cuervos']);
  assert.deepEqual(groups.listWorldGroups('culture').map((g) => g.name), ['Vael']);
  assert.equal(groups.listWorldGroups().length, 2);
  // An unrecognised kind or status degrades instead of throwing.
  const odd = groups.createWorldGroup({ kind: 'inventado', name: 'Raro', status: 'inventado' });
  assert.equal(odd.kind, 'faction');
  assert.equal(odd.status, null);
  groups.deleteWorldGroup(odd.groupId);

  const summarised = groups.updateWorldGroup(guild.groupId, { summary: 'Espías de la corte' });
  assert.equal(summarised.summary, 'Espías de la corte');
  assert.equal(summarised.name, 'Los Cuervos', 'a partial edit keeps the name');
  // A group cannot be its own parent.
  assert.equal(groups.updateWorldGroup(guild.groupId, { parentId: guild.groupId }).parentId, null);

  // ── 15. Affiliations carry a rank and a period, and answer "when" ─────────
  const member = groups.addAffiliation({
    personId: arcSubject.personId, groupId: guild.groupId, rank: 'Aprendiza',
    fromWorldDay: 1000, toWorldDay: 1200,
  });
  const later = groups.addAffiliation({
    personId: arcSubject.personId, groupId: guild.groupId, rank: 'Maestra', fromWorldDay: 1201,
  });
  const undatedTie = groups.addAffiliation({ personId: arcSubject.personId, groupId: culture.groupId });
  assert.equal(member.groupName, 'Los Cuervos', 'the group name travels with the affiliation');
  assert.equal(member.groupKind, 'faction');
  // Oldest first, and the UNDATED one last: SQLite sorts NULLs first, which would park
  // every unplaced membership at the top of the sheet.
  assert.deepEqual(
    groups.listAffiliationsForCharacter(arcSubject.personId).map((a) => a.affiliationId),
    [member.affiliationId, later.affiliationId, undatedTie.affiliationId]
  );
  // The membership list from the group's own side.
  assert.equal(groups.listAffiliationsForGroup(guild.groupId).length, 2);

  // "What was she when this happened" — the question the period exists to answer.
  assert.deepEqual(
    groups.affiliationsAt(arcSubject.personId, 1100).map((a) => a.rank),
    ['Aprendiza', null],
    'at day 1100 she is an apprentice; the undated culture always counts'
  );
  assert.deepEqual(
    groups.affiliationsAt(arcSubject.personId, 1500).map((a) => a.rank),
    ['Maestra', null],
    'and a master later'
  );
  assert.equal(groups.affiliationsAt(arcSubject.personId, null).length, 3, 'with no moment, everything counts');

  const promoted = groups.updateAffiliation(member.affiliationId, { rank: 'Oficial' });
  assert.equal(promoted.rank, 'Oficial');
  assert.equal(promoted.fromWorldDay, 1000, 'a partial edit keeps the period');
  groups.deleteAffiliation(undatedTie.affiliationId);
  assert.equal(groups.listAffiliationsForCharacter(arcSubject.personId).length, 2);

  // ── 15b. The grid carries memberships, so it can facet by faction and culture ──
  {
    const guild2 = groups.createWorldGroup({ kind: 'faction', name: 'La Mano Gris' });
    const tongue = groups.createWorldGroup({ kind: 'language', name: 'Alto vaelo' });
    groups.addAffiliation({ personId: arcSubject.personId, groupId: guild2.groupId, rank: 'Espía' });
    groups.addAffiliation({ personId: arcSubject.personId, groupId: tongue.groupId });
    const listed = repo.listCharacters().find((c) => c.personId === arcSubject.personId);
    // Factions and cultures are the SAME table; the split is by kind, and 'language'
    // belongs to the cultures side even though it is not literally a culture.
    assert.ok(listed.factions.includes('La Mano Gris'), 'the grid can facet by faction');
    assert.ok(listed.factions.includes('Los Cuervos'));
    assert.deepEqual(listed.cultures, ['Alto vaelo'], 'a language counts as a culture-side membership');
    // The single-character read agrees with the list; two answers here would make the
    // facet show values the sheet denies.
    const single = repo.getCharacter(arcSubject.personId);
    assert.deepEqual([...single.factions].sort(), [...listed.factions].sort());
    assert.deepEqual(single.cultures, listed.cultures);
    // Someone with no memberships gets empty arrays, not undefined: the facet reads them.
    assert.deepEqual(repo.listCharacters().find((c) => c.personId === orphan.personId).factions, []);
  }

  // ── 16. Deleting cascades — including the gallery, which has NO foreign key ─
  // world_images.entity_id is polymorphic (v94), so the CASCADE that character_images
  // provided is gone and deleteCharacter has to remove the images by hand. Forgetting it
  // leaks every image of every deleted character, invisibly.
  assert.ok(
    db.prepare("SELECT COUNT(*) AS c FROM world_images WHERE entity_kind = 'character' AND entity_id = ?").get(arcSubject.personId).c > 0,
    'the character has images to leak'
  );
  repo.deleteCharacter(arcSubject.personId);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM world_images WHERE entity_kind = 'character' AND entity_id = ?").get(arcSubject.personId).c,
    0,
    'the gallery is removed by hand, since no foreign key does it'
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM character_abilities WHERE person_id = ?').get(arcSubject.personId).c, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM character_affiliations WHERE person_id = ?').get(arcSubject.personId).c,
    0,
    'affiliations cascade from the person foreign key'
  );
  // The group itself survives its members.
  assert.ok(groups.getWorldGroup(guild.groupId), 'deleting a member does not delete the faction');

  // ── 16b. Places: overlay defaults, cycle refusal, detach on delete ────────
  {
    const wp = require(path.join(repoRoot, 'electron/db/worldPlacesRepo.ts'));
    const country = wp.createWorldPlace({ name: 'Vael', kind: 'country' });
    const city = wp.createWorldPlace({ name: 'Puerto Ceniza', kind: 'city', parentId: country.placeId });
    assert.equal(city.parentId, country.placeId);
    assert.equal(city.profile.appearance, null, 'a fresh place has an empty overlay');

    // A place created by any OTHER path (the event form, the gazetteer, a genealogy
    // import) has no overlay row at all — the same trap as characters.
    const bare = entities.findOrCreatePlace('Sin ficha');
    const asWorld = wp.getWorldPlace(bare.placeId);
    assert.ok(asWorld, 'a place with no overlay is still a world place');
    assert.equal(asWorld.profile.visualSeed, null, 'defaults are synthesised');
    assert.ok(wp.listWorldPlaces().some((p) => p.placeId === bare.placeId), 'and it appears in the tree');

    const described = wp.updateWorldPlace(city.placeId, { appearance: 'Piedra gris y niebla' });
    assert.equal(described.profile.appearance, 'Piedra gris y niebla');
    assert.equal(described.name, 'Puerto Ceniza', 'a partial edit keeps the name');
    assert.equal(described.parentId, country.placeId, 'and the parent');

    // Inhabitants read person_places, whose column is `label`, not `role`. Assuming the
    // wrong name threw only at runtime, in the renderer, as an uncaught IPC error.
    const resident = repo.createCharacter({ displayName: 'Vecina' });
    const places = require(path.join(repoRoot, 'electron/db/personPlacesRepo.ts'));
    places.addPersonPlace({ personId: resident.personId, placeId: city.placeId, label: 'Residencia' });
    const living = wp.inhabitantsOfPlace(city.placeId);
    assert.equal(living.length, 1);
    assert.equal(living[0].displayName, 'Vecina');
    assert.equal(living[0].role, 'Residencia', 'the person_places label is what surfaces as the role');
    repo.deleteCharacter(resident.personId);

    // The cycle guard: making the country a child of its own city would hang the tree.
    const cycled = wp.updateWorldPlace(country.placeId, { parentId: city.placeId });
    assert.equal(cycled.parentId, null, 'a reparent that closes a loop is refused, leaving the parent as it was');
    assert.equal(wp.getWorldPlace(city.placeId).parentId, country.placeId, 'and the other side is untouched');

    // Deleting a container DETACHES its contents rather than taking them with it.
    wp.deleteWorldPlace(country.placeId);
    assert.equal(wp.getWorldPlace(country.placeId), null);
    assert.equal(
      wp.getWorldPlace(city.placeId).parentId,
      null,
      'the city survives its country and becomes a root'
    );
  }

  // ── 16c. Secrets: who knew what, and since when ───────────────────────────
  {
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const keeper = repo.createCharacter({ displayName: 'La Heredera' });
    const confidant = repo.createCharacter({ displayName: 'El archivero' });
    const outsider = repo.createCharacter({ displayName: 'El pregonero' });

    const secret = story.createSecret({ title: 'No es hija del rey', ownerPersonId: keeper.personId });
    assert.equal(secret.status, 'kept', 'a new secret is kept by default');
    assert.equal(secret.ownerName, 'La Heredera', 'the owner name is resolved');

    story.addKnower({ secretId: secret.secretId, personId: keeper.personId });
    story.addKnower({ secretId: secret.secretId, personId: confidant.personId, sinceWorldDay: 1200, how: 'Lo leyó' });

    // The whole point of the table: who could plausibly have said this out loud, and when.
    assert.deepEqual(
      story.knowersAt(secret.secretId, 1100).map((k) => k.personName),
      ['La Heredera'],
      'before day 1200 only the owner knows'
    );
    assert.deepEqual(
      story.knowersAt(secret.secretId, 1300).map((k) => k.personName).sort(),
      ['El archivero', 'La Heredera'],
      'afterwards the confidant knows too'
    );
    // Someone with no date always knew, so they never drop out.
    assert.ok(story.knowersAt(secret.secretId, 0).some((k) => k.personName === 'La Heredera'));

    // The character sheet splits what they OWN from what they merely know.
    const keeperSecrets = story.secretsForCharacter(keeper.personId);
    assert.equal(keeperSecrets.owned.length, 1);
    assert.equal(keeperSecrets.known.length, 0, 'your own secret is not also "one you know"');
    const confidantSecrets = story.secretsForCharacter(confidant.personId);
    assert.equal(confidantSecrets.owned.length, 0);
    assert.equal(confidantSecrets.known.length, 1);
    assert.equal(story.secretsForCharacter(outsider.personId).known.length, 0);

    // A secret usually outlives its keeper — that is frequently the point of it.
    repo.deleteCharacter(keeper.personId);
    const orphaned = story.listSecrets().find((entry) => entry.secretId === secret.secretId);
    assert.ok(orphaned, 'the secret survives its owner');
    assert.equal(orphaned.ownerPersonId, null, 'and loses its owner rather than being deleted');
    // The dead keeper stops being a knower, though: that row cascades.
    assert.equal(story.listKnowers(secret.secretId).length, 1);

    // ── 16d. Scenes: two orders, and they are not the same ──────────────────
    const battle = story.createScene({ title: 'La caída de Vael', worldYear: 1229, worldDay: 36870 });
    const prologue = story.createScene({ title: 'Prólogo: tres siglos antes', worldYear: 900, worldDay: 27000 });
    assert.equal(battle.narrativeOrder, 0);
    assert.equal(prologue.narrativeOrder, 1, 'scenes append to the telling in creation order');

    // Now put the prologue first in the TELLING while it stays last in the CHRONOLOGY.
    story.updateScene(prologue.sceneId, { narrativeOrder: -1 });
    assert.deepEqual(
      story.listScenes('narrative').map((scene) => scene.title),
      ['Prólogo: tres siglos antes', 'La caída de Vael'],
      'narrative order is the manuscript order'
    );
    assert.deepEqual(
      story.listScenes('chronological').map((scene) => scene.title),
      ['Prólogo: tres siglos antes', 'La caída de Vael'],
      'and here they agree, because the prologue really is earlier'
    );
    // The case that proves the two orders are independent: a flash-FORWARD, told first but
    // happening last. Collapsing the two fields would make this impossible to file.
    const flashForward = story.createScene({ title: 'Lo que será', worldYear: 1400, narrativeOrder: -2 });
    assert.equal(story.listScenes('narrative')[0].title, 'Lo que será', 'told first');
    assert.equal(story.listScenes('chronological').at(-1).title, 'Lo que será', 'happens last');
    story.deleteScene(flashForward.sceneId);

    // Appearances, in narrative order — "when does she show up in the book".
    story.addSceneCharacter(battle.sceneId, confidant.personId, 'Testigo');
    story.addSceneCharacter(prologue.sceneId, confidant.personId, null);
    assert.deepEqual(
      story.appearancesOfCharacter(confidant.personId).map((a) => a.sceneTitle),
      ['Prólogo: tres siglos antes', 'La caída de Vael'],
      'appearances follow the telling, not the chronology'
    );
    assert.equal(story.listSceneCharacters(battle.sceneId)[0].role, 'Testigo');
    // Adding the same character twice updates the role instead of duplicating them.
    story.addSceneCharacter(battle.sceneId, confidant.personId, 'Narrador');
    assert.equal(story.listSceneCharacters(battle.sceneId).length, 1);
    assert.equal(story.listSceneCharacters(battle.sceneId)[0].role, 'Narrador');

    // Deleting a character removes their appearances but never the scene.
    repo.deleteCharacter(confidant.personId);
    assert.equal(story.listSceneCharacters(battle.sceneId).length, 0);
    assert.ok(story.listScenes().some((scene) => scene.sceneId === battle.sceneId), 'the scene survives its cast');
  }

  // ── 17. The v94 data copy, on a database that actually HAS old rows ────────
  // The checks above run on a vault created straight at v94, where character_images never
  // existed and the INSERT...SELECT copies nothing — so removing that copy entirely would
  // not have failed a single one of them. This is the only place the upgrade path from an
  // existing v92/v93 vault is exercised, which is exactly the path a real user takes.
  {
    const Database = require('better-sqlite3');
    const upgradePath = path.join(root, 'upgrade-from-93.sqlite');
    const old = new Database(upgradePath);
    const { migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
    const applyUpTo = (target) => {
      for (const migration of migrations.filter((m) => m.version <= target).sort((a, b) => a.version - b.version)) {
        old.exec(migration.up);
      }
      old.pragma(`user_version = ${target}`);
    };
    applyUpTo(93);
    assert.ok(
      old.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='character_images'").get().c,
      'a v93 database really has the old table'
    );
    const stamp = new Date().toISOString();
    // character_images.person_id has a real foreign key, so the person has to exist first.
    old.prepare(
      'INSERT INTO persons (person_id, display_name, sex, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('per_old', 'Personaje antiguo', 'unknown', stamp, stamp);
    old.prepare(
      `INSERT INTO character_images
        (image_id, person_id, kind, label, mime_type, bytes, blob, prompt, provider, model,
         style, generated, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('img_old', 'per_old', 'full_body', 'Retrato viejo', 'image/png', 8,
          Buffer.from('89504e470d0a1a0a', 'hex'), 'un prompt', 'gemini', 'm', 'cinematic', 1, 3, stamp, stamp);

    const v94 = migrations.find((m) => m.version === 94);
    old.exec(v94.up);

    const moved = old.prepare('SELECT * FROM world_images WHERE image_id = ?').get('img_old');
    assert.ok(moved, 'the existing image survived the move to world_images');
    assert.equal(moved.entity_kind, 'character', 'and was tagged as a character image');
    assert.equal(moved.entity_id, 'per_old', 'person_id became entity_id');
    // Everything the author cannot recreate has to come across, not just the bytes: the
    // prompt is what makes a generated image iterable instead of a dead end.
    assert.equal(moved.prompt, 'un prompt');
    assert.equal(moved.provider, 'gemini');
    assert.equal(moved.style, 'cinematic');
    assert.equal(moved.generated, 1);
    assert.equal(moved.sort_order, 3, 'the gallery order is preserved');
    assert.equal(moved.label, 'Retrato viejo');
    assert.deepEqual(moved.blob, Buffer.from('89504e470d0a1a0a', 'hex'), 'the bytes are intact');
    assert.equal(
      old.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='character_images'").get().c,
      0,
      'and the old table is gone, so nothing can write to it again'
    );
    old.close();
  }

  // ── 18. Character chat sessions own their messages and images ────────────
  {
    const chats = require(path.join(repoRoot, 'electron/db/characterChatRepo.ts'));
    const speaker = repo.createCharacter({ displayName: 'Iria de Sal' });
    const first = chats.createCharacterChatConversation({
      personId: speaker.personId,
      title: 'La noche del faro',
      imageEnabled: true,
    });
    assert.equal(first.imageEnabled, true);
    assert.equal(first.messageCount, 0);

    const author = chats.appendCharacterChatMessage(first.id, 'author', '¿Qué viste?');
    const answer = chats.appendCharacterChatMessage(first.id, 'character', 'Vi arder el horizonte.');
    chats.attachCharacterChatImage({
      conversationId: first.id,
      messageId: answer.id,
      blob: Buffer.from('chat-image-full'),
      thumbnailBlob: Buffer.from('chat-image-thumb'),
      mimeType: 'image/jpeg',
      prompt: 'horizon on fire, no text',
      provider: 'openai',
      model: 'image-test',
    });

    const loaded = chats.getCharacterChatConversation(first.id);
    assert.equal(loaded.messageCount, 2);
    assert.equal(loaded.imageCount, 1);
    assert.deepEqual(loaded.messages.map((message) => message.id), [author.id, answer.id]);
    assert.equal(loaded.messages[1].image.provider, 'openai');
    assert.deepEqual(
      chats.getCharacterChatImageBlob(loaded.messages[1].image.imageId).blob,
      Buffer.from('chat-image-full'),
      'the protocol getter returns the linked full-size bytes'
    );
    assert.deepEqual(
      chats.getCharacterChatImageThumbnail(loaded.messages[1].image.imageId).blob,
      Buffer.from('chat-image-thumb'),
      'the chat stream can load the small thumbnail without transferring the full image'
    );
    assert.equal(chats.listCharacterChatConversations(speaker.personId)[0].title, 'La noche del faro');

    chats.deleteCharacterChatConversation(first.id);
    assert.equal(chats.getCharacterChatConversation(first.id), null);
    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS c FROM character_chat_messages WHERE conversation_id = ?').get(first.id).c,
      0,
      'deleting one conversation deletes every message'
    );
    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS c FROM character_chat_images WHERE conversation_id = ?').get(first.id).c,
      0,
      'deleting one conversation deletes every linked image'
    );

    const second = chats.createCharacterChatConversation({
      personId: speaker.personId,
      title: 'Otra noche',
      imageEnabled: false,
    });
    const secondAnswer = chats.appendCharacterChatMessage(second.id, 'character', 'No mires atrás.');
    chats.attachCharacterChatImage({
      conversationId: second.id,
      messageId: secondAnswer.id,
      blob: Buffer.from('owned-image'),
      mimeType: 'image/jpeg',
      prompt: 'a closed door',
      provider: 'google',
      model: 'image-test',
    });
    repo.deleteCharacter(speaker.personId);
    assert.equal(chats.getCharacterChatConversation(second.id), null, 'deleting the character deletes its chats');
    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS c FROM character_chat_images WHERE conversation_id = ?').get(second.id).c,
      0,
      'and no invisible image blobs are leaked'
    );
  }

  console.log('Worldbuilding characters repository test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
