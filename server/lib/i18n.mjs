// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const SERVER_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

const EN = {
  sourceCode: 'Source code',
  language: 'Language', applyLanguage: 'Apply', brandTagline: 'Your shared knowledge, under your control.', brandIntro: 'Publish selected vaults for trusted readers without giving up your local-first workflow.', privateByDesign: 'Only what you explicitly share', oauthProtected: 'Secure OAuth access', serverReady: 'Manage shared spaces, readers and publisher devices from one clear workspace.', moreInformation: 'More information',
  mcpHelp: 'This is the address ChatGPT, Claude and other compatible MCP clients use to consult authorized spaces.', spacesHelp: 'Each space is a read-only published copy of one Nodus vault. Create its connection code from the corresponding row.', usersHelp: 'Reader accounts only see the spaces you assign to them. They cannot edit the original vault.', devicesHelp: 'These are Nodus Desktop installations authorized to publish updates. Revoke any device you no longer recognize.', newSpaceHelp: 'Create one remote destination for each vault you want to share.', newUserHelp: 'Create a reader account and optionally grant its first space.', setupTokenHelp: 'This one-time secret comes from the deployment environment and is used only during initial setup.', publicUrlHelp: 'The public HTTPS address readers and compatible clients will use to reach this server.',
  setupTitle: 'Initial setup', setupHeading: 'Set up Nodus Server', setupIntro: 'Complete this setup before publishing the server on the Internet.', setupToken: 'Setup token', serverName: 'Server name', publicUrl: 'Public URL', adminEmail: 'Administrator email', adminPassword: 'Administrator password', createServer: 'Create server',
  loginTitle: 'Sign in', loginHeading: 'Sign in to Nodus Server', email: 'Email', password: 'Password', signIn: 'Sign in', invalidLogin: 'Incorrect email or password.',
  accountTitle: 'My account', administration: 'Administration', signOut: 'Sign out', changePassword: 'Change password', passwordHelp: 'Use at least 12 characters. Changing it signs out your other sessions and revokes ChatGPT and Claude OAuth connections.', currentPassword: 'Current password', newPassword: 'New password', repeatPassword: 'Repeat the new password',
  resetPassword: 'Reset password', backAdmin: '← Back to administration', resetHelp: 'The account will be signed out on every device and must reconnect ChatGPT or Claude.', temporaryPassword: 'New temporary password',
  mcpUrl: 'MCP URL', newSpace: 'New space', name: 'Name', description: 'Description', createSpace: 'Create space', newUser: 'New user', temporaryPasswordLabel: 'Temporary password', space: 'Space', createReader: 'Create reader account', spaces: 'Spaces', lastPublication: 'Last publication', noSpaces: 'There are no spaces yet.', usersAccess: 'Users and access', mcpReadOnly: 'The current version provides read-only MCP tools. It does not expose grades or remote writing.', account: 'Account', access: 'Access', actions: 'Actions', publisherDevices: 'Publisher devices', device: 'Device', lastUsed: 'Last used', noDevices: 'There are no paired devices.', never: 'Never', unpublished: 'Not published', createPairing: 'Create Nodus code', deletePublication: 'Delete publication', grantReader: 'Grant read access', revokeAccess: 'Revoke access', changeMyPassword: 'Change my password',
  deletePublicationHeading: 'Delete publication', deletePublicationHelp: 'The published copy of {name} will be removed from the server. The local vault is not changed.', deletePermanently: 'Delete permanently', cancel: 'Cancel',
  connectDesktop: 'Connect Nodus Desktop', pairingHelp: 'Enter this code under Settings → Server:', pairingExpiry: 'It expires in 15 minutes and can be used only once.', back: 'Back',
  authorize: 'Authorize', connectClient: 'Connect {name}', appCan: 'The application will be able to:', assignedOnly: 'It will have access only to spaces assigned to {email}.', invalidOauth: 'Invalid OAuth request',
  error: 'Error', sessionExpired: 'The session has expired.', readerNotFound: 'Reader account not found.', spaceNotFound: 'Space not found.', internalError: 'Internal server error.',
};

const ES = {
  sourceCode: 'Código fuente',
  language: 'Idioma', applyLanguage: 'Aplicar', brandTagline: 'Tu conocimiento compartido, bajo tu control.', brandIntro: 'Publica los vaults que elijas para lectores de confianza sin renunciar al funcionamiento local-first.', privateByDesign: 'Solo lo que compartes expresamente', oauthProtected: 'Acceso OAuth seguro', serverReady: 'Gestiona espacios compartidos, lectores y dispositivos publicadores desde un entorno claro.', moreInformation: 'Más información',
  mcpHelp: 'Esta es la dirección que usan ChatGPT, Claude y otros clientes MCP compatibles para consultar los espacios autorizados.', spacesHelp: 'Cada espacio es una copia publicada y de solo lectura de un vault de Nodus. Crea su código de conexión desde la fila correspondiente.', usersHelp: 'Las cuentas lectoras solo ven los espacios que les asignes. No pueden editar el vault original.', devicesHelp: 'Son instalaciones de Nodus Desktop autorizadas para publicar cambios. Revoca cualquier dispositivo que ya no reconozcas.', newSpaceHelp: 'Crea un destino remoto por cada vault que quieras compartir.', newUserHelp: 'Crea una cuenta lectora y, si quieres, concédele su primer espacio.', setupTokenHelp: 'Este secreto de un solo uso procede del entorno de despliegue y solo se utiliza durante la configuración inicial.', publicUrlHelp: 'La dirección HTTPS pública que utilizarán los lectores y clientes compatibles para acceder al servidor.',
  setupTitle: 'Configuración inicial', setupHeading: 'Configurar Nodus Server', setupIntro: 'Haz esta configuración antes de publicar el servidor en Internet.', setupToken: 'Código de instalación', serverName: 'Nombre del servidor', publicUrl: 'URL pública', adminEmail: 'Correo del administrador', adminPassword: 'Contraseña del administrador', createServer: 'Crear servidor',
  loginTitle: 'Entrar', loginHeading: 'Entrar en Nodus Server', email: 'Correo', password: 'Contraseña', signIn: 'Entrar', invalidLogin: 'Correo o contraseña incorrectos.',
  accountTitle: 'Mi cuenta', administration: 'Administración', signOut: 'Salir', changePassword: 'Cambiar contraseña', passwordHelp: 'Debe tener al menos 12 caracteres. Al cambiarla, se cerrarán tus otras sesiones y se revocarán las conexiones OAuth de ChatGPT y Claude.', currentPassword: 'Contraseña actual', newPassword: 'Nueva contraseña', repeatPassword: 'Repite la nueva contraseña',
  resetPassword: 'Restablecer contraseña', backAdmin: '← Volver a la administración', resetHelp: 'La cuenta se cerrará en todos sus dispositivos y tendrá que volver a conectar ChatGPT o Claude.', temporaryPassword: 'Nueva contraseña temporal',
  mcpUrl: 'URL MCP', newSpace: 'Nuevo espacio', name: 'Nombre', description: 'Descripción', createSpace: 'Crear espacio', newUser: 'Nuevo usuario', temporaryPasswordLabel: 'Contraseña temporal', space: 'Espacio', createReader: 'Crear usuario lector', spaces: 'Espacios', lastPublication: 'Última publicación', noSpaces: 'Todavía no hay espacios.', usersAccess: 'Usuarios y acceso', mcpReadOnly: 'La versión actual publica herramientas MCP de consulta. No expone calificaciones ni escritura remota.', account: 'Cuenta', access: 'Acceso', actions: 'Acciones', publisherDevices: 'Dispositivos publicadores', device: 'Dispositivo', lastUsed: 'Último uso', noDevices: 'No hay dispositivos emparejados.', never: 'Nunca', unpublished: 'Sin publicar', createPairing: 'Crear código para Nodus', deletePublication: 'Borrar publicación', grantReader: 'Dar acceso lector', revokeAccess: 'Revocar acceso', changeMyPassword: 'Cambiar mi contraseña',
  deletePublicationHeading: 'Borrar publicación', deletePublicationHelp: 'Se eliminará del servidor la copia publicada de {name}. El vault local no se modifica.', deletePermanently: 'Borrar definitivamente', cancel: 'Cancelar',
  connectDesktop: 'Conectar Nodus Desktop', pairingHelp: 'Introduce este código en Ajustes → Servidor:', pairingExpiry: 'Caduca en 15 minutos y solo puede utilizarse una vez.', back: 'Volver',
  authorize: 'Autorizar', connectClient: 'Conectar {name}', appCan: 'La aplicación podrá:', assignedOnly: 'Solo tendrá acceso a los espacios asignados a {email}.', invalidOauth: 'Solicitud OAuth no válida',
  error: 'Error', sessionExpired: 'La sesión ha caducado.', readerNotFound: 'Cuenta lectora no encontrada.', spaceNotFound: 'Espacio no encontrado.', internalError: 'Error interno del servidor.',
};

