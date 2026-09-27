"""Nodus's bounded entry point for the pinned Zotero MCP distribution.

The general upstream CLI discovers other clients, SQLite profiles and tools.
This entry point reuses its extraction and formatting implementations while
binding every operation to an immutable, application-owned source manifest.
No upstream CLI, setup, server lifespan, local DB or semantic index is loaded.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
import sys
from urllib.parse import urlparse

RUNTIME = Path(__file__).resolve().parent
sys.path.insert(0, str(RUNTIME / "dependencies"))
# --target installs do not execute pywin32.pth. Load only the pinned runtime's
# known directories, without processing arbitrary .pth or user site packages.
if sys.platform == "win32":
    for directory in ("win32", "win32/lib", "Pythonwin"):
        sys.path.insert(0, str(RUNTIME / "dependencies" / directory))
    _win32_dlls = os.add_dll_directory(str(RUNTIME / "dependencies" / "pywin32_system32"))
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ['FASTMCP_CHECK_FOR_UPDATES'] = 'off'

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
import httpx
from zotero_mcp.extract import extract_pdf


def load_scope(filename: str) -> dict:
    file = Path(filename).resolve(strict=True)
    scope = json.loads(file.read_text(encoding="utf-8"))
    if scope.get("format") != "nodus.zotero-mcp-scope/1":
        raise ValueError("Invalid source scope")
    root = Path(scope["root"]).resolve(strict=True)
    if not file.is_relative_to(root):
        raise ValueError("Scope file outside managed root")
    endpoint = urlparse(scope["endpoint"])
    if endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "::1") or endpoint.username or endpoint.password:
        raise ValueError("Managed Zotero requires an explicit loopback endpoint")
    if not endpoint.port or endpoint.query or endpoint.fragment or endpoint.path.rstrip('/') != '/api':
        raise ValueError("Invalid Zotero endpoint")
    if not isinstance(scope.get('items'), list) or len(scope['items']) > 10000:
        raise ValueError('Invalid source inventory')
    if not isinstance(scope.get('serverId'), str) or not scope['serverId']:
        raise ValueError('A verified Zotero server identity is required')
    identities = set()
    for item in scope['items']:
        identity = (item['libraryType'], str(item['libraryId']), item['itemKey'])
        if identity in identities or identity[0] not in ('user', 'group') or not identity[1].isdigit() or not re.fullmatch(r'[A-Z0-9]{8}', identity[2]):
            raise ValueError('Invalid source identity')
        identities.add(identity)
        if not item.get('revision') or not isinstance(item.get('version'), int):
            raise ValueError('A pinned source revision is required')
        for attachment in item.get('attachments', []):
            if not re.fullmatch(r'[A-Z0-9]{8}', attachment['key']) or not isinstance(attachment.get('version'), int):
                raise ValueError('Invalid attachment identity')
    scope["root"] = root
    return scope


def build_server(scope: dict) -> FastMCP:
    server = FastMCP("nodus-zotero-mcp", version="0.13.0+nodus.1")
    @server.resource("nodus://zotero/scope")
    def authorized_scope() -> str:
        items = sorted([[item['libraryType'], str(item['libraryId']), item['itemKey'], item['version'], item['revision'],
                         sorted([[attachment['key'], attachment['version']] for attachment in item.get('attachments', [])])]
                        for item in scope['items']])
        encoded = json.dumps([scope['serverId'], items], separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        return json.dumps({'format': 'nodus.zotero-scope-capabilities/1', 'readOnly': True,
                           'fingerprint': hashlib.sha256(encoded).hexdigest()})

    allowed = {(str(item["libraryType"]), str(item["libraryId"]), str(item["itemKey"])): item for item in scope["items"]}
    client = httpx.Client(timeout=20, trust_env=False, follow_redirects=False,
                         headers={'Zotero-Server-ID': scope['serverId'], 'Zotero-API-Version': '3', 'Zotero-Allowed-Request': '1'})

    def source(library_type: str, library_id: str, item_key: str) -> dict:
        item = allowed.get((library_type, library_id, item_key))
        if item is None:
            raise ToolError("source_not_authorized")
        return item

    def fetch(library_type: str, library_id: str, key: str, suffix: str = "") -> dict:
        if library_type not in ("user", "group") or not library_id.isdigit() or not key.isalnum():
            raise ToolError("invalid_identifier")
        plural = "users" if library_type == "user" else "groups"
        try:
            with client.stream('GET', f'{scope["endpoint"].rstrip("/")}/{plural}/{library_id}/items/{key}{suffix}') as response:
                if response.status_code == 404:
                    raise ToolError("source_unavailable")
                response.raise_for_status()
                if response.headers.get('Zotero-Server-ID') != scope['serverId']:
                    raise ToolError('zotero_server_identity_changed')
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 8 * 1024 * 1024:
                        raise ToolError('response_too_large')
                result = json.loads(content)
            if not isinstance(result, dict):
                raise ToolError("invalid_zotero_response")
            return result
        except ToolError:
            raise
        except Exception:
            # Do not expose HTTP headers, credentials, response bodies or paths.
            raise ToolError("zotero_unavailable") from None

    def metadata(library_type: str, library_id: str, key: str, version: int) -> dict:
        result = fetch(library_type, library_id, key)
        if result.get('key', result.get('data', {}).get('key')) != key:
            raise ToolError('source_identity_mismatch')
        if result.get('version', result.get('data', {}).get('version')) != version:
            raise ToolError('source_revision_changed')
        return result

    @server.tool
    def zotero_get_item_metadata(library_type: str, library_id: str, item_key: str) -> dict:
        """Read metadata of one authorized item; never searches a library."""
        item = source(library_type, library_id, item_key)
        return metadata(library_type, library_id, item_key, item['version'])

    @server.tool
    def zotero_get_item_children(library_type: str, library_id: str, item_key: str) -> list[dict]:
        """Read only attachments already authorized for this work, without notes or discovery."""
        item = source(library_type, library_id, item_key)
        return [metadata(library_type, library_id, attachment['key'], attachment['version']) for attachment in item.get('attachments', [])]

    @server.tool
    def zotero_get_item_fulltext(library_type: str, library_id: str, item_key: str, attachment_key: str) -> dict:
        """Read Zotero's existing fulltext for one authorized attachment. No indexing or OCR."""
        item = source(library_type, library_id, item_key)
        attachment = next((a for a in item.get('attachments', []) if a['key'] == attachment_key), None)
        if attachment is None:
            raise ToolError("attachment_not_authorized")
        metadata(library_type, library_id, attachment_key, attachment['version'])
        result = fetch(library_type, library_id, attachment_key, "/fulltext")
        metadata(library_type, library_id, attachment_key, attachment['version'])
        return {"itemKey": item_key, "attachmentKey": attachment_key,
                "revision": item["revision"], "provenance": "zotero-fulltext", "result": result}

    @server.tool
    def zotero_read_pdf_pages(library_type: str, library_id: str, item_key: str,
                             attachment_key: str, start_page: int, end_page: int) -> dict:
        """Read up to four physical PDF pages from an authorized revision staged by Nodus."""
        item = source(library_type, library_id, item_key)
        attachment = next((a for a in item.get("attachments", []) if a["key"] == attachment_key), None)
        if not attachment or not attachment.get("path"):
            raise ToolError("attachment_unavailable")
        file = Path(attachment["path"]).resolve(strict=True)
        if not file.is_relative_to(scope["root"]):
            raise ToolError("attachment_path_not_authorized")
        if start_page < 1 or end_page < start_page or end_page - start_page >= 4:
            raise ToolError("invalid_page_range")
        with file.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != attachment['sha256']:
                raise ToolError("source_revision_changed")
        metadata(library_type, library_id, attachment_key, attachment['version'])
        document = extract_pdf(file, pages=list(range(start_page - 1, end_page)))
        metadata(library_type, library_id, attachment_key, attachment['version'])
        with file.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != attachment['sha256']:
                raise ToolError('source_revision_changed')
        return {"itemKey": item_key, "attachmentKey": attachment_key, "revision": item["revision"],
                "attachmentVersion": attachment['version'], "attachmentSha256": attachment.get('sha256'),
                "pages": [{"pageNumber": n + 1, "text": text[:16000], "partial": len(text) > 16000} for n, text in zip(document.page_numbers, document.pages)],
                "needsOcr": [n + 1 for n in document.needs_ocr], "totalPages": document.page_count}

    return server


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("A managed source manifest is required")
    build_server(load_scope(sys.argv[1])).run(transport="stdio", show_banner=False)
