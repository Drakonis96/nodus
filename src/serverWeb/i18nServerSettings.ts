import type { AppLanguage } from "@shared/types";

/** Copy owned by the native Server Settings surface.
 *
 * Keep this catalogue complete for every non-Spanish UI language. The generic
 * Server translator deliberately has an English safety fallback, but Settings
 * is account-facing chrome and must never turn into a Spanish/English mixture
 * when a person has explicitly selected another language.
 */
export const SERVER_SETTINGS_TRANSLATIONS: Record<
  Exclude<AppLanguage, "es">,
  Record<string, string>
> = {
  en: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "Configured keys and models are shared across all your vaults. Credentials remain private to this account.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "The operator must configure the server's encrypted keyring before credentials can be saved.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Open a provider and star the models you want to use in selectors.",
    "Configurado en Server": "Configured on Server",
    "Sin credencial en Server": "No credential on Server",
    "Disponible mediante Desktop": "Available through Desktop",
    Sustituir: "Replace",
    Guardar: "Save",
    Eliminar: "Remove",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "This provider requires the Nodus Desktop runtime or local network. Its favourites are preserved, but Server does not attempt to run it.",
    "Actualizando catálogo…": "Refreshing catalogue…",
    "Catálogo en vivo del proveedor": "Live provider catalogue",
    "Catálogo compatible integrado": "Built-in compatible catalogue",
    "Buscar modelo…": "Search models…",
    "Ningún modelo coincide con la búsqueda.": "No models match your search.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "Basic mode uses one general model; advanced mode lets you choose each task independently.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "There are pending inherited assignments ({assignments}). Downloadable local models do not run on Server and are not replaced with a paid model.",
    "Un modelo general atiende las tareas de texto compatibles.":
      "One general model handles compatible text tasks.",
    "Cada tarea usa su modelo seleccionado de forma independiente.":
      "Each task uses its selected model independently.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "Server shows the same tabular library as Desktop using only the documents the owner chose to publish.",
    "La publicación es independiente para cada vault.":
      "Publishing is independent for each vault.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "PDFs, local paths and credentials are excluded unless permitted content is explicitly published.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "The Server account keeps the published view. Zotero connection, storage and synchronisation run on Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Open Settings → Library in Desktop to change the Zotero source. Server will apply the next publication to every connected vault without inventing a separate library.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.":
      "These settings depend on local files and remain in Desktop.",
    "Server consume el texto limpio incluido por el publicador.":
      "Server uses the clean text included by the publisher.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.":
      "Tesseract, languages and page limits run where the document resides.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "Appearance and accessibility are part of the portable profile and are shared across devices.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.":
      "Connect ChatGPT, Claude and compatible clients to this user and their assigned vaults.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.":
      "Synchronises publishing and the portable profile from Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.":
      "Desktop add-ons keep their local configuration.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.":
      "The integrated browser requires Electron and remains outside the Server sidebar.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Cookies, permissions, downloads and web storage are never copied to the server. The extension and Nodus Browser are configured in Desktop.",
    "Publicar un vault, asignar acceso y consultar la réplica.":
      "Publish a vault, assign access and inspect the replica.",
    "Credenciales por usuario, modelos favoritos y privacidad.":
      "Per-user credentials, favourite models and privacy.",
    "Connected Vault, MCP y clientes compatibles.":
      "Connected Vault, MCP and compatible clients.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "Backups contain local data, paths and secrets that never cross the portable profile. They are created and restored only in Desktop or through the Server operator's backup policy.",
    "Favoritos, modelos, interfaz y políticas compatibles.":
      "Favourites, models, interface and compatible policies.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · explicit publishing · isolated credentials",
    "Ayuda sobre {section}": "Help for {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Summarises this server and shows how many vaults, users and devices it manages, together with its access addresses.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Creates an editable vault that lives directly on Server. Choose its name, type and initial description.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Shows native vaults and those published from Desktop. Here you can review their status, adjust what is published and generate connection codes.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Creates accounts and controls what each user can do in each vault: read, write or manage it as an owner.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Lists Desktop devices authorised to publish vaults to this server. You can revoke a device that should no longer synchronise.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Shows the account and role you used to sign in. You can also change the password or sign out of the current session.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "Updates are applied on the Server host. This view does not simulate downloads or restarts that the browser cannot perform.",
  },
  fr: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "Les clés et modèles configurés sont partagés entre tous vos coffres. Les identifiants restent privés pour ce compte.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "L’opérateur doit configurer le trousseau chiffré du serveur avant de pouvoir enregistrer des identifiants.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Ouvrez un fournisseur et ajoutez aux favoris les modèles à utiliser dans les sélecteurs.",
    "Configurado en Server": "Configuré sur Server",
    "Sin credencial en Server": "Aucun identifiant sur Server",
    "Disponible mediante Desktop": "Disponible via Desktop",
    Sustituir: "Remplacer",
    Guardar: "Enregistrer",
    Eliminar: "Supprimer",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Ce fournisseur nécessite l’environnement d’exécution ou le réseau local de Nodus Desktop. Ses favoris sont conservés, mais Server ne tente pas de l’exécuter.",
    "Actualizando catálogo…": "Actualisation du catalogue…",
    "Catálogo en vivo del proveedor": "Catalogue en direct du fournisseur",
    "Catálogo compatible integrado": "Catalogue compatible intégré",
    "Buscar modelo…": "Rechercher un modèle…",
    "Ningún modelo coincide con la búsqueda.": "Aucun modèle ne correspond à la recherche.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "Le mode simple utilise un modèle général ; le mode avancé permet de choisir chaque tâche séparément.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Des affectations héritées sont en attente ({assignments}). Les modèles locaux téléchargeables ne s’exécutent pas sur Server et ne sont pas remplacés par un modèle payant.",
    "Un modelo general atiende las tareas de texto compatibles.":
      "Un modèle général prend en charge les tâches de texte compatibles.",
    "Cada tarea usa su modelo seleccionado de forma independiente.":
      "Chaque tâche utilise indépendamment le modèle sélectionné.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "Server affiche la même bibliothèque tabulaire que Desktop, uniquement avec les documents que le propriétaire a choisi de publier.",
    "La publicación es independiente para cada vault.": "La publication est indépendante pour chaque coffre.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "Les PDF, chemins locaux et identifiants sont exclus, sauf publication explicite du contenu autorisé.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "Le compte Server conserve la vue publiée. La connexion, le stockage et la synchronisation Zotero s’exécutent dans Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Ouvrez Paramètres → Bibliothèque dans Desktop pour changer la source Zotero. Server appliquera la prochaine publication à tous les coffres connectés sans créer une bibliothèque distincte.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Ces paramètres dépendent de fichiers locaux et restent dans Desktop.",
    "Server consume el texto limpio incluido por el publicador.": "Server utilise le texte nettoyé inclus par l’éditeur.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.":
      "Tesseract, les langues et les limites de pages s’exécutent là où se trouve le document.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "L’apparence et l’accessibilité font partie du profil portable et sont partagées entre les appareils.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.":
      "Connectez ChatGPT, Claude et les clients compatibles à cet utilisateur et à ses coffres attribués.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Synchronise la publication et le profil portable depuis Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.": "Les extensions Desktop conservent leur configuration locale.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.":
      "Le navigateur intégré nécessite Electron et reste en dehors de la barre latérale de Server.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Les cookies, autorisations, téléchargements et données web ne sont jamais copiés sur le serveur. L’extension et Nodus Browser se configurent dans Desktop.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Publier un coffre, attribuer les accès et consulter la réplique.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Identifiants par utilisateur, modèles favoris et confidentialité.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP et clients compatibles.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "Les sauvegardes contiennent des données locales, chemins et secrets qui ne traversent jamais le profil portable. Elles sont créées et restaurées uniquement dans Desktop ou selon la politique de sauvegarde de l’opérateur Server.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Favoris, modèles, interface et politiques compatibles.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · publication explicite · identifiants isolés",
    "Ayuda sobre {section}": "Aide sur {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Résume ce serveur et indique le nombre de coffres, d’utilisateurs et d’appareils qu’il gère, ainsi que ses adresses d’accès.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Crée un coffre modifiable qui réside directement sur Server. Choisissez son nom, son type et sa description initiale.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Affiche les coffres natifs et ceux publiés depuis Desktop. Vous pouvez consulter leur état, régler ce qui est publié et générer des codes de connexion.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Crée des comptes et définit ce que chaque utilisateur peut faire dans chaque coffre : lire, écrire ou l’administrer en tant que propriétaire.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Répertorie les appareils Desktop autorisés à publier des coffres sur ce serveur. Vous pouvez révoquer un appareil qui ne doit plus se synchroniser.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Affiche le compte et le rôle utilisés pour vous connecter. Vous pouvez également modifier le mot de passe ou fermer la session actuelle.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "Les mises à jour sont appliquées sur l’hôte Server. Cette vue ne simule pas les téléchargements ou redémarrages que le navigateur ne peut pas effectuer.",
  },
  de: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "Konfigurierte Schlüssel und Modelle werden von allen Tresoren gemeinsam genutzt. Zugangsdaten bleiben für dieses Konto privat.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "Der Betreiber muss den verschlüsselten Schlüsselbund des Servers konfigurieren, bevor Zugangsdaten gespeichert werden können.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Öffnen Sie einen Anbieter und markieren Sie die Modelle als Favoriten, die Sie in Auswahllisten verwenden möchten.",
    "Configurado en Server": "Auf Server konfiguriert",
    "Sin credencial en Server": "Keine Zugangsdaten auf Server",
    "Disponible mediante Desktop": "Über Desktop verfügbar",
    Sustituir: "Ersetzen",
    Guardar: "Speichern",
    Eliminar: "Entfernen",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Dieser Anbieter benötigt die Laufzeitumgebung oder das lokale Netzwerk von Nodus Desktop. Favoriten bleiben erhalten, Server versucht ihn jedoch nicht auszuführen.",
    "Actualizando catálogo…": "Katalog wird aktualisiert…",
    "Catálogo en vivo del proveedor": "Live-Katalog des Anbieters",
    "Catálogo compatible integrado": "Integrierter kompatibler Katalog",
    "Buscar modelo…": "Modell suchen…",
    "Ningún modelo coincide con la búsqueda.": "Kein Modell entspricht der Suche.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "Im Basismodus wird ein allgemeines Modell verwendet; im erweiterten Modus kann jede Aufgabe separat gewählt werden.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Es gibt ausstehende übernommene Zuweisungen ({assignments}). Herunterladbare lokale Modelle laufen nicht auf Server und werden nicht durch ein kostenpflichtiges Modell ersetzt.",
    "Un modelo general atiende las tareas de texto compatibles.": "Ein allgemeines Modell übernimmt kompatible Textaufgaben.",
    "Cada tarea usa su modelo seleccionado de forma independiente.": "Jede Aufgabe verwendet unabhängig das ausgewählte Modell.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "Server zeigt dieselbe tabellarische Bibliothek wie Desktop und verwendet nur die vom Eigentümer veröffentlichten Dokumente.",
    "La publicación es independiente para cada vault.": "Die Veröffentlichung erfolgt für jeden Tresor unabhängig.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "PDFs, lokale Pfade und Zugangsdaten sind ausgeschlossen, sofern erlaubte Inhalte nicht ausdrücklich veröffentlicht werden.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "Das Server-Konto bewahrt die veröffentlichte Ansicht. Zotero-Verbindung, Speicherung und Synchronisierung laufen in Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Öffnen Sie Einstellungen → Bibliothek in Desktop, um die Zotero-Quelle zu ändern. Server übernimmt die nächste Veröffentlichung für alle verbundenen Tresore, ohne eine eigene Bibliothek zu erfinden.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Diese Einstellungen hängen von lokalen Dateien ab und verbleiben in Desktop.",
    "Server consume el texto limpio incluido por el publicador.": "Server verwendet den vom Herausgeber bereitgestellten bereinigten Text.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.": "Tesseract, Sprachen und Seitenlimits werden dort ausgeführt, wo das Dokument liegt.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "Darstellung und Barrierefreiheit gehören zum portablen Profil und werden geräteübergreifend geteilt.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.":
      "Verbindet ChatGPT, Claude und kompatible Clients mit diesem Benutzer und den zugewiesenen Tresoren.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Synchronisiert Veröffentlichung und portables Profil aus Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.": "Desktop-Erweiterungen behalten ihre lokale Konfiguration.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.": "Der integrierte Browser benötigt Electron und bleibt außerhalb der Server-Seitenleiste.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Cookies, Berechtigungen, Downloads und Webspeicher werden nie auf den Server kopiert. Erweiterung und Nodus Browser werden in Desktop konfiguriert.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Einen Tresor veröffentlichen, Zugriff zuweisen und das Replikat prüfen.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Zugangsdaten pro Benutzer, Favoritenmodelle und Datenschutz.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP und kompatible Clients.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "Sicherungen enthalten lokale Daten, Pfade und Geheimnisse, die nie in das portable Profil gelangen. Sie werden ausschließlich in Desktop oder nach der Sicherungsrichtlinie des Server-Betreibers erstellt und wiederhergestellt.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Favoriten, Modelle, Oberfläche und kompatible Richtlinien.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · ausdrückliche Veröffentlichung · isolierte Zugangsdaten",
    "Ayuda sobre {section}": "Hilfe zu {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Fasst diesen Server zusammen und zeigt die Anzahl der verwalteten Tresore, Benutzer und Geräte sowie seine Zugriffsadressen.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Erstellt einen bearbeitbaren Tresor, der direkt auf Server liegt. Wählen Sie Namen, Typ und anfängliche Beschreibung.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Zeigt native und aus Desktop veröffentlichte Tresore. Hier können Sie ihren Status prüfen, Veröffentlichungsinhalte festlegen und Verbindungscodes erzeugen.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Erstellt Konten und legt fest, was jeder Benutzer in jedem Tresor darf: lesen, schreiben oder ihn als Eigentümer verwalten.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Listet Desktop-Geräte auf, die Tresore auf diesem Server veröffentlichen dürfen. Geräte, die nicht mehr synchronisieren sollen, können widerrufen werden.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Zeigt das Konto und die Rolle der aktuellen Anmeldung. Hier können Sie auch das Passwort ändern oder die aktuelle Sitzung abmelden.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "Aktualisierungen werden auf dem Server-Host angewendet. Diese Ansicht simuliert keine Downloads oder Neustarts, die der Browser nicht ausführen kann.",
  },
  pt: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "As chaves e os modelos configurados são partilhados entre todos os seus cofres. As credenciais permanecem privadas desta conta.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "O operador tem de configurar o porta-chaves cifrado do servidor antes de guardar credenciais.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Abra um provedor e marque como favoritos os modelos que pretende usar nos seletores.",
    "Configurado en Server": "Configurado no Server",
    "Sin credencial en Server": "Sem credencial no Server",
    "Disponible mediante Desktop": "Disponível através do Desktop",
    Sustituir: "Substituir",
    Guardar: "Guardar",
    Eliminar: "Remover",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Este provedor requer o runtime ou a rede local do Nodus Desktop. Os favoritos são preservados, mas o Server não tenta executá-lo.",
    "Actualizando catálogo…": "A atualizar o catálogo…",
    "Catálogo en vivo del proveedor": "Catálogo em direto do provedor",
    "Catálogo compatible integrado": "Catálogo compatível integrado",
    "Buscar modelo…": "Procurar modelo…",
    "Ningún modelo coincide con la búsqueda.": "Nenhum modelo corresponde à pesquisa.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "O modo básico usa um modelo geral; o modo avançado permite escolher cada tarefa separadamente.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Existem atribuições herdadas pendentes ({assignments}). Os modelos locais descarregáveis não são executados no Server nem substituídos por um modelo pago.",
    "Un modelo general atiende las tareas de texto compatibles.": "Um modelo geral trata das tarefas de texto compatíveis.",
    "Cada tarea usa su modelo seleccionado de forma independiente.": "Cada tarefa usa de forma independente o modelo selecionado.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "O Server mostra a mesma biblioteca tabular do Desktop usando apenas os documentos que o proprietário decidiu publicar.",
    "La publicación es independiente para cada vault.": "A publicação é independente para cada cofre.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "PDF, caminhos locais e credenciais são excluídos, salvo publicação explícita do conteúdo permitido.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "A conta Server conserva a vista publicada. A ligação, o armazenamento e a sincronização do Zotero são executados no Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Abra Definições → Biblioteca no Desktop para alterar a fonte do Zotero. O Server aplicará a publicação seguinte a todos os cofres ligados sem criar uma biblioteca separada.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Estas definições dependem de ficheiros locais e permanecem no Desktop.",
    "Server consume el texto limpio incluido por el publicador.": "O Server utiliza o texto limpo incluído pelo publicador.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.": "O Tesseract, os idiomas e os limites de páginas são executados onde reside o documento.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "A aparência e a acessibilidade fazem parte do perfil portátil e são partilhadas entre dispositivos.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.": "Liga o ChatGPT, Claude e clientes compatíveis a este utilizador e aos cofres atribuídos.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Sincroniza a publicação e o perfil portátil a partir do Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.": "Os suplementos do Desktop mantêm a configuração local.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.": "O navegador integrado requer Electron e permanece fora da barra lateral do Server.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Cookies, permissões, transferências e armazenamento web nunca são copiados para o servidor. A extensão e o Nodus Browser são configurados no Desktop.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Publicar um cofre, atribuir acesso e consultar a réplica.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Credenciais por utilizador, modelos favoritos e privacidade.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP e clientes compatíveis.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "As cópias contêm dados locais, caminhos e segredos que nunca atravessam o perfil portátil. São criadas e restauradas apenas no Desktop ou através da política de cópias do operador do Server.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Favoritos, modelos, interface e políticas compatíveis.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · publicação explícita · credenciais isoladas",
    "Ayuda sobre {section}": "Ajuda sobre {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Resume este servidor e mostra quantos cofres, utilizadores e dispositivos gere, juntamente com os respetivos endereços de acesso.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Cria um cofre editável que reside diretamente no Server. Escolha o nome, o tipo e a descrição inicial.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Mostra os cofres nativos e os publicados a partir do Desktop. Aqui pode rever o estado, ajustar o que é publicado e gerar códigos de ligação.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Cria contas e decide o que cada utilizador pode fazer em cada cofre: ler, escrever ou administrá-lo como proprietário.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Lista os dispositivos Desktop autorizados a publicar cofres neste servidor. Pode revogar um dispositivo que já não deva sincronizar.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Mostra a conta e a função usadas para iniciar sessão. Também permite alterar a palavra-passe ou terminar a sessão atual.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "As atualizações são aplicadas no anfitrião do Server. Esta vista não simula transferências ou reinícios que o navegador não pode executar.",
  },
  "pt-BR": {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "As chaves e os modelos configurados são compartilhados entre todos os seus cofres. As credenciais permanecem privadas desta conta.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "O operador precisa configurar o chaveiro criptografado do servidor antes de salvar credenciais.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Abra um provedor e marque como favoritos os modelos que deseja usar nos seletores.",
    "Configurado en Server": "Configurado no Server",
    "Sin credencial en Server": "Sem credencial no Server",
    "Disponible mediante Desktop": "Disponível pelo Desktop",
    Sustituir: "Substituir",
    Guardar: "Salvar",
    Eliminar: "Remover",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Este provedor requer o runtime ou a rede local do Nodus Desktop. Os favoritos são preservados, mas o Server não tenta executá-lo.",
    "Actualizando catálogo…": "Atualizando catálogo…",
    "Catálogo en vivo del proveedor": "Catálogo ao vivo do provedor",
    "Catálogo compatible integrado": "Catálogo compatível integrado",
    "Buscar modelo…": "Buscar modelo…",
    "Ningún modelo coincide con la búsqueda.": "Nenhum modelo corresponde à busca.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "O modo básico usa um modelo geral; o modo avançado permite escolher cada tarefa separadamente.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Há atribuições herdadas pendentes ({assignments}). Os modelos locais para download não são executados no Server nem substituídos por um modelo pago.",
    "Un modelo general atiende las tareas de texto compatibles.": "Um modelo geral atende às tarefas de texto compatíveis.",
    "Cada tarea usa su modelo seleccionado de forma independiente.": "Cada tarefa usa seu modelo selecionado de forma independente.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "O Server mostra a mesma biblioteca tabular do Desktop usando somente os documentos que o proprietário decidiu publicar.",
    "La publicación es independiente para cada vault.": "A publicação é independente para cada cofre.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "PDFs, caminhos locais e credenciais ficam de fora, exceto quando o conteúdo permitido é publicado explicitamente.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "A conta Server mantém a vista publicada. A conexão, o armazenamento e a sincronização do Zotero são executados no Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Abra Configurações → Biblioteca no Desktop para alterar a fonte do Zotero. O Server aplicará a próxima publicação a todos os cofres conectados sem criar uma biblioteca separada.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Estas configurações dependem de arquivos locais e permanecem no Desktop.",
    "Server consume el texto limpio incluido por el publicador.": "O Server usa o texto limpo incluído pelo publicador.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.": "O Tesseract, os idiomas e os limites de páginas são executados onde o documento está.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "A aparência e a acessibilidade fazem parte do perfil portátil e são compartilhadas entre dispositivos.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.": "Conecta o ChatGPT, Claude e clientes compatíveis a este usuário e aos cofres atribuídos.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Sincroniza a publicação e o perfil portátil pelo Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.": "Os complementos do Desktop mantêm sua configuração local.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.": "O navegador integrado requer Electron e permanece fora da barra lateral do Server.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Cookies, permissões, downloads e armazenamento web nunca são copiados para o servidor. A extensão e o Nodus Browser são configurados no Desktop.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Publicar um cofre, atribuir acesso e consultar a réplica.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Credenciais por usuário, modelos favoritos e privacidade.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP e clientes compatíveis.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "Os backups contêm dados locais, caminhos e segredos que nunca atravessam o perfil portátil. Eles são criados e restaurados somente no Desktop ou pela política de backup do operador do Server.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Favoritos, modelos, interface e políticas compatíveis.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · publicação explícita · credenciais isoladas",
    "Ayuda sobre {section}": "Ajuda sobre {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Resume este servidor e mostra quantos cofres, usuários e dispositivos ele gerencia, além dos respectivos endereços de acesso.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Cria um cofre editável que fica diretamente no Server. Escolha o nome, o tipo e a descrição inicial.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Mostra os cofres nativos e os publicados pelo Desktop. Aqui você pode verificar o status, ajustar o que é publicado e gerar códigos de conexão.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Cria contas e define o que cada usuário pode fazer em cada cofre: ler, escrever ou administrá-lo como proprietário.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Lista os dispositivos Desktop autorizados a publicar cofres neste servidor. Você pode revogar um dispositivo que não deve mais sincronizar.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Mostra a conta e a função usadas para entrar. Também permite alterar a senha ou sair da sessão atual.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "As atualizações são aplicadas no host do Server. Esta vista não simula downloads ou reinicializações que o navegador não pode executar.",
  },
  it: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "Le chiavi e i modelli configurati sono condivisi tra tutti i tuoi vault. Le credenziali restano private per questo account.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "L’operatore deve configurare il portachiavi cifrato del server prima di salvare le credenziali.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Apri un provider e aggiungi ai preferiti i modelli da usare nei selettori.",
    "Configurado en Server": "Configurato su Server",
    "Sin credencial en Server": "Nessuna credenziale su Server",
    "Disponible mediante Desktop": "Disponibile tramite Desktop",
    Sustituir: "Sostituisci",
    Guardar: "Salva",
    Eliminar: "Rimuovi",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Questo provider richiede il runtime o la rete locale di Nodus Desktop. I preferiti vengono conservati, ma Server non tenta di eseguirlo.",
    "Actualizando catálogo…": "Aggiornamento del catalogo…",
    "Catálogo en vivo del proveedor": "Catalogo in tempo reale del provider",
    "Catálogo compatible integrado": "Catalogo compatibile integrato",
    "Buscar modelo…": "Cerca modello…",
    "Ningún modelo coincide con la búsqueda.": "Nessun modello corrisponde alla ricerca.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "La modalità base usa un modello generale; la modalità avanzata consente di scegliere ogni attività separatamente.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Sono presenti assegnazioni ereditate in sospeso ({assignments}). I modelli locali scaricabili non vengono eseguiti su Server né sostituiti da un modello a pagamento.",
    "Un modelo general atiende las tareas de texto compatibles.": "Un modello generale gestisce le attività di testo compatibili.",
    "Cada tarea usa su modelo seleccionado de forma independiente.": "Ogni attività usa in modo indipendente il modello selezionato.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "Server mostra la stessa biblioteca tabellare di Desktop usando solo i documenti che il proprietario ha scelto di pubblicare.",
    "La publicación es independiente para cada vault.": "La pubblicazione è indipendente per ogni vault.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "PDF, percorsi locali e credenziali sono esclusi, salvo pubblicazione esplicita dei contenuti consentiti.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "L’account Server conserva la vista pubblicata. Connessione, archiviazione e sincronizzazione di Zotero vengono eseguite in Desktop.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Apri Impostazioni → Biblioteca in Desktop per cambiare la fonte Zotero. Server applicherà la pubblicazione successiva a tutti i vault connessi senza creare una biblioteca separata.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Queste impostazioni dipendono da file locali e rimangono in Desktop.",
    "Server consume el texto limpio incluido por el publicador.": "Server utilizza il testo pulito incluso dall’editore.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.": "Tesseract, le lingue e i limiti di pagina vengono eseguiti dove risiede il documento.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "Aspetto e accessibilità fanno parte del profilo portatile e sono condivisi tra i dispositivi.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.": "Collega ChatGPT, Claude e i client compatibili a questo utente e ai vault assegnati.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Sincronizza pubblicazione e profilo portatile da Nodus Desktop.",
    "Los complementos de escritorio conservan su configuración local.": "I componenti aggiuntivi Desktop mantengono la configurazione locale.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.": "Il browser integrato richiede Electron e rimane fuori dalla barra laterale di Server.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Cookie, autorizzazioni, download e archiviazione web non vengono mai copiati sul server. L’estensione e Nodus Browser si configurano in Desktop.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Pubblica un vault, assegna l’accesso e consulta la replica.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Credenziali per utente, modelli preferiti e privacy.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP e client compatibili.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "I backup contengono dati locali, percorsi e segreti che non attraversano mai il profilo portatile. Vengono creati e ripristinati solo in Desktop o tramite la politica di backup dell’operatore Server.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Preferiti, modelli, interfaccia e criteri compatibili.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · pubblicazione esplicita · credenziali isolate",
    "Ayuda sobre {section}": "Aiuto su {section}",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Riepiloga questo server e mostra quanti vault, utenti e dispositivi gestisce, insieme ai relativi indirizzi di accesso.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Crea un vault modificabile che risiede direttamente su Server. Scegli nome, tipo e descrizione iniziale.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Mostra i vault nativi e quelli pubblicati da Desktop. Qui puoi verificarne lo stato, scegliere cosa pubblicare e generare codici di connessione.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Crea account e stabilisce cosa può fare ogni utente in ciascun vault: leggere, scrivere o amministrarlo come proprietario.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Elenca i dispositivi Desktop autorizzati a pubblicare vault su questo server. Puoi revocare un dispositivo che non deve più sincronizzarsi.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Mostra l’account e il ruolo usati per accedere. Consente anche di cambiare la password o terminare la sessione corrente.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "Gli aggiornamenti vengono applicati sull’host Server. Questa vista non simula download o riavvii che il browser non può eseguire.",
  },
  tr: {
    "Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta.":
      "Yapılandırılan anahtarlar ve modeller tüm kasalarınız arasında paylaşılır. Kimlik bilgileri bu hesaba özel kalır.",
    "El operador debe configurar la keyring cifrada del servidor para guardar credenciales.":
      "Kimlik bilgileri kaydedilmeden önce operatör sunucunun şifreli anahtarlığını yapılandırmalıdır.",
    "Abre un proveedor y marca con una estrella los modelos que quieras usar en los selectores.":
      "Bir sağlayıcı açın ve seçicilerde kullanmak istediğiniz modelleri favorilere ekleyin.",
    "Configurado en Server": "Server üzerinde yapılandırıldı",
    "Sin credencial en Server": "Server üzerinde kimlik bilgisi yok",
    "Disponible mediante Desktop": "Desktop üzerinden kullanılabilir",
    Sustituir: "Değiştir",
    Guardar: "Kaydet",
    Eliminar: "Kaldır",
    "Este proveedor requiere el runtime o la red local de Nodus Desktop; sus favoritos se conservan, pero Server no intenta ejecutarlo.":
      "Bu sağlayıcı Nodus Desktop çalışma ortamını veya yerel ağını gerektirir. Favoriler korunur, ancak Server sağlayıcıyı çalıştırmayı denemez.",
    "Actualizando catálogo…": "Katalog yenileniyor…",
    "Catálogo en vivo del proveedor": "Sağlayıcının canlı kataloğu",
    "Catálogo compatible integrado": "Yerleşik uyumlu katalog",
    "Buscar modelo…": "Model ara…",
    "Ningún modelo coincide con la búsqueda.": "Aramayla eşleşen model yok.",
    "Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente.":
      "Temel mod tek bir genel model kullanır; gelişmiş mod her görevi ayrı seçmenizi sağlar.",
    "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.":
      "Bekleyen devralınmış atamalar var ({assignments}). İndirilebilir yerel modeller Server üzerinde çalışmaz ve ücretli bir modelle değiştirilmez.",
    "Un modelo general atiende las tareas de texto compatibles.": "Tek bir genel model uyumlu metin görevlerini yürütür.",
    "Cada tarea usa su modelo seleccionado de forma independiente.": "Her görev seçilen modelini bağımsız olarak kullanır.",
    "Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar.":
      "Server, yalnızca sahibinin yayımlamayı seçtiği belgeleri kullanarak Desktop ile aynı tablo kitaplığını gösterir.",
    "La publicación es independiente para cada vault.": "Yayımlama her kasa için bağımsızdır.",
    "PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido.":
      "İzin verilen içerik açıkça yayımlanmadıkça PDF'ler, yerel yollar ve kimlik bilgileri dahil edilmez.",
    "La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop.":
      "Server hesabı yayımlanan görünümü saklar. Zotero bağlantısı, depolaması ve eşitlemesi Desktop üzerinde çalışır.",
    "Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero. Server aplicará la siguiente publicación a todos los vaults conectados sin inventar una biblioteca distinta.":
      "Zotero kaynağını değiştirmek için Desktop'ta Ayarlar → Kitaplık bölümünü açın. Server ayrı bir kitaplık oluşturmadan sonraki yayını tüm bağlı kasalara uygular.",
    "Estos ajustes dependen de archivos locales y permanecen en Desktop.": "Bu ayarlar yerel dosyalara bağlıdır ve Desktop'ta kalır.",
    "Server consume el texto limpio incluido por el publicador.": "Server, yayımcının eklediği temiz metni kullanır.",
    "Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento.": "Tesseract, diller ve sayfa sınırları belgenin bulunduğu yerde çalışır.",
    "Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente.":
      "Görünüm ve erişilebilirlik taşınabilir profilin parçasıdır ve cihazlar arasında paylaşılır.",
    "Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados.": "ChatGPT, Claude ve uyumlu istemcileri bu kullanıcıya ve atanmış kasalarına bağlar.",
    "Sincroniza publicación y perfil portable desde Nodus Desktop.": "Yayımlamayı ve taşınabilir profili Nodus Desktop'tan eşitler.",
    "Los complementos de escritorio conservan su configuración local.": "Desktop eklentileri yerel yapılandırmalarını korur.",
    "El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server.": "Entegre tarayıcı Electron gerektirir ve Server kenar çubuğunun dışında kalır.",
    "Cookies, permisos, descargas y almacenamiento web nunca se copian al servidor. La extensión y Nodus Browser se configuran en Desktop.":
      "Çerezler, izinler, indirmeler ve web depolaması hiçbir zaman sunucuya kopyalanmaz. Uzantı ve Nodus Browser, Desktop'ta yapılandırılır.",
    "Publicar un vault, asignar acceso y consultar la réplica.": "Bir kasayı yayımlayın, erişim atayın ve kopyayı inceleyin.",
    "Credenciales por usuario, modelos favoritos y privacidad.": "Kullanıcı başına kimlik bilgileri, favori modeller ve gizlilik.",
    "Connected Vault, MCP y clientes compatibles.": "Connected Vault, MCP ve uyumlu istemciler.",
    "Las copias contienen datos locales, rutas y secretos que nunca cruzan el perfil portable. Se crean y restauran exclusivamente en Desktop o mediante la política de copias del operador de Server.":
      "Yedekler, taşınabilir profile asla geçmeyen yerel veriler, yollar ve gizli bilgiler içerir. Yalnızca Desktop'ta veya Server operatörünün yedekleme politikasıyla oluşturulur ve geri yüklenir.",
    "Favoritos, modelos, interfaz y políticas compatibles.": "Favoriler, modeller, arayüz ve uyumlu politikalar.",
    "Local-first · publicación explícita · credenciales aisladas":
      "Local-first · açık yayımlama · yalıtılmış kimlik bilgileri",
    "Ayuda sobre {section}": "{section} yardımı",
    "Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso.":
      "Bu sunucuyu özetler; yönettiği kasa, kullanıcı ve cihaz sayılarını erişim adresleriyle birlikte gösterir.",
    "Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial.":
      "Doğrudan Server üzerinde bulunan düzenlenebilir bir kasa oluşturur. Adını, türünü ve başlangıç açıklamasını seçin.",
    "Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión.":
      "Yerel kasaları ve Desktop’tan yayımlanan kasaları gösterir. Durumlarını inceleyebilir, nelerin yayımlanacağını ayarlayabilir ve bağlantı kodları oluşturabilirsiniz.",
    "Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario.":
      "Hesaplar oluşturur ve her kullanıcının her kasada neler yapabileceğini belirler: okuma, yazma veya sahip olarak yönetme.",
    "Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar.":
      "Bu sunucuda kasa yayımlama yetkisi olan Desktop cihazlarını listeler. Artık eşitleme yapmaması gereken bir cihazın yetkisini kaldırabilirsiniz.",
    "Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual.":
      "Oturum açtığınız hesabı ve rolü gösterir. Parolayı değiştirebilir veya mevcut oturumu kapatabilirsiniz.",
    "Las actualizaciones se aplican en el host de Server. Esta vista no simula descargas ni reinicios que el navegador no puede ejecutar.":
      "Güncellemeler Server ana makinesinde uygulanır. Bu görünüm, tarayıcının gerçekleştiremeyeceği indirmeleri veya yeniden başlatmaları taklit etmez.",
  },
};