const FR = {
  sourceCode: 'Code source',
  language: 'Langue', applyLanguage: 'Appliquer', brandTagline: 'Vos connaissances partagées, sous votre contrôle.', brandIntro: 'Publiez les coffres de votre choix pour des lecteurs de confiance sans renoncer au fonctionnement local-first.', privateByDesign: 'Uniquement ce que vous partagez', oauthProtected: 'Accès OAuth sécurisé', serverReady: 'Gérez les espaces partagés, les lecteurs et les appareils de publication depuis un espace clair.', moreInformation: 'Plus d’informations', mcpHelp: 'Adresse utilisée par ChatGPT, Claude et les autres clients MCP compatibles pour consulter les espaces autorisés.', spacesHelp: 'Chaque espace est une copie publiée en lecture seule d’un coffre Nodus. Créez son code de connexion depuis la ligne correspondante.', usersHelp: 'Les comptes lecteurs ne voient que les espaces qui leur sont attribués. Ils ne peuvent pas modifier le coffre original.', devicesHelp: 'Installations de Nodus Desktop autorisées à publier des mises à jour. Révoquez tout appareil que vous ne reconnaissez plus.', newSpaceHelp: 'Créez une destination distante pour chaque coffre à partager.', newUserHelp: 'Créez un compte lecteur et attribuez-lui éventuellement son premier espace.', setupTokenHelp: 'Ce secret à usage unique provient de l’environnement de déploiement et sert uniquement à la configuration initiale.', publicUrlHelp: 'Adresse HTTPS publique utilisée par les lecteurs et les clients compatibles pour joindre ce serveur.',
  setupTitle: 'Configuration initiale', setupHeading: 'Configurer Nodus Server', setupIntro: 'Terminez cette configuration avant de publier le serveur sur Internet.', setupToken: "Jeton d'installation", serverName: 'Nom du serveur', publicUrl: 'URL publique', adminEmail: "E-mail de l'administrateur", adminPassword: "Mot de passe de l'administrateur", createServer: 'Créer le serveur', loginTitle: 'Connexion', loginHeading: 'Se connecter à Nodus Server', email: 'E-mail', password: 'Mot de passe', signIn: 'Se connecter', invalidLogin: 'E-mail ou mot de passe incorrect.', accountTitle: 'Mon compte', administration: 'Administration', signOut: 'Déconnexion', changePassword: 'Modifier le mot de passe', passwordHelp: 'Utilisez au moins 12 caractères. La modification ferme vos autres sessions et révoque les connexions OAuth de ChatGPT et Claude.', currentPassword: 'Mot de passe actuel', newPassword: 'Nouveau mot de passe', repeatPassword: 'Répéter le nouveau mot de passe', resetPassword: 'Réinitialiser le mot de passe', backAdmin: '← Retour à l’administration', resetHelp: 'Le compte sera déconnecté de tous ses appareils et devra reconnecter ChatGPT ou Claude.', temporaryPassword: 'Nouveau mot de passe temporaire', mcpUrl: 'URL MCP', newSpace: 'Nouvel espace', name: 'Nom', description: 'Description', createSpace: "Créer l'espace", newUser: 'Nouvel utilisateur', temporaryPasswordLabel: 'Mot de passe temporaire', space: 'Espace', createReader: 'Créer un compte lecteur', spaces: 'Espaces', lastPublication: 'Dernière publication', noSpaces: "Il n'y a encore aucun espace.", usersAccess: 'Utilisateurs et accès', mcpReadOnly: "La version actuelle fournit des outils MCP en lecture seule. Elle n’expose ni notes ni écriture à distance.", account: 'Compte', access: 'Accès', actions: 'Actions', publisherDevices: 'Appareils de publication', device: 'Appareil', lastUsed: 'Dernière utilisation', noDevices: "Aucun appareil n'est associé.", never: 'Jamais', unpublished: 'Non publié', createPairing: 'Créer un code Nodus', deletePublication: 'Supprimer la publication', grantReader: "Accorder l'accès en lecture", revokeAccess: 'Révoquer l’accès', changeMyPassword: 'Modifier mon mot de passe', deletePublicationHeading: 'Supprimer la publication', deletePublicationHelp: 'La copie publiée de {name} sera supprimée du serveur. Le coffre local reste inchangé.', deletePermanently: 'Supprimer définitivement', cancel: 'Annuler', authorize: 'Autoriser', connectClient: 'Connecter {name}', appCan: 'L’application pourra :', assignedOnly: 'Elle aura accès uniquement aux espaces attribués à {email}.', invalidOauth: 'Requête OAuth non valide', connectDesktop: 'Connecter Nodus Desktop', pairingHelp: 'Saisissez ce code dans Réglages → Serveur :', pairingExpiry: "Il expire dans 15 minutes et n'est utilisable qu'une fois.", back: 'Retour', error: 'Erreur', sessionExpired: 'La session a expiré.', readerNotFound: 'Compte lecteur introuvable.', spaceNotFound: 'Espace introuvable.', internalError: 'Erreur interne du serveur.',
};

