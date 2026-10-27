# SharePoint delegated upload POC

This isolated script tests whether the signed-in user's SharePoint permissions allow a tiny upload to:

`Documentos compartidos/General/Archivos RCA Problems`

It uses Microsoft Graph and interactive delegated authentication. It never uses client credentials, creates folders, recreates the deleted `Iniciativas` folder, or changes the dashboard, database, Power Automate, or Entra app registration.

## Required delegated Graph permissions

The app registration currently has `User.Read` (Delegated), which supports sign-in/profile access but not this POC's Graph calls. Microsoft Graph documents these least-privileged delegated permissions for the requested operations:

- `Sites.Read.All` — required to resolve the specific SharePoint site and enumerate its document libraries.
- `Files.ReadWrite` — required to inspect the folder and upload a small file.

The script requests exactly these two scopes. It does not change app permissions or request admin consent. A tenant policy may require an administrator to grant consent; if so, the script reports the token acquisition failure and stops. The user's SharePoint folder access still governs the effective content access; delegated Graph scopes do not themselves grant that folder access.

References: [Get a SharePoint site](https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0) and [Upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0).

## Prerequisites

- Python 3.10 or newer.
- The RCA Dashboard app registration's **Application (client) ID**.
- The app registration configured as a public client/desktop app for interactive authentication (no client secret).
- Consent to the two delegated scopes above, subject to Soriana's Entra consent policy.

## Run (PowerShell)

From this folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:AZURE_CLIENT_ID = "<RCA Dashboard application client ID>"
python .\sharepoint_upload_poc.py
```

MSAL opens the system browser for corporate account sign-in. No username or password is collected by the script. To clear the client ID from the current PowerShell session afterward:

```powershell
Remove-Item Env:AZURE_CLIENT_ID
```

The script prints progress for authentication, token acquisition, site/library/folder lookup, and upload. It never prints access tokens. A successful run creates `RCA_Dashboard_upload_test.txt` in the target folder with the content `RCA Dashboard SharePoint upload POC`; remove that test file manually from SharePoint when finished.
