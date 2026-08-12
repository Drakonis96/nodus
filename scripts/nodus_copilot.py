# -*- coding: utf-8 -*-
"""
Nodus Copilot — puente para LibreOffice Writer / LibreOffice Writer bridge.

Two-way bridge between LibreOffice Writer and the local Nodus copilot server:
it pushes the current paragraph/selection to Nodus (so the copilot pane can
analyze it) and long-polls for AI-generated texts to insert at the cursor.

Instalación / Install:
1. En Nodus: Ajustes → Copiloto de escritura (LibreOffice) → "Instalar macro"
   (copia este archivo a la carpeta de scripts Python de LibreOffice), o cópialo
   a mano a:
     - Linux:   ~/.config/libreoffice/4/user/Scripts/python/
     - macOS:   ~/Library/Application Support/LibreOffice/4/user/Scripts/python/
     - Windows: %APPDATA%/LibreOffice/4/user/Scripts/python/
2. En LibreOffice Writer: Herramientas → Macros → Ejecutar macro →
   Mis macros → nodus_copilot → start_nodus_copilot.
3. Para detenerlo: la misma ruta → stop_nodus_copilot.

Connection info (port, token, CA) is read from the bridge file Nodus writes on
copilot-server start: ~/.nodus-copilot-certs/bridge.json — a fixed per-user
path independent of the Nodus data directory and of which vault is active.
"""

import json
import hashlib
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

import uno  # noqa: F401  (provided by LibreOffice's embedded Python)
import unohelper

# Overridable for tests/custom setups; defaults to the file the Nodus copilot
# server refreshes on every start.
BRIDGE_FILE = os.environ.get("NODUS_COPILOT_BRIDGE") or os.path.expanduser(
    "~/.nodus-copilot-certs/bridge.json"
)

UPDATE_TIMEOUT_S = 5
# Must exceed the server's 30s long-poll window so the server, not the socket,
# ends each empty poll.
POLL_TIMEOUT_S = 40

# Global session state. Threading contract: UNO document calls happen ONLY on
# LibreOffice's main thread (the selection listener, and insertions marshaled
# through com.sun.star.awt.AsyncCallback); network happens ONLY on background
# threads. Mutating a document from a Python thread deadlocks against the
# solar mutex — verified empirically.
listener_instance = None
polling_thread = None
sender_thread = None
running = False
# Latest (paragraph, selection) captured by the listener, pending upload.
_send_queue = queue.Queue(maxsize=16)
# Set after a TLS verification failure so the session keeps working (localhost
# only) instead of dying when the CA in the bridge file can't verify the leaf.
_tls_fallback_insecure = False
REFERENCE_BOOKMARK_PREFIX = "NODUS_REF_"
REFERENCE_PROPERTY_PREFIX = "NODUS_REFERENCE_"
REFERENCE_PREFERENCES_PROPERTY = "NODUS_REFERENCE_PREFERENCES"


class _CitationHtmlParser(HTMLParser):
    """Small, dependency-free citeproc HTML reader for Writer character styles."""

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.runs = []
        self.styles = {"bold": False, "italic": False, "sup": False, "sub": False}
        self.stack = []
        self.entry_count = 0

    def _append(self, value):
        if not value:
            return
        style = dict(self.styles)
        if self.runs and self.runs[-1][1] == style:
            self.runs[-1] = (self.runs[-1][0] + value, style)
        else:
            self.runs.append((value, style))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.stack.append((tag, dict(self.styles), attrs))
        if tag in ("b", "strong"):
            self.styles["bold"] = True
        elif tag in ("i", "em"):
            self.styles["italic"] = True
        elif tag == "sup":
            self.styles["sup"] = True
        elif tag == "sub":
            self.styles["sub"] = True
        elif tag == "br":
            self._append("\n")
        elif tag == "div" and "csl-entry" in attrs.get("class", ""):
            if self.entry_count:
                self._append("\n")
            self.entry_count += 1

    def handle_endtag(self, tag):
        if tag == "div" and self.stack:
            attrs = self.stack[-1][2]
            if "csl-left-margin" in attrs.get("class", ""):
                self._append("\t")
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.styles = self.stack[index][1]
                del self.stack[index:]
                break

    def handle_data(self, data):
        self._append(data)


