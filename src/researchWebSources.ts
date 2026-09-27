/** Ask the shell to open a web source as a new tab of Nodus' Browser (App.tsx). */
export function openWebSource(url: string): void {
  window.dispatchEvent(new CustomEvent('nodus:open-browser-url', { detail: { url } }));
}