const DE = {
  sourceCode: 'Quellcode',
  language: 'Sprache', applyLanguage: 'Anwenden', brandTagline: 'Geteiltes Wissen, unter Ihrer Kontrolle.', brandIntro: 'Veröffentlichen Sie ausgewählte Tresore für vertrauenswürdige Leser, ohne den Local-first-Ansatz aufzugeben.', privateByDesign: 'Nur ausdrücklich freigegebene Inhalte', oauthProtected: 'Sicherer OAuth-Zugriff', serverReady: 'Verwalten Sie Bereiche, Leser und veröffentlichende Geräte übersichtlich an einem Ort.', moreInformation: 'Weitere Informationen', mcpHelp: 'Diese Adresse verwenden ChatGPT, Claude und andere kompatible MCP-Clients, um autorisierte Bereiche abzufragen.', spacesHelp: 'Jeder Bereich ist eine veröffentlichte, schreibgeschützte Kopie eines Nodus-Tresors. Den Verbindungscode erstellen Sie in der zugehörigen Zeile.', usersHelp: 'Lesekonten sehen nur die ihnen zugewiesenen Bereiche und können den ursprünglichen Tresor nicht bearbeiten.', devicesHelp: 'Diese Nodus-Desktop-Installationen dürfen Aktualisierungen veröffentlichen. Widerrufen Sie unbekannte Geräte.', newSpaceHelp: 'Erstellen Sie für jeden zu teilenden Tresor ein eigenes Remote-Ziel.', newUserHelp: 'Erstellen Sie ein Lesekonto und weisen Sie ihm optional den ersten Bereich zu.', setupTokenHelp: 'Dieses einmalige Geheimnis stammt aus der Bereitstellungsumgebung und wird nur bei der Ersteinrichtung verwendet.', publicUrlHelp: 'Die öffentliche HTTPS-Adresse, über die Leser und kompatible Clients diesen Server erreichen.',
  setupTitle: 'Ersteinrichtung', setupHeading: 'Nodus Server einrichten', setupIntro: 'Schließen Sie die Einrichtung ab, bevor der Server im Internet veröffentlicht wird.', setupToken: 'Einrichtungstoken', serverName: 'Servername', publicUrl: 'Öffentliche URL', adminEmail: 'Administrator-E-Mail', adminPassword: 'Administratorpasswort', createServer: 'Server erstellen', loginTitle: 'Anmelden', loginHeading: 'Bei Nodus Server anmelden', email: 'E-Mail', password: 'Passwort', signIn: 'Anmelden', invalidLogin: 'E-Mail oder Passwort ist falsch.', accountTitle: 'Mein Konto', administration: 'Verwaltung', signOut: 'Abmelden', changePassword: 'Passwort ändern', passwordHelp: 'Verwenden Sie mindestens 12 Zeichen. Eine Änderung beendet andere Sitzungen und widerruft OAuth-Verbindungen von ChatGPT und Claude.', currentPassword: 'Aktuelles Passwort', newPassword: 'Neues Passwort', repeatPassword: 'Neues Passwort wiederholen', resetPassword: 'Passwort zurücksetzen', backAdmin: '← Zurück zur Verwaltung', resetHelp: 'Das Konto wird auf allen Geräten abgemeldet und muss ChatGPT oder Claude neu verbinden.', temporaryPassword: 'Neues temporäres Passwort', mcpUrl: 'MCP-URL', newSpace: 'Neuer Bereich', name: 'Name', description: 'Beschreibung', createSpace: 'Bereich erstellen', newUser: 'Neuer Benutzer', temporaryPasswordLabel: 'Temporäres Passwort', space: 'Bereich', createReader: 'Lesekonto erstellen', spaces: 'Bereiche', lastPublication: 'Letzte Veröffentlichung', noSpaces: 'Es gibt noch keine Bereiche.', usersAccess: 'Benutzer und Zugriff', mcpReadOnly: 'Die aktuelle Version bietet schreibgeschützte MCP-Werkzeuge. Sie stellt weder Noten noch Remote-Schreibzugriff bereit.', account: 'Konto', access: 'Zugriff', actions: 'Aktionen', publisherDevices: 'Veröffentlichende Geräte', device: 'Gerät', lastUsed: 'Zuletzt verwendet', noDevices: 'Keine Geräte gekoppelt.', never: 'Nie', unpublished: 'Nicht veröffentlicht', createPairing: 'Nodus-Code erstellen', deletePublication: 'Veröffentlichung löschen', grantReader: 'Lesezugriff gewähren', revokeAccess: 'Zugriff widerrufen', changeMyPassword: 'Mein Passwort ändern', deletePublicationHeading: 'Veröffentlichung löschen', deletePublicationHelp: 'Die veröffentlichte Kopie von {name} wird vom Server entfernt. Der lokale Tresor bleibt unverändert.', deletePermanently: 'Endgültig löschen', cancel: 'Abbrechen', authorize: 'Autorisieren', connectClient: '{name} verbinden', appCan: 'Die Anwendung darf:', assignedOnly: 'Sie hat nur Zugriff auf Bereiche, die {email} zugewiesen sind.', invalidOauth: 'Ungültige OAuth-Anfrage', connectDesktop: 'Nodus Desktop verbinden', pairingHelp: 'Geben Sie diesen Code unter Einstellungen → Server ein:', pairingExpiry: 'Er läuft in 15 Minuten ab und kann nur einmal verwendet werden.', back: 'Zurück', error: 'Fehler', sessionExpired: 'Die Sitzung ist abgelaufen.', readerNotFound: 'Lesekonto nicht gefunden.', spaceNotFound: 'Bereich nicht gefunden.', internalError: 'Interner Serverfehler.',
};

const PT = {
  sourceCode: 'Código-fonte',
  language: 'Idioma', applyLanguage: 'Aplicar', brandTagline: 'O seu conhecimento partilhado, sob o seu controlo.', brandIntro: 'Publique os cofres escolhidos para leitores de confiança sem abdicar do funcionamento local-first.', privateByDesign: 'Apenas o que partilha explicitamente', oauthProtected: 'Acesso OAuth seguro', serverReady: 'Faça a gestão de espaços partilhados, leitores e dispositivos publicadores num ambiente claro.', moreInformation: 'Mais informações', mcpHelp: 'Este é o endereço utilizado pelo ChatGPT, Claude e outros clientes MCP compatíveis para consultar espaços autorizados.', spacesHelp: 'Cada espaço é uma cópia publicada e apenas de leitura de um cofre Nodus. Crie o código de ligação na respetiva linha.', usersHelp: 'As contas de leitura veem apenas os espaços atribuídos e não podem editar o cofre original.', devicesHelp: 'Estas instalações do Nodus Desktop estão autorizadas a publicar atualizações. Revogue qualquer dispositivo que já não reconheça.', newSpaceHelp: 'Crie um destino remoto para cada cofre que pretenda partilhar.', newUserHelp: 'Crie uma conta de leitura e atribua-lhe opcionalmente o primeiro espaço.', setupTokenHelp: 'Este segredo de utilização única vem do ambiente de implementação e serve apenas para a configuração inicial.', publicUrlHelp: 'O endereço HTTPS público que leitores e clientes compatíveis utilizarão para aceder a este servidor.',
  setupTitle: 'Configuração inicial', setupHeading: 'Configurar o Nodus Server', setupIntro: 'Conclua esta configuração antes de publicar o servidor na Internet.', setupToken: 'Token de configuração', serverName: 'Nome do servidor', publicUrl: 'URL pública', adminEmail: 'E-mail do administrador', adminPassword: 'Palavra-passe do administrador', createServer: 'Criar servidor', loginTitle: 'Iniciar sessão', loginHeading: 'Iniciar sessão no Nodus Server', email: 'E-mail', password: 'Palavra-passe', signIn: 'Iniciar sessão', invalidLogin: 'E-mail ou palavra-passe incorretos.', accountTitle: 'A minha conta', administration: 'Administração', signOut: 'Terminar sessão', changePassword: 'Alterar palavra-passe', passwordHelp: 'Utilize pelo menos 12 caracteres. A alteração termina as outras sessões e revoga as ligações OAuth do ChatGPT e Claude.', currentPassword: 'Palavra-passe atual', newPassword: 'Nova palavra-passe', repeatPassword: 'Repetir a nova palavra-passe', resetPassword: 'Repor palavra-passe', backAdmin: '← Voltar à administração', resetHelp: 'A conta será terminada em todos os dispositivos e terá de voltar a ligar o ChatGPT ou Claude.', temporaryPassword: 'Nova palavra-passe temporária', mcpUrl: 'URL MCP', newSpace: 'Novo espaço', name: 'Nome', description: 'Descrição', createSpace: 'Criar espaço', newUser: 'Novo utilizador', temporaryPasswordLabel: 'Palavra-passe temporária', space: 'Espaço', createReader: 'Criar conta de leitura', spaces: 'Espaços', lastPublication: 'Última publicação', noSpaces: 'Ainda não existem espaços.', usersAccess: 'Utilizadores e acesso', mcpReadOnly: 'A versão atual fornece ferramentas MCP apenas de leitura. Não expõe notas nem escrita remota.', account: 'Conta', access: 'Acesso', actions: 'Ações', publisherDevices: 'Dispositivos publicadores', device: 'Dispositivo', lastUsed: 'Última utilização', noDevices: 'Não existem dispositivos emparelhados.', never: 'Nunca', unpublished: 'Não publicado', createPairing: 'Criar código Nodus', deletePublication: 'Eliminar publicação', grantReader: 'Conceder acesso de leitura', revokeAccess: 'Revogar acesso', changeMyPassword: 'Alterar a minha palavra-passe', deletePublicationHeading: 'Eliminar publicação', deletePublicationHelp: 'A cópia publicada de {name} será removida do servidor. O cofre local não é alterado.', deletePermanently: 'Eliminar definitivamente', cancel: 'Cancelar', authorize: 'Autorizar', connectClient: 'Ligar {name}', appCan: 'A aplicação poderá:', assignedOnly: 'Terá acesso apenas aos espaços atribuídos a {email}.', invalidOauth: 'Pedido OAuth inválido', connectDesktop: 'Ligar Nodus Desktop', pairingHelp: 'Introduza este código em Definições → Servidor:', pairingExpiry: 'Expira em 15 minutos e só pode ser utilizado uma vez.', back: 'Voltar', error: 'Erro', sessionExpired: 'A sessão expirou.', readerNotFound: 'Conta de leitura não encontrada.', spaceNotFound: 'Espaço não encontrado.', internalError: 'Erro interno do servidor.',
};

