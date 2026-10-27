"""Delegated Microsoft Graph upload proof of concept for one SharePoint folder."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import msal


TENANT_ID = "soriana.com"
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
GRAPH = "https://graph.microsoft.com/v1.0"
SITE_HOST = "soriana0.sharepoint.com"
SITE_PATH = "/sites/ProblemManagement"
LIBRARY_NAME = "Documentos compartidos"
FOLDER_PATH = "General/Archivos RCA Problems"
FILE_NAME = "RCA_Dashboard_upload_test.txt"
FILE_CONTENT = b"RCA Dashboard SharePoint upload POC"

# Site lookup requires Sites.Read.All; the actual upload requires Files.ReadWrite.
SCOPES = ["Sites.Read.All", "Files.ReadWrite"]


class GraphError(RuntimeError):
    def __init__(self, method: str, url: str, status: int, message: str):
        self.method = method
        self.url = url
        self.status = status
        self.message = message
        super().__init__(f"{method} {url} returned HTTP {status}: {message}")


def graph_request(token: str, method: str, path: str, body: bytes | None = None) -> dict[str, Any]:
    url = f"{GRAPH}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "text/plain; charset=utf-8"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            error = json.loads(raw).get("error", {})
            message = error.get("message") or raw or exc.reason
        except (json.JSONDecodeError, AttributeError):
            message = raw or str(exc.reason)
        # Graph error bodies are diagnostic data; do not include request headers.
        raise GraphError(method, url, exc.code, message) from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error calling {method} {url}: {exc.reason}") from None
    return json.loads(payload.decode("utf-8")) if payload else {}


def encoded_path(path: str) -> str:
    return "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))


def report_error(stage: str, error: Exception) -> None:
    print(f"{stage}: FAILED")
    print(f"  {error}")
    if isinstance(error, GraphError) and error.status in (401, 403):
        print("  Check that the listed delegated Graph permissions are present and consented,")
        print("  and that the signed-in user has access to this SharePoint folder.")


def main() -> int:
    client_id = os.environ.get("AZURE_CLIENT_ID", "").strip()
    if not client_id:
        print("Configuration: FAILED — set AZURE_CLIENT_ID to the RCA Dashboard app's client ID.")
        return 2

    print("Authentication: starting interactive sign-in for the soriana.com tenant")
    app = msal.PublicClientApplication(client_id=client_id, authority=AUTHORITY)
    try:
        result = app.acquire_token_interactive(
            scopes=SCOPES,
            prompt="select_account",
            parent_window_handle=0,
        )
    except Exception as exc:
        report_error("Authentication/token acquisition", exc)
        return 1

    token = result.get("access_token")
    if not token:
        # MSAL error fields do not contain bearer tokens; never print the result wholesale.
        print("Authentication: FAILED")
        print(f"  {result.get('error', 'unknown_error')}: {result.get('error_description', 'No access token returned')}")
        print("  Requested delegated scopes: Sites.Read.All and Files.ReadWrite.")
        print("  The existing User.Read permission alone is insufficient for these Graph operations.")
        return 1
    print("Authentication: SUCCEEDED")
    print("Graph token acquisition: SUCCEEDED (token value withheld)")

    try:
        site = graph_request(
            token,
            "GET",
            f"/sites/{SITE_HOST}:{urllib.parse.quote(SITE_PATH, safe='/')}?\u0024select=id,displayName,webUrl",
        )
        print(f"Site discovery: SUCCEEDED — {site.get('displayName', '(unnamed)')} ({site.get('id')})")
    except Exception as exc:
        report_error("Site discovery", exc)
        return 1

    try:
        drives = graph_request(token, "GET", f"/sites/{urllib.parse.quote(site['id'], safe=',')}/drives")
        drive_list = drives.get("value", [])
        drive = next(
            (item for item in drive_list if item.get("name", "").casefold() == LIBRARY_NAME.casefold()),
            None,
        )
        if drive is None:
            choices = ", ".join(item.get("name", "(unnamed)") for item in drive_list) or "none returned"
            raise RuntimeError(f"Library '{LIBRARY_NAME}' not found. Libraries returned: {choices}")
        print(f"Drive/library discovery: SUCCEEDED — {drive.get('name')} ({drive.get('id')})")
    except Exception as exc:
        report_error("Drive/library discovery", exc)
        return 1

    try:
        folder = graph_request(
            token,
            "GET",
            f"/drives/{urllib.parse.quote(drive['id'], safe=',')}/root:/{encoded_path(FOLDER_PATH)}",
        )
        if "folder" not in folder:
            raise RuntimeError(f"Resolved path is not a folder: {FOLDER_PATH}")
        print(f"Folder discovery: SUCCEEDED — {FOLDER_PATH} ({folder.get('id')})")
    except Exception as exc:
        report_error("Folder discovery", exc)
        return 1

    try:
        upload_path = encoded_path(f"{FOLDER_PATH}/{FILE_NAME}")
        item = graph_request(
            token,
            "PUT",
            f"/drives/{urllib.parse.quote(drive['id'], safe=',')}/root:/{upload_path}:/content",
            body=FILE_CONTENT,
        )
        print("Upload: SUCCEEDED")
        print(f"  Item ID: {item.get('id', 'not returned')}")
        print(f"  Web URL: {item.get('webUrl', 'not returned')}")
        return 0
    except Exception as exc:
        report_error("Upload", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