def _citation_runs(html, fallback):
    if not html:
        return [(fallback or "", {})]
    try:
        parser = _CitationHtmlParser()
        parser.feed(html)
        return parser.runs or [(fallback or "", {})]
    except Exception:
        return [(fallback or "", {})]


def _plain_runs(runs):
    return "".join(run[0] for run in runs)


def _insert_runs(text, cursor, runs):
    """Insert citeproc runs at a Writer cursor and return their plain text."""
    for value, style in runs:
        cursor.CharWeight = 150.0 if style.get("bold") else 100.0
        cursor.CharPosture = uno.getConstantByName(
            "com.sun.star.awt.FontSlant.ITALIC" if style.get("italic") else "com.sun.star.awt.FontSlant.NONE"
        )
        cursor.CharEscapement = 33 if style.get("sup") else -33 if style.get("sub") else 0
        text.insertString(cursor, value, False)
        cursor.collapseToEnd()
    cursor.CharWeight = 100.0
    cursor.CharPosture = uno.getConstantByName("com.sun.star.awt.FontSlant.NONE")
    cursor.CharEscapement = 0
    return _plain_runs(runs)


def _user_properties(doc):
    return doc.getDocumentProperties().getUserDefinedProperties()


def _property_get(doc, name, default=None):
    try:
        return _user_properties(doc).getPropertyValue(name)
    except Exception:
        return default


def _property_set(doc, name, value):
    props = _user_properties(doc)
    try:
        props.setPropertyValue(name, value)
    except Exception:
        # com.sun.star.beans.PropertyAttribute.REMOVABLE
        props.addProperty(name, 128, value)


def _property_remove(doc, name):
    try:
        _user_properties(doc).removeProperty(name)
    except Exception:
        pass


def _bookmark_name(field_id):
    digest = hashlib.sha256(str(field_id).encode("utf-8")).hexdigest()[:24].upper()
    return REFERENCE_BOOKMARK_PREFIX + digest


def _reference_data(doc, bookmark_name):
    try:
        value = json.loads(_property_get(doc, REFERENCE_PROPERTY_PREFIX + bookmark_name, "") or "")
        if value.get("format") == "nodus.office-reference" and value.get("formatVersion") == 1:
            return value
    except Exception:
        pass
    return None


def _attach_bookmark(doc, cursor, name, field_data):
    bookmark = doc.createInstance("com.sun.star.text.Bookmark")
    bookmark.setName(name)
    cursor.getText().insertTextContent(cursor, bookmark, True)
    _property_set(doc, REFERENCE_PROPERTY_PREFIX + name, json.dumps(field_data, ensure_ascii=False))


def _insert_live_field(doc, field_data, text_value, html_value=None):
    controller = doc.getCurrentController()
    view_cursor = controller.getViewCursor() if controller else None
    if not view_cursor:
        return
    placement = ((field_data.get("citation") or {}).get("placement") if field_data.get("kind") == "citation" else "in-text") or "in-text"
    target_text = view_cursor.getText()
    start = view_cursor.getEnd()
    if placement in ("footnote", "endnote"):
        note = doc.createInstance("com.sun.star.text.Footnote")
        if placement == "endnote":
            note.setPropertyValue("IsEndnote", True)
        target_text.insertTextContent(start, note, False)
        target_text = note.getText()
        start = target_text.getStart()
    runs = _citation_runs(html_value, text_value)
    cursor = target_text.createTextCursorByRange(start)
    _insert_runs(target_text, cursor, runs)
    mark_cursor = target_text.createTextCursorByRange(start)
    mark_cursor.gotoRange(cursor.getEnd(), True)
    _attach_bookmark(doc, mark_cursor, _bookmark_name(field_data.get("fieldId")), field_data)