const PT_BR = {
  ...PT, adminPassword: 'Senha do administrador', password: 'Senha', accountTitle: 'Minha conta', signOut: 'Sair', changePassword: 'Alterar senha', currentPassword: 'Senha atual', newPassword: 'Nova senha', repeatPassword: 'Repita a nova senha', resetPassword: 'Redefinir senha', newUser: 'Novo usuário', usersAccess: 'Usuários e acesso', lastUsed: 'Último uso', pairingHelp: 'Digite este código em Configurações → Servidor:',
};

const IT = {
  sourceCode: 'Codice sorgente',
  language: 'Lingua', applyLanguage: 'Applica', brandTagline: 'La conoscenza condivisa, sotto il tuo controllo.', brandIntro: 'Pubblica i vault scelti per lettori fidati senza rinunciare al flusso local-first.', privateByDesign: 'Solo ciò che condividi esplicitamente', oauthProtected: 'Accesso OAuth sicuro', serverReady: 'Gestisci spazi condivisi, lettori e dispositivi di pubblicazione da un ambiente chiaro.', moreInformation: 'Maggiori informazioni', mcpHelp: 'Questo è l’indirizzo usato da ChatGPT, Claude e altri client MCP compatibili per consultare gli spazi autorizzati.', spacesHelp: 'Ogni spazio è una copia pubblicata e di sola lettura di un vault Nodus. Crea il codice di connessione dalla riga corrispondente.', usersHelp: 'Gli account lettore vedono solo gli spazi assegnati e non possono modificare il vault originale.', devicesHelp: 'Sono installazioni di Nodus Desktop autorizzate a pubblicare aggiornamenti. Revoca i dispositivi che non riconosci più.', newSpaceHelp: 'Crea una destinazione remota per ogni vault che vuoi condividere.', newUserHelp: 'Crea un account lettore e assegnagli facoltativamente il primo spazio.', setupTokenHelp: 'Questo segreto monouso proviene dall’ambiente di distribuzione e serve solo durante la configurazione iniziale.', publicUrlHelp: 'L’indirizzo HTTPS pubblico usato da lettori e client compatibili per raggiungere il server.',
  setupTitle: 'Configurazione iniziale', setupHeading: 'Configura Nodus Server', setupIntro: 'Completa la configurazione prima di pubblicare il server su Internet.', setupToken: 'Token di configurazione', serverName: 'Nome del server', publicUrl: 'URL pubblico', adminEmail: "E-mail dell'amministratore", adminPassword: "Password dell'amministratore", createServer: 'Crea server', loginTitle: 'Accedi', loginHeading: 'Accedi a Nodus Server', email: 'E-mail', password: 'Password', signIn: 'Accedi', invalidLogin: 'E-mail o password non corretti.', accountTitle: 'Il mio account', administration: 'Amministrazione', signOut: 'Esci', changePassword: 'Cambia password', passwordHelp: 'Usa almeno 12 caratteri. La modifica chiude le altre sessioni e revoca le connessioni OAuth di ChatGPT e Claude.', currentPassword: 'Password attuale', newPassword: 'Nuova password', repeatPassword: 'Ripeti la nuova password', resetPassword: 'Reimposta password', backAdmin: '← Torna all’amministrazione', resetHelp: 'L’account verrà disconnesso da tutti i dispositivi e dovrà riconnettere ChatGPT o Claude.', temporaryPassword: 'Nuova password temporanea', mcpUrl: 'URL MCP', newSpace: 'Nuovo spazio', name: 'Nome', description: 'Descrizione', createSpace: 'Crea spazio', newUser: 'Nuovo utente', temporaryPasswordLabel: 'Password temporanea', space: 'Spazio', createReader: 'Crea account lettore', spaces: 'Spazi', lastPublication: 'Ultima pubblicazione', noSpaces: 'Non ci sono ancora spazi.', usersAccess: 'Utenti e accesso', mcpReadOnly: 'La versione attuale fornisce strumenti MCP in sola lettura. Non espone voti né scrittura remota.', account: 'Account', access: 'Accesso', actions: 'Azioni', publisherDevices: 'Dispositivi di pubblicazione', device: 'Dispositivo', lastUsed: 'Ultimo utilizzo', noDevices: 'Nessun dispositivo associato.', never: 'Mai', unpublished: 'Non pubblicato', createPairing: 'Crea codice Nodus', deletePublication: 'Elimina pubblicazione', grantReader: 'Concedi accesso in lettura', revokeAccess: 'Revoca accesso', changeMyPassword: 'Cambia la mia password', deletePublicationHeading: 'Elimina pubblicazione', deletePublicationHelp: 'La copia pubblicata di {name} verrà rimossa dal server. Il vault locale non viene modificato.', deletePermanently: 'Elimina definitivamente', cancel: 'Annulla', authorize: 'Autorizza', connectClient: 'Connetti {name}', appCan: 'L’applicazione potrà:', assignedOnly: 'Avrà accesso solo agli spazi assegnati a {email}.', invalidOauth: 'Richiesta OAuth non valida', connectDesktop: 'Connetti Nodus Desktop', pairingHelp: 'Inserisci questo codice in Impostazioni → Server:', pairingExpiry: 'Scade tra 15 minuti e può essere utilizzato una sola volta.', back: 'Indietro', error: 'Errore', sessionExpired: 'La sessione è scaduta.', readerNotFound: 'Account lettore non trovato.', spaceNotFound: 'Spazio non trovato.', internalError: 'Errore interno del server.',
};

