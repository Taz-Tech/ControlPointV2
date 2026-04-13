import os
import msal
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

TENANT_ID = lambda: os.getenv("AZURE_TENANT_ID", "")
CLIENT_ID = lambda: os.getenv("AZURE_CLIENT_ID", "")
CLIENT_SECRET = lambda: os.getenv("AZURE_CLIENT_SECRET", "")

GRAPH_SCOPE = ["https://graph.microsoft.com/.default"]

_app = None


def _get_app() -> msal.ConfidentialClientApplication:
    global _app
    # Always rebuild so updated .env credentials are picked up
    authority = f"https://login.microsoftonline.com/{TENANT_ID()}"
    _app = msal.ConfidentialClientApplication(
        CLIENT_ID(),
        authority=authority,
        client_credential=CLIENT_SECRET(),
    )
    return _app


def get_graph_token() -> str:
    """Acquire an application (client-credentials) token for MS Graph."""
    app = _get_app()
    result = app.acquire_token_silent(GRAPH_SCOPE, account=None)
    if not result:
        result = app.acquire_token_for_client(scopes=GRAPH_SCOPE)
    if "access_token" not in result:
        error = result.get("error_description", result.get("error", "Unknown MSAL error"))
        raise RuntimeError(f"Failed to acquire Graph token: {error}")
    return result["access_token"]


def is_azure_configured() -> bool:
    # Reload .env so runtime credential changes are detected
    load_dotenv(dotenv_path=env_path, override=True)
    return bool(TENANT_ID() and CLIENT_ID() and CLIENT_SECRET())
