# -*- coding: utf-8 -*-
"""
Nodus Copilot — LibreOffice Writer Entegrasyon Köprüsü
Bu script, LibreOffice Writer ile yerel Nodus uygulaması arasında çift yönlü iletişim sağlar.

Kurulum:
1. Bu dosyayı ~/.config/libreoffice/4/user/Scripts/python/nodus_copilot.py olarak kaydedin.
2. (Klasörler yoksa oluşturun: mkdir -p ~/.config/libreoffice/4/user/Scripts/python/)
3. LibreOffice Writer'ı açın.
4. Araçlar -> Makrolar -> Makroyu Çalıştır -> Makrolarım -> nodus_copilot -> start_nodus_copilot makrosunu çalıştırın.
"""

import uno
import unohelper
import json
import urllib.request
import urllib.error
import ssl
import threading
import time
import os
import sqlite3
import socket

# Varsayılan Konfigürasyon (SQLite okunamadığında kullanılır)
DEFAULT_PORT = 4320
DEFAULT_TOKEN = ""

# Global durum değişkenleri
listener_instance = None
polling_thread = None
running = False

def load_nodus_settings():
    """Nodus SQLite veritabanından güncel port ve token bilgilerini okur."""
    db_path = os.path.expanduser("~/.config/nodus/nodus.sqlite")
    if not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'app'")
        row = cursor.fetchone()
        conn.close()
        if row:
            return json.loads(row[0])
    except Exception as e:
        print(f"[Nodus] Ayarlar okunurken hata oluştu: {e}")
    return None

def get_connection_info():
    """Bağlantı parametrelerini döner."""
    settings = load_nodus_settings()
    port = DEFAULT_PORT
    token = DEFAULT_TOKEN
    
    if settings:
        port = settings.get("copilotPort", DEFAULT_PORT)
        token = settings.get("copilotToken", DEFAULT_TOKEN)
        
    return port, token

class SelectionListener(unohelper.Base, uno.getClass("com.sun.star.view.XSelectionChangeListener")):
    def __init__(self, doc):
        self.doc = doc
        self.last_text = ""

    def selectionChanged(self, event):
        global running
        if not running:
            return
        
        try:
            controller = self.doc.getCurrentController()
            if not controller:
                return
            view_cursor = controller.getViewCursor()
            if not view_cursor:
                return

            # Seçilen metni al
            selection_text = view_cursor.getString() or ""

            # Görsel seçimi bozmamak için görünmez bir TextCursor oluştur
            text = self.doc.getText()
            text_cursor = text.createTextCursorByRange(view_cursor.getStart())
            
            # XParagraphCursor arayüzünü sorgula ve paragraf metnini çek
            from com.sun.star.text.XParagraphCursor import XParagraphCursor
            para_cursor = uno.queryInterface(XParagraphCursor, text_cursor)
            if para_cursor:
                para_cursor.gotoStartOfParagraph(False)
                para_cursor.gotoEndOfParagraph(True)
                paragraph_text = para_cursor.getString() or ""
            else:
                paragraph_text = ""

            # Aynı metin için mükerrer istek atmayı engelle
            if paragraph_text == self.last_text:
                return
            self.last_text = paragraph_text

            # Sunucuya gönder
            port, token = get_connection_info()
            if not token:
                return

            url = f"https://localhost:{port}/api/editor/update-text"
            data = json.dumps({
                "paragraphText": paragraph_text,
                "selectionText": selection_text
            }).encode("utf-8")

            # Localhost sertifikasını doğrulama (self-signed cert bypass)
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, context=ctx, timeout=3) as response:
                pass
        except Exception as e:
            # Hata günlüklemesini basitleştirmek için terminale yazdırır
            print(f"[Nodus] Metin senkronizasyon hatası: {e}")

    def disposing(self, event):
        pass

def poll_insertions(doc):
    """Nodus'tan gelen metin/atıf ekleme isteklerini uzun-anketleme (long-poll) ile dinler."""
    global running
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    while running:
        try:
            port, token = get_connection_info()
            if not token:
                time.sleep(2)
                continue

            url = f"https://localhost:{port}/api/editor/poll-insertion"
            req = urllib.request.Request(
                url,
                headers={"Authorization": f"Bearer {token}"},
                method="GET"
            )

            # 35 saniyelik timeout ile uzun anketleme yap
            with urllib.request.urlopen(req, context=ctx, timeout=35) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                if res_data and res_data.get("text") and running:
                    # Metni ana imleç konumuna yerleştir
                    text_to_insert = res_data["text"]
                    
                    # Ana thread üzerinde imleç konumunu güncelle
                    controller = doc.getCurrentController()
                    view_cursor = controller.getViewCursor()
                    if view_cursor:
                        # Seçili metin varsa üzerine yazar, yoksa imlecin olduğu yere ekler
                        view_cursor.setString(text_to_insert)
                        # İmleci eklenen metnin sonuna taşı
                        view_cursor.collapseToEnd()
        except urllib.error.URLError as e:
            # Sunucu kapalı veya erişilemez durumdaysa bekle ve tekrar dene
            time.sleep(5)
        except socket.timeout:
            # Zaman aşımı normaldir (Long poll bitimi), döngü devam eder
            pass
        except Exception as e:
            time.sleep(2)

def start_nodus_copilot(*args):
    """Nodus Copilot dinleyicisini ve arka plan ekleme servisini başlatır."""
    global listener_instance, polling_thread, running
    if running:
        print("[Nodus] Dinleyici zaten aktif.")
        return

    try:
        desktop = XSCRIPTCONTEXT.getDesktop()
        doc = desktop.getCurrentComponent()
        controller = doc.getCurrentController()
        if not controller:
            print("[Nodus] Döküman kontrolcüsü bulunamadı.")
            return

        # Seçim dinleyicisini ata
        listener_instance = SelectionListener(doc)
        controller.addSelectionChangeListener(listener_instance)

        # Arka plan poll servisini başlat
        running = True
        polling_thread = threading.Thread(target=poll_insertions, args=(doc,), daemon=True)
        polling_thread.start()
        
        print("[Nodus] LibreOffice Writer Copilot Köprüsü başarıyla başlatıldı.")
    except Exception as e:
        print(f"[Nodus] Başlatma hatası: {e}")

def stop_nodus_copilot(*args):
    """Nodus Copilot dinleyicisini ve arka plan servisini durdurur."""
    global listener_instance, running
    if not running:
        return

    try:
        running = False
        desktop = XSCRIPTCONTEXT.getDesktop()
        doc = desktop.getCurrentComponent()
        controller = doc.getCurrentController()
        
        if controller and listener_instance:
            controller.removeSelectionChangeListener(listener_instance)
        
        listener_instance = None
        print("[Nodus] LibreOffice Writer Copilot Köprüsü durduruldu.")
    except Exception as e:
        print(f"[Nodus] Durdurma hatası: {e}")

# Makro menüsünde görünecek fonksiyonlar
g_exportedTemplates = (start_nodus_copilot, stop_nodus_copilot)