const TR = {
  sourceCode: 'Kaynak kodu',
  language: 'Dil', applyLanguage: 'Uygula', brandTagline: 'Paylaşılan bilginiz, sizin kontrolünüzde.', brandIntro: 'Local-first çalışma biçiminden vazgeçmeden seçtiğiniz kasaları güvendiğiniz okuyuculara yayınlayın.', privateByDesign: 'Yalnızca açıkça paylaştıklarınız', oauthProtected: 'Güvenli OAuth erişimi', serverReady: 'Paylaşılan alanları, okuyucuları ve yayıncı cihazları anlaşılır tek bir ortamdan yönetin.', moreInformation: 'Daha fazla bilgi',
  mcpHelp: 'ChatGPT, Claude ve diğer uyumlu MCP istemcileri yetkili alanları bu adres üzerinden sorgular.', spacesHelp: 'Her alan, bir Nodus kasasının yayınlanmış salt okunur kopyasıdır. Bağlantı kodunu ilgili satırdan oluşturun.', usersHelp: 'Okuyucu hesapları yalnızca atadığınız alanları görür ve özgün kasayı düzenleyemez.', devicesHelp: 'Bunlar güncelleme yayınlamaya yetkili Nodus Desktop kurulumlarıdır. Artık tanımadığınız cihazların yetkisini kaldırın.', newSpaceHelp: 'Paylaşmak istediğiniz her kasa için bir uzak hedef oluşturun.', newUserHelp: 'Bir okuyucu hesabı oluşturun ve isterseniz ilk alanını atayın.', setupTokenHelp: 'Bu tek kullanımlık gizli bilgi dağıtım ortamından gelir ve yalnızca ilk kurulumda kullanılır.', publicUrlHelp: 'Okuyucuların ve uyumlu istemcilerin bu sunucuya ulaşmak için kullanacağı genel HTTPS adresi.',
  setupTitle: 'İlk kurulum', setupHeading: 'Nodus Server kurulumu', setupIntro: 'Sunucuyu internette yayınlamadan önce bu kurulumu tamamlayın.', setupToken: 'Kurulum belirteci', serverName: 'Sunucu adı', publicUrl: 'Genel URL', adminEmail: 'Yönetici e-postası', adminPassword: 'Yönetici parolası', createServer: 'Sunucu oluştur',
  loginTitle: 'Oturum aç', loginHeading: 'Nodus Server’da oturum aç', email: 'E-posta', password: 'Parola', signIn: 'Oturum aç', invalidLogin: 'E-posta veya parola yanlış.',
  accountTitle: 'Hesabım', administration: 'Yönetim', signOut: 'Oturumu kapat', changePassword: 'Parolayı değiştir', passwordHelp: 'En az 12 karakter kullanın. Parolanın değiştirilmesi diğer oturumlarınızı kapatır ve ChatGPT ile Claude OAuth bağlantılarını iptal eder.', currentPassword: 'Mevcut parola', newPassword: 'Yeni parola', repeatPassword: 'Yeni parolayı tekrarlayın',
  resetPassword: 'Parolayı sıfırla', backAdmin: '← Yönetime dön', resetHelp: 'Hesabın tüm cihazlardaki oturumları kapatılacak ve ChatGPT veya Claude yeniden bağlanmalıdır.', temporaryPassword: 'Yeni geçici parola',
  mcpUrl: 'MCP URL’si', newSpace: 'Yeni alan', name: 'Ad', description: 'Açıklama', createSpace: 'Alan oluştur', newUser: 'Yeni kullanıcı', temporaryPasswordLabel: 'Geçici parola', space: 'Alan', createReader: 'Okuyucu hesabı oluştur', spaces: 'Alanlar', lastPublication: 'Son yayın', noSpaces: 'Henüz alan yok.', usersAccess: 'Kullanıcılar ve erişim', mcpReadOnly: 'Mevcut sürüm salt okunur MCP araçları sağlar. Notları veya uzaktan yazma erişimini kullanıma açmaz.', account: 'Hesap', access: 'Erişim', actions: 'Eylemler', publisherDevices: 'Yayıncı cihazlar', device: 'Cihaz', lastUsed: 'Son kullanım', noDevices: 'Eşleştirilmiş cihaz yok.', never: 'Hiçbir zaman', unpublished: 'Yayınlanmadı', createPairing: 'Nodus kodu oluştur', deletePublication: 'Yayını sil', grantReader: 'Okuma erişimi ver', revokeAccess: 'Erişimi kaldır', changeMyPassword: 'Parolamı değiştir',
  deletePublicationHeading: 'Yayını sil', deletePublicationHelp: '{name} alanının yayınlanan kopyası sunucudan kaldırılacak. Yerel kasa değiştirilmeyecek.', deletePermanently: 'Kalıcı olarak sil', cancel: 'İptal',
  connectDesktop: 'Nodus Desktop’ı bağla', pairingHelp: 'Bu kodu Ayarlar → Sunucu bölümüne girin:', pairingExpiry: 'Kod 15 dakika içinde sona erer ve yalnızca bir kez kullanılabilir.', back: 'Geri',
  authorize: 'Yetkilendir', connectClient: '{name} uygulamasını bağla', appCan: 'Uygulama şunları yapabilecektir:', assignedOnly: 'Yalnızca {email} kullanıcısına atanan alanlara erişebilecektir.', invalidOauth: 'Geçersiz OAuth isteği',
  error: 'Hata', sessionExpired: 'Oturumun süresi doldu.', readerNotFound: 'Okuyucu hesabı bulunamadı.', spaceNotFound: 'Alan bulunamadı.', internalError: 'Sunucu iç hatası.',
};

// Added when space membership stopped being a yes/no and became reader | writer | owner.
// The administration screen now has to say what an account may DO in a space, not only
// which spaces it can see, and a user can be given several spaces at once with a different
// level in each. Kept in its own block so the older tables stay diff-legible.
const ROLE_KEYS = {
  en: {
    accessLevel: 'Access level', roleReader: 'Reader', roleWriter: 'Writer', roleOwner: 'Owner',
    roleReaderHelp: 'Reads the published copy. Whatever they write or generate stays on their own device.',
    roleWriterHelp: 'Reads, and their notes and reports travel back to the main vault when its owner connects.',
    roleOwnerHelp: 'Publishes this space and collects what writers send to it.',
    spacesAndRoles: 'Spaces and access level',
    newUserSpacesHelp: 'Tick every space this account should reach and choose what it may do in each one.',
    createUser: 'Create account', grantAccess: 'Grant access', updateRole: 'Update', noSpacesYet: 'Create a space first.',
  },
  es: {
    accessLevel: 'Nivel de acceso', roleReader: 'Lectura', roleWriter: 'Escritura', roleOwner: 'Propietario',
    roleReaderHelp: 'Consulta la copia publicada. Todo lo que escriba o genere se queda en su propio equipo.',
    roleWriterHelp: 'Consulta, y sus notas e informes viajan al vault principal cuando su propietario se conecta.',
    roleOwnerHelp: 'Publica este espacio y recoge lo que le envían quienes tienen escritura.',
    spacesAndRoles: 'Espacios y nivel de acceso',
    newUserSpacesHelp: 'Marca los espacios a los que llegará esta cuenta y elige qué puede hacer en cada uno.',
    createUser: 'Crear cuenta', grantAccess: 'Dar acceso', updateRole: 'Actualizar', noSpacesYet: 'Crea antes un espacio.',
  },
  fr: {
    accessLevel: 'Niveau d’accès', roleReader: 'Lecture', roleWriter: 'Écriture', roleOwner: 'Propriétaire',
    roleReaderHelp: 'Consulte la copie publiée. Tout ce qu’il écrit ou génère reste sur son propre appareil.',
    roleWriterHelp: 'Consulte, et ses notes et rapports remontent vers le coffre principal quand son propriétaire se connecte.',
    roleOwnerHelp: 'Publie cet espace et récupère ce que lui envoient les comptes en écriture.',
    spacesAndRoles: 'Espaces et niveau d’accès',
    newUserSpacesHelp: 'Cochez les espaces accessibles à ce compte et choisissez ce qu’il peut y faire.',
    createUser: 'Créer le compte', grantAccess: 'Accorder l’accès', updateRole: 'Mettre à jour', noSpacesYet: 'Créez d’abord un espace.',
  },
  de: {
    accessLevel: 'Zugriffsstufe', roleReader: 'Lesen', roleWriter: 'Schreiben', roleOwner: 'Eigentümer',
    roleReaderHelp: 'Liest die veröffentlichte Kopie. Alles Geschriebene oder Erzeugte bleibt auf dem eigenen Gerät.',
    roleWriterHelp: 'Liest, und Notizen sowie Berichte gelangen zurück in den Haupttresor, sobald dessen Eigentümer sich verbindet.',
    roleOwnerHelp: 'Veröffentlicht diesen Bereich und holt ab, was Schreibberechtigte senden.',
    spacesAndRoles: 'Bereiche und Zugriffsstufe',
    newUserSpacesHelp: 'Wählen Sie jeden Bereich für dieses Konto aus und legen Sie fest, was es dort darf.',
    createUser: 'Konto erstellen', grantAccess: 'Zugriff gewähren', updateRole: 'Aktualisieren', noSpacesYet: 'Erstellen Sie zuerst einen Bereich.',
  },
  pt: {
    accessLevel: 'Nível de acesso', roleReader: 'Leitura', roleWriter: 'Escrita', roleOwner: 'Proprietário',
    roleReaderHelp: 'Consulta a cópia publicada. Tudo o que escrever ou gerar fica no seu próprio dispositivo.',
    roleWriterHelp: 'Consulta, e as suas notas e relatórios voltam ao cofre principal quando o proprietário se liga.',
    roleOwnerHelp: 'Publica este espaço e recolhe o que lhe enviam as contas com escrita.',
    spacesAndRoles: 'Espaços e nível de acesso',
    newUserSpacesHelp: 'Assinale os espaços a que esta conta terá acesso e escolha o que pode fazer em cada um.',
    createUser: 'Criar conta', grantAccess: 'Conceder acesso', updateRole: 'Atualizar', noSpacesYet: 'Crie primeiro um espaço.',
  },
  it: {
    accessLevel: 'Livello di accesso', roleReader: 'Lettura', roleWriter: 'Scrittura', roleOwner: 'Proprietario',
    roleReaderHelp: 'Consulta la copia pubblicata. Tutto ciò che scrive o genera resta sul suo dispositivo.',
    roleWriterHelp: 'Consulta, e le sue note e relazioni tornano al vault principale quando il proprietario si connette.',
    roleOwnerHelp: 'Pubblica questo spazio e raccoglie ciò che inviano gli account in scrittura.',
    spacesAndRoles: 'Spazi e livello di accesso',
    newUserSpacesHelp: 'Seleziona gli spazi a cui questo account potrà accedere e scegli cosa può farvi.',
    createUser: 'Crea account', grantAccess: 'Concedi accesso', updateRole: 'Aggiorna', noSpacesYet: 'Crea prima uno spazio.',
  },
  tr: {
    accessLevel: 'Erişim düzeyi', roleReader: 'Okuma', roleWriter: 'Yazma', roleOwner: 'Sahip',
    roleReaderHelp: 'Yayınlanan kopyayı okur. Yazdığı veya ürettiği her şey kendi cihazında kalır.',
    roleWriterHelp: 'Okur; notları ve raporları, sahibi bağlandığında ana kasaya geri gider.',
    roleOwnerHelp: 'Bu alanı yayınlar ve yazma yetkisi olanların gönderdiklerini toplar.',
    spacesAndRoles: 'Alanlar ve erişim düzeyi',
    newUserSpacesHelp: 'Bu hesabın erişeceği alanları işaretleyin ve her birinde ne yapabileceğini seçin.',
    createUser: 'Hesap oluştur', grantAccess: 'Erişim ver', updateRole: 'Güncelle', noSpacesYet: 'Önce bir alan oluşturun.',
  },
};
ROLE_KEYS['pt-BR'] = { ...ROLE_KEYS.pt, createUser: 'Criar conta', newUserSpacesHelp: 'Marque os espaços que esta conta poderá acessar e escolha o que pode fazer em cada um.' };

