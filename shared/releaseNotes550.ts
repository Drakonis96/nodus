// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReleaseHighlight } from './releaseNotes';

/**
 * v5.5.0: Nodus Connector for Chrome speaks thirteen languages, and so do the
 * messages it composes itself. The first note covers what a user sees, the second
 * what the extension writes on its own. Keep the order: the raw array is the
 * editorial order and the modal clusters it by scope size.
 */
export const RELEASE_5_5_0_HIGHLIGHTS: ReleaseHighlight[] = [
  {
    scope: 'languages',
    es: 'El conector de Chrome habla trece idiomas. A los nueve de la interfaz se suman el japonés, el coreano, el ruso y el chino tradicional, así que el popup, la página de ajustes, la política de privacidad que se abre desde ahí y hasta la lista de tipos de documento que revisas antes de guardar dejan de estar solo en inglés y siguen el idioma de tu navegador.',
    en: 'The Chrome connector speaks thirteen languages. Japanese, Korean, Russian and Traditional Chinese join the nine the interface already had, so the popup, the settings page, the privacy policy it opens and even the list of document types you review before saving stop being English only and follow your browser language.',
    fr: 'Le connecteur Chrome parle treize langues. Le japonais, le coréen, le russe et le chinois traditionnel rejoignent les neuf que l’interface connaissait déjà, donc la fenêtre, la page de réglages, la politique de confidentialité qu’elle ouvre et même la liste des types de document que vous vérifiez avant d’enregistrer ne sont plus uniquement en anglais et suivent la langue de votre navigateur.',
    de: 'Der Chrome-Connector spricht dreizehn Sprachen. Japanisch, Koreanisch, Russisch und traditionelles Chinesisch kommen zu den neun hinzu, die die Oberfläche schon hatte, sodass das Popup, die Einstellungsseite, die von dort geöffnete Datenschutzerklärung und sogar die Liste der Dokumenttypen, die du vor dem Speichern prüfst, nicht mehr nur englisch sind und der Sprache deines Browsers folgen.',
    pt: 'O conector do Chrome fala treze línguas. O japonês, o coreano, o russo e o chinês tradicional juntam-se às nove que a interface já tinha, por isso a janela, a página de definições, a política de privacidade que esta abre e até a lista de tipos de documento que revês antes de guardar deixam de estar apenas em inglês e seguem a língua do teu navegador.',
    'pt-BR': 'O conector do Chrome fala treze idiomas. Japonês, coreano, russo e chinês tradicional se juntam aos nove que a interface já tinha, então a janela, a página de configurações, a política de privacidade que ela abre e até a lista de tipos de documento que você revisa antes de salvar deixam de ser apenas em inglês e seguem o idioma do seu navegador.',
    it: 'Il connettore Chrome parla tredici lingue. Giapponese, coreano, russo e cinese tradizionale si aggiungono alle nove che l’interfaccia già aveva, così la finestra, la pagina delle impostazioni, l’informativa sulla privacy che apre e perfino l’elenco dei tipi di documento che controlli prima di salvare non sono più solo in inglese e seguono la lingua del tuo browser.',
    tr: 'Chrome bağlayıcısı on üç dil konuşuyor. Japonca, Korece, Rusça ve geleneksel Çince, arayüzün zaten bildiği dokuz dile katılıyor. Açılır pencere, ayarlar sayfası, oradan açılan gizlilik politikası ve kaydetmeden önce gözden geçirdiğiniz belge türü listesi artık yalnızca İngilizce değil ve tarayıcınızın dilini izliyor.',
    'zh-CN': 'Chrome 连接器现在支持十三种语言。日语、韩语、俄语和繁体中文加入界面原有的九种语言，因此弹窗、设置页、由它打开的隐私政策，甚至你在保存前查看的文档类型列表，都不再只有英文，而是跟随浏览器的语言。',
  },
  {
    scope: 'connector',
    es: 'Los mensajes que el conector redacta por su cuenta también se traducen. El aviso de que un archivo supera los 64 MiB, el error de una descarga que falla, la página de inicio de sesión que un editor devuelve en lugar del PDF y las etiquetas que se guardan en tu Biblioteca cuando la página no las trae salen ahora del catálogo de tu idioma, así que el conector en español deja de mezclar inglés.',
    en: 'The messages the connector writes by itself are translated too. The notice that a file exceeds 64 MiB, the error of a download that fails, the sign-in page a publisher returns instead of the PDF and the labels saved into your Library when the page brings none now come from the catalog of your language, so the connector stops mixing English into your interface.',
    fr: 'Les messages que le connecteur rédige lui-même sont traduits eux aussi. L’avis qu’un fichier dépasse 64 MiB, l’erreur d’un téléchargement qui échoue, la page de connexion qu’un éditeur renvoie à la place du PDF et les étiquettes enregistrées dans votre bibliothèque quand la page n’en fournit aucune viennent désormais du catalogue de votre langue.',
    de: 'Auch die Meldungen, die der Connector selbst verfasst, sind übersetzt. Der Hinweis, dass eine Datei 64 MiB überschreitet, der Fehler eines fehlgeschlagenen Downloads, die Anmeldeseite, die ein Verlag statt der PDF-Datei zurückgibt, und die Bezeichnungen, die in deiner Bibliothek gespeichert werden, wenn die Seite keine mitbringt, stammen jetzt aus dem Katalog deiner Sprache.',
    pt: 'As mensagens que o conector escreve por si próprio também são traduzidas. O aviso de que um ficheiro excede os 64 MiB, o erro de uma transferência que falha, a página de início de sessão que um editor devolve em vez do PDF e as etiquetas guardadas na tua Biblioteca quando a página não as traz vêm agora do catálogo da tua língua.',
    'pt-BR': 'As mensagens que o conector escreve por conta própria também são traduzidas. O aviso de que um arquivo excede os 64 MiB, o erro de um download que falha, a página de login que um editor retorna em vez do PDF e as etiquetas salvas na sua Biblioteca quando a página não as traz vêm agora do catálogo do seu idioma.',
    it: 'Anche i messaggi che il connettore scrive da sé sono tradotti. L’avviso che un file supera i 64 MiB, l’errore di un download che non riesce, la pagina di accesso che un editore restituisce al posto del PDF e le etichette salvate nella tua Biblioteca quando la pagina non ne porta nessuna vengono ora dal catalogo della tua lingua.',
    tr: 'Bağlayıcının kendi yazdığı iletiler de çevriliyor. Bir dosyanın 64 MiB sınırını aştığı uyarısı, başarısız bir indirmenin hatası, bir yayıncının PDF yerine döndürdüğü oturum açma sayfası ve sayfa hiç etiket getirmediğinde Kütüphanenize kaydedilen etiketler artık dilinizin kataloğundan geliyor.',
    'zh-CN': '连接器自己编写的消息也已翻译。文件超过 64 MiB 的提示、下载失败的错误、出版商返回的登录页面而不是 PDF，以及页面没有提供标签时保存到文献库的标签，现在都来自你的语言的目录。',
  },
];
