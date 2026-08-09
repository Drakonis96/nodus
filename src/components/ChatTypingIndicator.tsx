import './chatTypingIndicator.css';

/** The animated three-dot waiting state shared by Nodus chat surfaces. */
export function ChatTypingIndicator({ label }: { label: string }) {
  return (
    <span className="chat-typing-indicator" role="status" aria-label={label}>
      <span className="chat-typing-dot" aria-hidden="true" />
      <span className="chat-typing-dot" aria-hidden="true" />
      <span className="chat-typing-dot" aria-hidden="true" />
    </span>
  );
}
