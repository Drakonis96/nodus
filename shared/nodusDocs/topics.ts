import type { NodusDocTopic } from './types';
import { CORE_DOC_TOPICS } from './topics.core';
import { VAULT_DOC_TOPICS } from './topics.vaults';
import { SECTION_DOC_TOPICS } from './topics.sections';
import { SETTINGS_DOC_TOPICS } from './topics.settings';
import { MODEL_DOC_TOPICS } from './topics.models';
import { TOOL_DOC_TOPICS } from './topics.tools';
import { NODI_DOC_TOPICS } from './topics.nodi';
import { SERVER_DOC_TOPICS } from './topics.server';
import { TROUBLESHOOTING_DOC_TOPICS } from './topics.troubleshooting';
import { PRIVACY_DOC_TOPICS } from './topics.privacy';

/** Every verified product sheet Nodi can answer from.
 *
 *  The order is only a fallback: the retrieval ranks by the question. Keeping the sheets
 *  in one flat list is what lets the index, the integrity check and the recall test read
 *  the corpus as a single table. */
export const NODUS_DOC_TOPICS: readonly NodusDocTopic[] = [
  ...CORE_DOC_TOPICS,
  ...VAULT_DOC_TOPICS,
  ...SECTION_DOC_TOPICS,
  ...SETTINGS_DOC_TOPICS,
  ...MODEL_DOC_TOPICS,
  ...TOOL_DOC_TOPICS,
  ...NODI_DOC_TOPICS,
  ...SERVER_DOC_TOPICS,
  ...TROUBLESHOOTING_DOC_TOPICS,
  ...PRIVACY_DOC_TOPICS,
];