def _replace_live_field(doc, bookmark_name, formatted):
    bookmarks = doc.getBookmarks()
    if not bookmarks.hasByName(bookmark_name):
        return
    bookmark = bookmarks.getByName(bookmark_name)
    anchor = bookmark.getAnchor()
    text = anchor.getText()
    start = anchor.getStart()
    data = _reference_data(doc, bookmark_name)
    try:
        bookmark.dispose()
    except Exception:
        pass
    anchor.setString("")
    cursor = text.createTextCursorByRange(start)
    runs = _citation_runs(formatted.get("html"), formatted.get("text", ""))
    _insert_runs(text, cursor, runs)
    mark_cursor = text.createTextCursorByRange(start)
    mark_cursor.gotoRange(cursor.getEnd(), True)
    if data:
        _attach_bookmark(doc, mark_cursor, bookmark_name, data)


def _upsert_live_field(doc, field_data, text_value, html_value=None):
    name = _bookmark_name(field_data.get("fieldId"))
    try:
        exists = doc.getBookmarks().hasByName(name)
    except Exception:
        exists = False
    if not exists:
        _insert_live_field(doc, field_data, text_value, html_value)
        return
    _property_set(doc, REFERENCE_PROPERTY_PREFIX + name, json.dumps(field_data, ensure_ascii=False))
    _replace_live_field(doc, name, {"text": text_value, "html": html_value})


def _selected_reference_id(doc, view_cursor):
    try:
        bookmarks = doc.getBookmarks()
        for name in bookmarks.getElementNames():
            if not name.startswith(REFERENCE_BOOKMARK_PREFIX):
                continue
            anchor = bookmarks.getByName(name).getAnchor()
            if anchor.getText() != view_cursor.getText():
                continue
            text = anchor.getText()
            starts_after = text.compareRegionStarts(view_cursor.getStart(), anchor.getStart()) >= 0
            ends_before = text.compareRegionEnds(view_cursor.getEnd(), anchor.getEnd()) <= 0
            if starts_after and ends_before:
                data = _reference_data(doc, name)
                return data.get("fieldId") if data else None
    except Exception:
        pass
    return None


def _reference_state(doc, view_cursor=None):
    citations = []
    bibliography_ids = []
    bibliographies = []
    try:
        for name in doc.getBookmarks().getElementNames():
            if not name.startswith(REFERENCE_BOOKMARK_PREFIX):
                continue
            data = _reference_data(doc, name)
            if not data:
                continue
            if data.get("kind") == "citation" and data.get("citation"):
                citations.append(data["citation"])
            elif data.get("kind") == "bibliography":
                bibliography_ids.append(data.get("fieldId"))
                bibliographies.append(data)
    except Exception:
        pass
    citations.sort(key=lambda entry: (entry.get("noteIndex", 0), entry.get("citationId", "")))
    preferences = None
    try:
        preferences = json.loads(_property_get(doc, REFERENCE_PREFERENCES_PROPERTY, "") or "")
    except Exception:
        pass
    document_id = getattr(doc, "RuntimeUID", None) or doc.getURL() or getattr(doc, "Title", None)
    return {
        "documentId": str(document_id or "libreoffice-document"),
        "preferences": preferences,
        "citations": citations,
        "bibliographyFieldIds": bibliography_ids,
        "bibliographies": bibliographies,
        "selectedFieldId": _selected_reference_id(doc, view_cursor) if view_cursor else None,
    }


def _apply_reference_updates(doc, command):
    citation_updates = {entry.get("citationId"): entry for entry in command.get("citationUpdates", [])}
    bibliography = command.get("bibliography")
    try:
        names = list(doc.getBookmarks().getElementNames())
    except Exception:
        names = []
    for name in names:
        if not name.startswith(REFERENCE_BOOKMARK_PREFIX):
            continue
        data = _reference_data(doc, name)
        if not data:
            continue
        if data.get("kind") == "citation":
            update = citation_updates.get((data.get("citation") or {}).get("citationId"))
            if update:
                _replace_live_field(doc, name, update)
        elif data.get("kind") == "bibliography" and bibliography:
            _replace_live_field(doc, name, bibliography)


