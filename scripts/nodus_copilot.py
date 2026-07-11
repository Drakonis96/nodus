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
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request

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
        self.last_sent = ("", "")

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

            snapshot = (paragraph_text, selection_text)
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


def _insert_at_cursor(doc, text_to_insert):
    """Insert after the current selection (matching the Word pane: never replaces
    the selected text) and leave the cursor at the end of the insertion.
    Main-thread only."""
    controller = doc.getCurrentController()
    view_cursor = controller.getViewCursor() if controller else None
    if not view_cursor:
        return
    if text_to_insert and not text_to_insert[0].isspace():
        text_to_insert = " " + text_to_insert
    text = view_cursor.getText()
    text.insertString(view_cursor.getEnd(), text_to_insert, False)
    view_cursor.collapseToEnd()


class _InsertCallback(unohelper.Base, uno.getClass("com.sun.star.awt.XCallback")):
    """Runs one insertion on the main thread (posted via AsyncCallback)."""

    def __init__(self, doc, text_to_insert):
        self.doc = doc
        self.text_to_insert = text_to_insert

    def notify(self, data):
        try:
            _insert_at_cursor(self.doc, self.text_to_insert)
        except Exception as e:
            print("[Nodus] Error al insertar el texto: %s" % e)


def _schedule_insert(doc, text_to_insert):
    """Marshal a document mutation from a worker thread onto the main thread."""
    try:
        ctx = uno.getComponentContext()
        async_cb = ctx.ServiceManager.createInstanceWithContext("com.sun.star.awt.AsyncCallback", ctx)
        async_cb.addCallback(_InsertCallback(doc, text_to_insert), None)
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
                {"paragraphText": snapshot[0], "selectionText": snapshot[1]},
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
            if result and result.get("text") and running:
                _schedule_insert(doc, result["text"])
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