const SERVER_UI_KEYS = {
  en: { serverUrl: 'Server URL', copyUrl: 'Copy URL', urlCopied: 'Copied' },
  es: { serverUrl: 'URL del servidor', copyUrl: 'Copiar URL', urlCopied: 'Copiada' },
  fr: { serverUrl: 'URL du serveur', copyUrl: 'Copier l’URL', urlCopied: 'Copiée' },
  de: { serverUrl: 'Server-URL', copyUrl: 'URL kopieren', urlCopied: 'Kopiert' },
  pt: { serverUrl: 'URL do servidor', copyUrl: 'Copiar URL', urlCopied: 'Copiado' },
  'pt-BR': { serverUrl: 'URL do servidor', copyUrl: 'Copiar URL', urlCopied: 'Copiado' },
  it: { serverUrl: 'URL del server', copyUrl: 'Copia URL', urlCopied: 'Copiato' },
  tr: { serverUrl: 'Sunucu URL’si', copyUrl: 'URL’yi kopyala', urlCopied: 'Kopyalandı' },
};

const ADMIN_UI_KEYS = {
  en: {
    vaultType: 'Vault type', vaultTypePending: 'Type pending', assignedVaults: 'Vault access',
    manageAccessHelp: 'Select every vault this account can access and set its permission independently.',
    saveAccess: 'Save access', lockedOwner: 'Required owner', editSpaceName: 'Edit name', saveName: 'Save name',
    copySpaceId: 'Copy space ID', spaceIdCopied: 'ID copied', administrator: 'Administrator', memberAccount: 'User',
  },
  es: {
    vaultType: 'Tipo de vault', vaultTypePending: 'Tipo pendiente', assignedVaults: 'Acceso a vaults',
    manageAccessHelp: 'Selecciona todos los vaults a los que puede acceder esta cuenta y define cada permiso por separado.',
    saveAccess: 'Guardar accesos', lockedOwner: 'Propietario necesario', editSpaceName: 'Editar nombre', saveName: 'Guardar nombre',
    copySpaceId: 'Copiar ID del espacio', spaceIdCopied: 'ID copiado', administrator: 'Administrador', memberAccount: 'Usuario',
  },
  fr: {
    vaultType: 'Type de coffre', vaultTypePending: 'Type en attente', assignedVaults: 'Accès aux coffres',
    manageAccessHelp: 'Sélectionnez tous les coffres accessibles à ce compte et définissez chaque autorisation séparément.',
    saveAccess: 'Enregistrer les accès', lockedOwner: 'Propriétaire requis', editSpaceName: 'Modifier le nom', saveName: 'Enregistrer le nom',
    copySpaceId: 'Copier l’ID de l’espace', spaceIdCopied: 'ID copié', administrator: 'Administrateur', memberAccount: 'Utilisateur',
  },
  de: {
    vaultType: 'Tresortyp', vaultTypePending: 'Typ ausstehend', assignedVaults: 'Tresorzugriff',
    manageAccessHelp: 'Wählen Sie alle Tresore für dieses Konto aus und legen Sie jede Berechtigung einzeln fest.',
    saveAccess: 'Zugriffe speichern', lockedOwner: 'Erforderlicher Eigentümer', editSpaceName: 'Namen bearbeiten', saveName: 'Namen speichern',
    copySpaceId: 'Bereichs-ID kopieren', spaceIdCopied: 'ID kopiert', administrator: 'Administrator', memberAccount: 'Benutzer',
  },
  pt: {
    vaultType: 'Tipo de cofre', vaultTypePending: 'Tipo pendente', assignedVaults: 'Acesso aos cofres',
    manageAccessHelp: 'Selecione todos os cofres acessíveis a esta conta e defina cada permissão separadamente.',
    saveAccess: 'Guardar acessos', lockedOwner: 'Proprietário necessário', editSpaceName: 'Editar nome', saveName: 'Guardar nome',
    copySpaceId: 'Copiar ID do espaço', spaceIdCopied: 'ID copiado', administrator: 'Administrador', memberAccount: 'Utilizador',
  },
  'pt-BR': {
    vaultType: 'Tipo de cofre', vaultTypePending: 'Tipo pendente', assignedVaults: 'Acesso aos cofres',
    manageAccessHelp: 'Selecione todos os cofres acessíveis a esta conta e defina cada permissão separadamente.',
    saveAccess: 'Salvar acessos', lockedOwner: 'Proprietário necessário', editSpaceName: 'Editar nome', saveName: 'Salvar nome',
    copySpaceId: 'Copiar ID do espaço', spaceIdCopied: 'ID copiado', administrator: 'Administrador', memberAccount: 'Usuário',
  },
  it: {
    vaultType: 'Tipo di vault', vaultTypePending: 'Tipo in attesa', assignedVaults: 'Accesso ai vault',
    manageAccessHelp: 'Seleziona tutti i vault accessibili a questo account e imposta ogni autorizzazione separatamente.',
    saveAccess: 'Salva accessi', lockedOwner: 'Proprietario necessario', editSpaceName: 'Modifica nome', saveName: 'Salva nome',
    copySpaceId: 'Copia ID dello spazio', spaceIdCopied: 'ID copiato', administrator: 'Amministratore', memberAccount: 'Utente',
  },
  tr: {
    vaultType: 'Kasa türü', vaultTypePending: 'Tür bekleniyor', assignedVaults: 'Kasa erişimi',
    manageAccessHelp: 'Bu hesabın erişebileceği tüm kasaları seçin ve her izni ayrı ayrı ayarlayın.',
    saveAccess: 'Erişimleri kaydet', lockedOwner: 'Gerekli sahip', editSpaceName: 'Adı düzenle', saveName: 'Adı kaydet',
    copySpaceId: 'Alan kimliğini kopyala', spaceIdCopied: 'Kimlik kopyalandı', administrator: 'Yönetici', memberAccount: 'Kullanıcı',
  },
};

