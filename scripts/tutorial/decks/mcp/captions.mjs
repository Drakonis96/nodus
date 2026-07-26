// Spanish subtitles for the MCP and Nodus Server tutorial.
//
// English is not listed: it is the spoken language and is read from shots-mcp.mjs,
// so script and subtitles cannot drift apart.

export const LANGUAGES = [
  { code: 'en', label: 'English', youtube: 'en' },
  { code: 'es', label: 'Español', youtube: 'es' },
];

export const CAPTIONS = {
  es: {
    'welcome': 'Nodus permite que otros programas lleguen a tu trabajo de dos maneras distintas, y es fácil confundirlas.',
    'mcp-what': 'La primera es MCP, el protocolo de contexto de modelo. Abre un pequeño servidor en este ordenador que un cliente de IA puede consultar, para que el modelo busque en tu bóveda mientras te responde.',
    'server-what': 'La segunda es Nodus Server, que va en sentido contrario: publica una copia filtrada de una bóveda para que otras personas puedan leerla.',
    'difference': 'En corto: MCP se queda en tu máquina, y Nodus Server es la forma de compartir con otra persona.',
    'mcp-open': 'MCP está en los ajustes de integraciones.',
    'mcp-enable': 'Un interruptor lo arranca, y la línea de estado de abajo te dice que está escuchando.',
    'mcp-port': 'Escucha en un puerto local, el 4319 por defecto, y solo en este ordenador. No se expone nada a la red.',
    'mcp-details': 'Para conectar un cliente hacen falta dos cosas, y las dos están aquí.',
    'mcp-values': 'La dirección a la que debe llamar el cliente, y un token que demuestra que la petición es tuya. Aquí sale borroso porque es un secreto, igual que una clave de API.',
    'mcp-config': 'Y para Claude Desktop hay un bloque de configuración ya listo, relleno con tu dirección y tu token.',
    'mcp-chatgpt': 'También hay una opción guiada que conecta con ChatGPT mediante un túnel seguro, sin que abras ningún puerto.',
    'mcp-regen': 'Y si un token se escapa alguna vez, regenerarlo anula el anterior al instante. Después hay que reconectar todos los clientes.',
    'server-open': 'Nodus Server tiene su propia sección, y empieza en otro sitio: en una máquina que esté siempre encendida.',
    'server-docker': 'Lo levantas tú con Docker, en un servidor de casa o alquilado, y la guía incorporada recorre esa parte paso a paso.',
    'server-how': 'Una vez en marcha, el reparto es este: tu ordenador publica y el servidor sirve. Sigue respondiendo aunque apagues tu máquina.',
    'server-outbound': 'No se abre nada de tu lado. Nodus envía hacia fuera por HTTPS, y no comparte puerto ni token con el MCP local.',
    'server-url': 'Para conectar una bóveda le das la dirección de tu servidor.',
    'server-code': 'Y un código de emparejamiento, que creas en el propio servidor: entras como administrador, creas un espacio y le pides un código. Dura quince minutos y sirve una sola vez.',
    'server-connect': 'Conectar, y la bóveda queda emparejada.',
    'server-list': 'A partir de ahí cada bóveda conectada aparece por separado, con su última publicación.',
    'server-privacy': 'Lo que viaja es una copia filtrada: referencias y la capa académica construida sobre ellas. Los PDF, las credenciales, las rutas de archivo, los embeddings y todo lo relativo al alumnado no salen nunca de tu ordenador.',
    'server-publish': 'La publicación va sola, en segundo plano, y siempre puedes enviar el estado actual a mano.',
    'recap': 'Resumiendo: MCP para que un modelo lea tu bóveda aquí, Nodus Server para que otras personas la lean allí. Trabajos distintos, y puedes usar uno sin el otro.',
  },
};
