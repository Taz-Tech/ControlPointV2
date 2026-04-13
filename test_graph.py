import os
import json
import base64
from dotenv import load_dotenv
import msal

load_dotenv("backend/.env")

TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

print("Checking", CLIENT_ID)

app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    client_credential=CLIENT_SECRET,
)

import requests

result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
if "access_token" in result:
    token = result["access_token"]
    print("TOKEN FETCHED SUCCESSFULLY!")
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # Let's test basic /users
    print("Testing basic /users endpoint...")
    r1 = requests.get("https://graph.microsoft.com/v1.0/users?$top=5", headers=headers)
    print("Status:", r1.status_code)
    if r1.status_code >= 400:
        print("Error:", r1.text)
    
    # Let's test the advanced search that failed
    print("\nTesting advanced search endpoint...")
    filter_expr = "startswith(displayName,'test') or startswith(mail,'test') or startswith(userPrincipalName,'test')"
    params = {"$filter": filter_expr, "$top": "5", "$count": "true"}
    headers_advanced = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "ConsistencyLevel": "eventual"}
    r2 = requests.get("https://graph.microsoft.com/v1.0/users", headers=headers_advanced, params=params)
    print("Status:", r2.status_code)
    if r2.status_code >= 400:
        print("Error:", r2.text)
else:
    print("ERROR FETCHING TOKEN:", result)

