// What each secondary window is allowed to reach on window.nodus.
//
// The main window gets the whole NodusApi. Nodi and the Presenter do not: they
// are separate BrowserWindows that happened to load the same preload, so an
// always-on-top overlay could delete a vault. The lists below are the measured
// surface of each — every `window.nodus.*` call in the code that window loads —
// and electron/preload/{nodi,presenter}.ts expose exactly them.
//
// These are names, not new signatures: the types are `Pick`ed from NodusApi, so a
// renamed or retyped method breaks here instead of silently dropping out.
import type { NodusApi } from '../types';

/**
 * Nodi's overlay window: notifications, its conversations and notes, the chat
 * stream, the native drag/expand controls, and the corpus lookups behind the
 * citation card it shows in an answer.
 */
export const NODI_WINDOW_METHODS = [
  // notifications
  'listNotifications',
  'refreshNotifications',
  'markNotificationsRead',
  'clearNotifications',
  'openNotification',
  'onNotificationsChanged',
  // published announcements, shown in the same panel
  'listAnnouncements',
  'markAnnouncementRead',
  'onAnnouncementsChanged',
  // an announcement may carry a link; the main process still refuses any scheme
  // that is not http/https/mailto (see shell:openExternal)
  'openExternal',
  // conversations and notes
  'listNodiConversations',
  'saveNodiConversation',
  'deleteNodiConversation',
  'clearNodiConversations',
  'listNodiNotes',
  'saveNodiNote',
  'deleteNodiNote',
  // chat
  'nodiChatStream',
  'cancelNodiChat',
  'getNodiViewContext',
  'consumeNodiQuoteSelection',
  'onNodiQuoteSelection',
  // the overlay window itself
  'nodiGetOverlayPlacement',
  'nodiRefreshOverlayPlacement',
  'nodiSetExpanded',
  'nodiSetMouseIgnore',
  'nodiBeginWindowDrag',
  'nodiDragWindow',
  'nodiEndWindowDrag',
  'onNodiDismiss',
  'nodiOpenMainWindow',
  'nodiOpenSettings',
  'nodiOpenWorldEntry',
  // shell state the avatar and the composer follow
  'getSettings',
  'updateSettings',
  'onSettingsChanged',
  'getActiveVault',
  'onVaultChanged',
  // the citation card
  'getCitationPreview',
  'getIdeaDetail',
  'getEdgeDetail',
  'getGapDetail',
  'getWork',
  'getPassage',
  'openInZotero',
] as const satisfies readonly (keyof NodusApi)[];

export type NodiApi = Pick<NodusApi, (typeof NODI_WINDOW_METHODS)[number]>;

/**
 * The Presenter's audience and presenter-view windows: the deck, playback control
 * between the two, and the cast/QR handoff. Nothing that writes to a vault.
 *
 * presenterRemote.html is not here on purpose — the phone remote is served over
 * HTTP by the cast server and has no preload at all.
 */
export const PRESENTER_WINDOW_METHODS = [
  'getPresenterLibrary',
  'getPresenterPdfData',
  'getPresenterServerInfo',
  'getPresenterVolume',
  'setPresenterVolume',
  'onPresenterControl',
  'sendPresenterControl',
  'openPresenterCast',
  'stopPresenter',
] as const satisfies readonly (keyof NodusApi)[];

export type PresenterApi = Pick<NodusApi, (typeof PRESENTER_WINDOW_METHODS)[number]>;
