import type { Server } from 'node:http';

/** Only for Nodus-owned listeners. Never changes a Zotero or external MCP port. */
export async function listenLoopback(server: Server, preferredPort: number): Promise<number> {
  const bind = (port: number) => new Promise<number>((resolve, reject) => {
    const fail = (error: Error) => { server.off('listening', ready); reject(error); };
    const ready = () => {
      server.off('error', fail);
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('nodus_listener_address_unavailable'));
      else resolve(address.port);
    };
    server.once('error', fail); server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  try { return await bind(preferredPort); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return bind(0);
  }
}