const VAULT_TYPE_KEYS = {
  en: { vaultTypeAcademic: 'Academic', vaultTypePrimarySources: 'Primary sources', vaultTypeGenealogy: 'Genealogy', vaultTypeDatabases: 'Databases', vaultTypeStudy: 'Study', vaultTypeTeaching: 'Teaching', vaultTypeTestimonies: 'Testimonies', vaultTypeProsopography: 'Prosopography', vaultTypeWorldbuilding: 'Worldbuilding' },
  es: { vaultTypeAcademic: 'Académico', vaultTypePrimarySources: 'Fuentes primarias', vaultTypeGenealogy: 'Genealogía', vaultTypeDatabases: 'Bases de datos', vaultTypeStudy: 'Estudio', vaultTypeTeaching: 'Docencia', vaultTypeTestimonies: 'Testimonios', vaultTypeProsopography: 'Prosopografía', vaultTypeWorldbuilding: 'Construcción de mundos' },
  fr: { vaultTypeAcademic: 'Académique', vaultTypePrimarySources: 'Sources primaires', vaultTypeGenealogy: 'Généalogie', vaultTypeDatabases: 'Bases de données', vaultTypeStudy: 'Étude', vaultTypeTeaching: 'Enseignement', vaultTypeTestimonies: 'Témoignages', vaultTypeProsopography: 'Prosopographie', vaultTypeWorldbuilding: 'Création d’univers' },
  de: { vaultTypeAcademic: 'Akademisch', vaultTypePrimarySources: 'Primärquellen', vaultTypeGenealogy: 'Genealogie', vaultTypeDatabases: 'Datenbanken', vaultTypeStudy: 'Studium', vaultTypeTeaching: 'Lehre', vaultTypeTestimonies: 'Zeitzeugnisse', vaultTypeProsopography: 'Prosopographie', vaultTypeWorldbuilding: 'Weltenbau' },
  pt: { vaultTypeAcademic: 'Académico', vaultTypePrimarySources: 'Fontes primárias', vaultTypeGenealogy: 'Genealogia', vaultTypeDatabases: 'Bases de dados', vaultTypeStudy: 'Estudo', vaultTypeTeaching: 'Ensino', vaultTypeTestimonies: 'Testemunhos', vaultTypeProsopography: 'Prosopografia', vaultTypeWorldbuilding: 'Construção de mundos' },
  'pt-BR': { vaultTypeAcademic: 'Acadêmico', vaultTypePrimarySources: 'Fontes primárias', vaultTypeGenealogy: 'Genealogia', vaultTypeDatabases: 'Bancos de dados', vaultTypeStudy: 'Estudo', vaultTypeTeaching: 'Ensino', vaultTypeTestimonies: 'Testemunhos', vaultTypeProsopography: 'Prosopografia', vaultTypeWorldbuilding: 'Construção de mundos' },
  it: { vaultTypeAcademic: 'Accademico', vaultTypePrimarySources: 'Fonti primarie', vaultTypeGenealogy: 'Genealogia', vaultTypeDatabases: 'Banche dati', vaultTypeStudy: 'Studio', vaultTypeTeaching: 'Didattica', vaultTypeTestimonies: 'Testimonianze', vaultTypeProsopography: 'Prosopografia', vaultTypeWorldbuilding: 'Creazione di mondi' },
  tr: { vaultTypeAcademic: 'Akademik', vaultTypePrimarySources: 'Birincil kaynaklar', vaultTypeGenealogy: 'Şecere', vaultTypeDatabases: 'Veritabanları', vaultTypeStudy: 'Çalışma', vaultTypeTeaching: 'Öğretim', vaultTypeTestimonies: 'Tanıklıklar', vaultTypeProsopography: 'Prosopografi', vaultTypeWorldbuilding: 'Dünya inşası' },
};

const EMAIL_ADMIN_KEYS = {
  en: { unlockEmails: 'Reveal and edit email addresses', unlockEmailsHelp: 'For privacy, addresses are hidden until you confirm your administrator password.', unlockForFiveMinutes: 'Unlock for 5 minutes', emailAccessUnlocked: 'Email addresses are visible in this session for five minutes.', emailUnlockFailed: 'The administrator password is incorrect.', emailAccessExpired: 'Email access has expired. Confirm your password again.', saveEmail: 'Save email', emailUpdated: 'Email updated. Every session and connected device for that account was revoked.', emailUnchanged: 'The email address did not change.', emailUpdatedSignIn: 'Email updated. Sign in again with the new address.', environmentEmailReadonly: 'Managed by NODUS_ADMIN_EMAIL and cannot be edited here.' },
  es: { unlockEmails: 'Ver y editar correos', unlockEmailsHelp: 'Por privacidad, las direcciones permanecen ocultas hasta confirmar tu contraseña de administrador.', unlockForFiveMinutes: 'Desbloquear 5 minutos', emailAccessUnlocked: 'Los correos serán visibles durante cinco minutos en esta sesión.', emailUnlockFailed: 'La contraseña de administrador es incorrecta.', emailAccessExpired: 'El acceso a los correos ha caducado. Confirma de nuevo tu contraseña.', saveEmail: 'Guardar correo', emailUpdated: 'Correo actualizado. Se han revocado todas las sesiones y dispositivos conectados de esa cuenta.', emailUnchanged: 'El correo no ha cambiado.', emailUpdatedSignIn: 'Correo actualizado. Inicia sesión de nuevo con la nueva dirección.', environmentEmailReadonly: 'Lo gestiona NODUS_ADMIN_EMAIL y no puede editarse aquí.' },
  fr: { unlockEmails: 'Afficher et modifier les e-mails', unlockEmailsHelp: 'Pour protéger la vie privée, les adresses restent masquées jusqu’à confirmation du mot de passe administrateur.', unlockForFiveMinutes: 'Déverrouiller 5 minutes', emailAccessUnlocked: 'Les e-mails sont visibles pendant cinq minutes dans cette session.', emailUnlockFailed: 'Le mot de passe administrateur est incorrect.', emailAccessExpired: 'L’accès aux e-mails a expiré. Confirmez à nouveau votre mot de passe.', saveEmail: 'Enregistrer l’e-mail', emailUpdated: 'E-mail modifié. Toutes les sessions et tous les appareils de ce compte ont été révoqués.', emailUnchanged: 'L’e-mail n’a pas changé.', emailUpdatedSignIn: 'E-mail modifié. Reconnectez-vous avec la nouvelle adresse.', environmentEmailReadonly: 'Géré par NODUS_ADMIN_EMAIL et non modifiable ici.' },
  de: { unlockEmails: 'E-Mail-Adressen anzeigen und bearbeiten', unlockEmailsHelp: 'Zum Schutz der Privatsphäre bleiben Adressen verborgen, bis Sie Ihr Administratorpasswort bestätigen.', unlockForFiveMinutes: 'Für 5 Minuten entsperren', emailAccessUnlocked: 'E-Mail-Adressen sind in dieser Sitzung fünf Minuten sichtbar.', emailUnlockFailed: 'Das Administratorpasswort ist falsch.', emailAccessExpired: 'Der E-Mail-Zugriff ist abgelaufen. Bestätigen Sie Ihr Passwort erneut.', saveEmail: 'E-Mail speichern', emailUpdated: 'E-Mail aktualisiert. Alle Sitzungen und verbundenen Geräte dieses Kontos wurden widerrufen.', emailUnchanged: 'Die E-Mail-Adresse wurde nicht geändert.', emailUpdatedSignIn: 'E-Mail aktualisiert. Melden Sie sich mit der neuen Adresse erneut an.', environmentEmailReadonly: 'Wird über NODUS_ADMIN_EMAIL verwaltet und kann hier nicht bearbeitet werden.' },
  pt: { unlockEmails: 'Ver e editar e-mails', unlockEmailsHelp: 'Por privacidade, os endereços ficam ocultos até confirmar a palavra-passe de administrador.', unlockForFiveMinutes: 'Desbloquear por 5 minutos', emailAccessUnlocked: 'Os e-mails ficam visíveis durante cinco minutos nesta sessão.', emailUnlockFailed: 'A palavra-passe de administrador está incorreta.', emailAccessExpired: 'O acesso aos e-mails expirou. Confirme novamente a palavra-passe.', saveEmail: 'Guardar e-mail', emailUpdated: 'E-mail atualizado. Todas as sessões e dispositivos ligados dessa conta foram revogados.', emailUnchanged: 'O e-mail não foi alterado.', emailUpdatedSignIn: 'E-mail atualizado. Inicie sessão novamente com o novo endereço.', environmentEmailReadonly: 'Gerido por NODUS_ADMIN_EMAIL e não pode ser editado aqui.' },
  'pt-BR': { unlockEmails: 'Ver e editar e-mails', unlockEmailsHelp: 'Por privacidade, os endereços ficam ocultos até confirmar a senha de administrador.', unlockForFiveMinutes: 'Desbloquear por 5 minutos', emailAccessUnlocked: 'Os e-mails ficam visíveis durante cinco minutos nesta sessão.', emailUnlockFailed: 'A senha de administrador está incorreta.', emailAccessExpired: 'O acesso aos e-mails expirou. Confirme novamente a senha.', saveEmail: 'Salvar e-mail', emailUpdated: 'E-mail atualizado. Todas as sessões e dispositivos conectados dessa conta foram revogados.', emailUnchanged: 'O e-mail não foi alterado.', emailUpdatedSignIn: 'E-mail atualizado. Entre novamente com o novo endereço.', environmentEmailReadonly: 'Gerenciado por NODUS_ADMIN_EMAIL e não pode ser editado aqui.' },
  it: { unlockEmails: 'Mostra e modifica gli indirizzi e-mail', unlockEmailsHelp: 'Per la privacy, gli indirizzi restano nascosti finché non confermi la password di amministratore.', unlockForFiveMinutes: 'Sblocca per 5 minuti', emailAccessUnlocked: 'Gli indirizzi e-mail sono visibili per cinque minuti in questa sessione.', emailUnlockFailed: 'La password di amministratore non è corretta.', emailAccessExpired: 'L’accesso alle e-mail è scaduto. Conferma di nuovo la password.', saveEmail: 'Salva e-mail', emailUpdated: 'E-mail aggiornata. Tutte le sessioni e i dispositivi connessi dell’account sono stati revocati.', emailUnchanged: 'L’indirizzo e-mail non è cambiato.', emailUpdatedSignIn: 'E-mail aggiornata. Accedi di nuovo con il nuovo indirizzo.', environmentEmailReadonly: 'Gestita da NODUS_ADMIN_EMAIL e non modificabile qui.' },
  tr: { unlockEmails: 'E-posta adreslerini göster ve düzenle', unlockEmailsHelp: 'Gizlilik için adresler, yönetici parolanızı doğrulayana kadar gizli kalır.', unlockForFiveMinutes: '5 dakikalığına aç', emailAccessUnlocked: 'E-posta adresleri bu oturumda beş dakika görünür.', emailUnlockFailed: 'Yönetici parolası yanlış.', emailAccessExpired: 'E-posta erişiminin süresi doldu. Parolanızı yeniden doğrulayın.', saveEmail: 'E-postayı kaydet', emailUpdated: 'E-posta güncellendi. Bu hesaba ait tüm oturumlar ve bağlı cihazlar iptal edildi.', emailUnchanged: 'E-posta adresi değişmedi.', emailUpdatedSignIn: 'E-posta güncellendi. Yeni adresle yeniden oturum açın.', environmentEmailReadonly: 'NODUS_ADMIN_EMAIL tarafından yönetilir ve burada düzenlenemez.' },
};

