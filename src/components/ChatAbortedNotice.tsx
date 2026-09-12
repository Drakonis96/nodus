import { t } from '../i18n';

/**
 * Small red note shown under an answer the user stopped. The partial text stays
 * on screen; this line explains why it ends there instead of looking like a
 * failed generation that replaced the whole reply.
 */
export function ChatAbortedNotice({ className }: { className?: string }) {
  return (
    <p
      role="status"
      data-testid="chat-aborted-notice"
      className={`mt-1.5 text-[11px] text-red-500 dark:text-red-400${className ? ` ${className}` : ''}`}
    >
      {t('Solicitud cancelada por el usuario.')}
    </p>
  );
}