def _unlink_references(doc):
    try:
        names = list(doc.getBookmarks().getElementNames())
    except Exception:
        names = []
    for name in names:
        if not name.startswith(REFERENCE_BOOKMARK_PREFIX):
            continue
        try:
            doc.getBookmarks().getByName(name).dispose()
        except Exception:
            pass
        _property_remove(doc, REFERENCE_PROPERTY_PREFIX + name)
    _property_remove(doc, REFERENCE_PREFERENCES_PROPERTY)


def load_bridge_info():
    """Return (port, token, ca_pem) from the bridge file, or None when absent/unreadable."""
    try:
        with open(BRIDGE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    port = data.get("port")
    token = data.get("token")
    if not isinstance(port, int) or not token:
        return None
    return port, str(token), data.get("caCert") or None


def _ssl_context(ca_pem):
    """Verified context against the Nodus CA when available; otherwise (or after a
    verification failure) an unverified localhost-only context."""
    if ca_pem and not _tls_fallback_insecure:
        try:
            ctx = ssl.create_default_context(cadata=ca_pem)
            # Keep real chain+hostname verification but drop the STRICT extras
            # (Python 3.13 default): locally generated leaves (mkcert /
            # office-addin-dev-certs) may lack the AKI/SKI extensions it demands.
            ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
            return ctx
        except Exception:
            pass
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _request(method, api_path, body=None, timeout=UPDATE_TIMEOUT_S):
    """One HTTPS call to the copilot server; returns parsed JSON or None."""
    global _tls_fallback_insecure
    info = load_bridge_info()
    if not info:
        return None
    port, token, ca_pem = info
    url = "https://localhost:%d%s" % (port, api_path)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_context(ca_pem), timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except ssl.SSLError:
        if not _tls_fallback_insecure:
            _tls_fallback_insecure = True
            print("[Nodus] Aviso: no se pudo verificar el certificado local; se continúa sin verificación (solo localhost).")
            return _request(method, api_path, body=body, timeout=timeout)
        return None


class SelectionListener(unohelper.Base, uno.getClass("com.sun.star.view.XSelectionChangeListener")):
    def __init__(self, doc):
        self.doc = doc
        self.last_sent = None

    def selectionChanged(self, event):
        if not running:
            return
        try:
            controller = self.doc.getCurrentController()
            view_cursor = controller.getViewCursor() if controller else None
            if not view_cursor:
                return

            selection_text = view_cursor.getString() or ""

            # Walk the enclosing text (works inside tables/frames too) with an
            # invisible cursor so the visual selection is untouched. Writer text
            # cursors implement XParagraphCursor directly — pyuno proxies expose
            # every interface, no queryInterface needed (pyuno has none).
            text = view_cursor.getText()
            para_cursor = text.createTextCursorByRange(view_cursor.getStart())
            para_cursor.gotoStartOfParagraph(False)
            para_cursor.gotoEndOfParagraph(True)
            paragraph_text = para_cursor.getString() or ""

            reference_snapshot = _reference_state(self.doc, view_cursor)
            snapshot = {
                "paragraphText": paragraph_text,
                "selectionText": selection_text,
                "documentId": reference_snapshot["documentId"],
                "references": reference_snapshot,
            }
            if snapshot == self.last_sent:
                return
            self.last_sent = snapshot

            # Never do network on this (main/UI) thread: hand off to the sender.
            try:
                _send_queue.put_nowait(snapshot)
            except queue.Full:
                pass  # the sender drains to the freshest snapshot anyway
        except Exception as e:
            print("[Nodus] Error al sincronizar la selección: %s" % e)

    def disposing(self, event):
        pass


def _insert_footnote(doc, view_cursor, text_to_insert):
    """Attach a footnote at the end of the current selection and fill its text.
    Raises on Writer builds that cannot place it, so the caller falls back inline."""
    footnote = doc.createInstance("com.sun.star.text.Footnote")
    view_text = view_cursor.getText()
    view_text.insertTextContent(view_cursor.getEnd(), footnote, False)
    fn_text = footnote.getText()
    fn_cursor = fn_text.createTextCursor()
    fn_text.insertString(fn_cursor, text_to_insert, False)


def _insert_at_cursor(doc, text_to_insert, as_footnote=False, replace=False):
    """Place AI text near the current selection. By default inserts after the
    selection (matching the Word pane); `replace` overwrites the selected text and
    `as_footnote` places the text in a footnote instead. Either option falls back
    to a plain insertion so the text is never lost. Main-thread only."""
    controller = doc.getCurrentController()
    view_cursor = controller.getViewCursor() if controller else None
    if not view_cursor:
        return
    if as_footnote:
        try:
            _insert_footnote(doc, view_cursor, text_to_insert)
            return
        except Exception as e:
            print("[Nodus] No se pudo crear la nota al pie; se inserta en el texto: %s" % e)
    if replace:
        try:
            view_cursor.setString(text_to_insert)
            view_cursor.collapseToEnd()
            return
        except Exception as e:
            print("[Nodus] No se pudo reemplazar la selección; se inserta al final: %s" % e)
    if text_to_insert and not text_to_insert[0].isspace():
        text_to_insert = " " + text_to_insert
    text = view_cursor.getText()
    text.insertString(view_cursor.getEnd(), text_to_insert, False)
    view_cursor.collapseToEnd()


class _InsertCallback(unohelper.Base, uno.getClass("com.sun.star.awt.XCallback")):
    """Runs one insertion on the main thread (posted via AsyncCallback)."""

    def __init__(self, doc, command):
        self.doc = doc
        self.command = command

    def notify(self, data):
        try:
            command_name = self.command.get("command") or "insert-text"
            if self.command.get("preferences"):
                _property_set(
                    self.doc,
                    REFERENCE_PREFERENCES_PROPERTY,
                    json.dumps(self.command["preferences"], ensure_ascii=False),
                )
            if command_name == "insert-citation":
                _upsert_live_field(
                    self.doc,
                    self.command.get("field") or {},
                    self.command.get("text", ""),
                    self.command.get("html"),
                )
                _apply_reference_updates(self.doc, self.command)
            elif command_name == "insert-bibliography":
                _upsert_live_field(
                    self.doc,
                    self.command.get("field") or {},
                    self.command.get("text", ""),
                    self.command.get("html"),
                )
                _apply_reference_updates(self.doc, self.command)
            elif command_name == "refresh-references":
                _apply_reference_updates(self.doc, self.command)
            elif command_name == "unlink-references":
                _unlink_references(self.doc)
            else:
                _insert_at_cursor(
                    self.doc,
                    self.command.get("text", ""),
                    bool(self.command.get("asFootnote")),
                    bool(self.command.get("replace")),
                )
            controller = self.doc.getCurrentController()
            view_cursor = controller.getViewCursor() if controller else None
            reference_snapshot = _reference_state(self.doc, view_cursor)
            snapshot = {
                "paragraphText": "",
                "selectionText": view_cursor.getString() if view_cursor else "",
                "documentId": reference_snapshot["documentId"],
                "references": reference_snapshot,
            }
            try:
                _send_queue.put_nowait(snapshot)
            except queue.Full:
                pass
        except Exception as e:
            print("[Nodus] Error al insertar el texto: %s" % e)


def _schedule_insert(doc, command):
    """Marshal a document mutation from a worker thread onto the main thread."""
    try:
        ctx = uno.getComponentContext()
        async_cb = ctx.ServiceManager.createInstanceWithContext("com.sun.star.awt.AsyncCallback", ctx)
        async_cb.addCallback(_InsertCallback(doc, command), None)
    except Exception as e:
        print("[Nodus] Error al programar la inserción: %s" % e)


def send_updates():
    """Upload selection snapshots from the queue (network thread)."""
    while running:
        try:
            snapshot = _send_queue.get(timeout=1)
        except queue.Empty:
            continue
        # Drain to the freshest snapshot; intermediate states are obsolete.
        try:
            while True:
                snapshot = _send_queue.get_nowait()
        except queue.Empty:
            pass
        try:
            _request(
                "POST",
                "/api/editor/update-text",
                snapshot,
            )
        except Exception as e:
            print("[Nodus] Error al enviar la selección: %s" % e)


def poll_insertions(doc):
    """Long-poll the server for texts to insert until stop_nodus_copilot()."""
    while running:
        try:
            if load_bridge_info() is None:
                # Nodus not started yet (or copilot disabled): retry quietly.
                time.sleep(3)
                continue
            result = _request("GET", "/api/editor/poll-insertion", timeout=POLL_TIMEOUT_S)
            if result and (result.get("command") or result.get("text")) and running:
                _schedule_insert(doc, result)
        except urllib.error.URLError:
            time.sleep(5)  # server down/unreachable; back off and retry
        except Exception as e:
            print("[Nodus] Error en el bucle de inserción: %s" % e)
            time.sleep(2)


def _find_writer_doc(desktop):
    """The focused component when it is a Writer doc; otherwise the first open
    Writer doc (covers focus on the Basic IDE, dialogs, or headless use)."""
    doc = desktop.getCurrentComponent()
    if doc is not None and hasattr(doc, "getText") and doc.getCurrentController():
        return doc
    try:
        components = desktop.getComponents().createEnumeration()
        while components.hasMoreElements():
            candidate = components.nextElement()
            if hasattr(candidate, "getText") and candidate.getCurrentController():
                return candidate
    except Exception:
        pass
    return None


def start_nodus_copilot(*args):
    """Arranca el puente: sincroniza la selección y escucha inserciones de Nodus."""
    global listener_instance, polling_thread, sender_thread, running
    if running:
        print("[Nodus] El puente ya está activo.")
        return
    try:
        desktop = XSCRIPTCONTEXT.getDesktop()  # noqa: F821 (injected by the script provider)
        doc = _find_writer_doc(desktop)
        controller = doc.getCurrentController() if doc else None
        if not controller:
            print("[Nodus] Abre un documento de Writer antes de iniciar el puente.")
            return

        listener_instance = SelectionListener(doc)
        controller.addSelectionChangeListener(listener_instance)

        running = True
        listener_instance.selectionChanged(None)
        sender_thread = threading.Thread(target=send_updates, daemon=True)
        sender_thread.start()
        polling_thread = threading.Thread(target=poll_insertions, args=(doc,), daemon=True)
        polling_thread.start()

        if load_bridge_info() is None:
            print("[Nodus] Puente iniciado, pero no se encontró %s. Abre Nodus con el copiloto activado." % BRIDGE_FILE)
        else:
            print("[Nodus] Puente LibreOffice Writer ↔ Nodus iniciado.")
    except Exception as e:
        print("[Nodus] Error al iniciar el puente: %s" % e)


def stop_nodus_copilot(*args):
    """Detiene el puente y retira el listener de selección."""
    global listener_instance, running
    if not running:
        return
    try:
        running = False
        # Detach from the document the listener was registered on (the user may
        # have switched to another document since start).
        if listener_instance:
            controller = listener_instance.doc.getCurrentController()
            if controller:
                controller.removeSelectionChangeListener(listener_instance)
        listener_instance = None
        print("[Nodus] Puente detenido.")
    except Exception as e:
        print("[Nodus] Error al detener el puente: %s" % e)


# Functions exposed in LibreOffice's macro selector.
g_exportedScripts = (start_nodus_copilot, stop_nodus_copilot)