const LIBRARY_ADMIN_KEYS = {
  en: { publishedLibraryOne: 'Published library: 1 document', publishedLibraryCount: 'Published library: {count} documents', libraryNotShared: 'Library not shared' },
  es: { publishedLibraryOne: 'Biblioteca publicada: 1 documento', publishedLibraryCount: 'Biblioteca publicada: {count} documentos', libraryNotShared: 'Biblioteca no compartida' },
  fr: { publishedLibraryOne: 'Bibliothèque publiée : 1 document', publishedLibraryCount: 'Bibliothèque publiée : {count} documents', libraryNotShared: 'Bibliothèque non partagée' },
  de: { publishedLibraryOne: 'Veröffentlichte Bibliothek: 1 Dokument', publishedLibraryCount: 'Veröffentlichte Bibliothek: {count} Dokumente', libraryNotShared: 'Bibliothek nicht freigegeben' },
  pt: { publishedLibraryOne: 'Biblioteca publicada: 1 documento', publishedLibraryCount: 'Biblioteca publicada: {count} documentos', libraryNotShared: 'Biblioteca não partilhada' },
  'pt-BR': { publishedLibraryOne: 'Biblioteca publicada: 1 documento', publishedLibraryCount: 'Biblioteca publicada: {count} documentos', libraryNotShared: 'Biblioteca não compartilhada' },
  it: { publishedLibraryOne: 'Biblioteca pubblicata: 1 documento', publishedLibraryCount: 'Biblioteca pubblicata: {count} documenti', libraryNotShared: 'Biblioteca non condivisa' },
  tr: { publishedLibraryOne: 'Yayınlanmış kitaplık: 1 belge', publishedLibraryCount: 'Yayınlanmış kitaplık: {count} belge', libraryNotShared: 'Kitaplık paylaşılmıyor' },
};

const TABLES = {
  en: { ...EN, ...ROLE_KEYS.en, ...SERVER_UI_KEYS.en, ...ADMIN_UI_KEYS.en, ...VAULT_TYPE_KEYS.en, ...EMAIL_ADMIN_KEYS.en, ...LIBRARY_ADMIN_KEYS.en },
  es: { ...ES, ...ROLE_KEYS.es, ...SERVER_UI_KEYS.es, ...ADMIN_UI_KEYS.es, ...VAULT_TYPE_KEYS.es, ...EMAIL_ADMIN_KEYS.es, ...LIBRARY_ADMIN_KEYS.es },
  fr: { ...FR, ...ROLE_KEYS.fr, ...SERVER_UI_KEYS.fr, ...ADMIN_UI_KEYS.fr, ...VAULT_TYPE_KEYS.fr, ...EMAIL_ADMIN_KEYS.fr, ...LIBRARY_ADMIN_KEYS.fr },
  de: { ...DE, ...ROLE_KEYS.de, ...SERVER_UI_KEYS.de, ...ADMIN_UI_KEYS.de, ...VAULT_TYPE_KEYS.de, ...EMAIL_ADMIN_KEYS.de, ...LIBRARY_ADMIN_KEYS.de },
  pt: { ...PT, ...ROLE_KEYS.pt, ...SERVER_UI_KEYS.pt, ...ADMIN_UI_KEYS.pt, ...VAULT_TYPE_KEYS.pt, ...EMAIL_ADMIN_KEYS.pt, ...LIBRARY_ADMIN_KEYS.pt },
  'pt-BR': { ...PT_BR, ...ROLE_KEYS['pt-BR'], ...SERVER_UI_KEYS['pt-BR'], ...ADMIN_UI_KEYS['pt-BR'], ...VAULT_TYPE_KEYS['pt-BR'], ...EMAIL_ADMIN_KEYS['pt-BR'], ...LIBRARY_ADMIN_KEYS['pt-BR'] },
  it: { ...IT, ...ROLE_KEYS.it, ...SERVER_UI_KEYS.it, ...ADMIN_UI_KEYS.it, ...VAULT_TYPE_KEYS.it, ...EMAIL_ADMIN_KEYS.it, ...LIBRARY_ADMIN_KEYS.it },
  tr: { ...TR, ...ROLE_KEYS.tr, ...SERVER_UI_KEYS.tr, ...ADMIN_UI_KEYS.tr, ...VAULT_TYPE_KEYS.tr, ...EMAIL_ADMIN_KEYS.tr, ...LIBRARY_ADMIN_KEYS.tr },
};

export function missingServerTranslations() {
  // Keyed off the assembled English table, not the raw EN literal, so a key added to one of
  // the grouped blocks is still checked against every language.
  const keys = Object.keys(TABLES.en);
  return Object.fromEntries(SERVER_LANGUAGES.map((language) => [language, keys.filter((key) => TABLES[language][key] == null)]));
}

export function normalizeServerLanguage(value) {
  return SERVER_LANGUAGES.includes(value) ? value : 'en';
}

export function serverTranslator(value) {
  const language = normalizeServerLanguage(value);
  const table = TABLES[language];
  return (key, variables = {}) => {
    let result = table[key] ?? EN[key] ?? key;
    for (const [name, replacement] of Object.entries(variables)) result = result.replaceAll(`{${name}}`, String(replacement));
    return result;
  };
}
