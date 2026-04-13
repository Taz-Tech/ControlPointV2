from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env', override=True)

import os, msal, urllib.request, urllib.parse, json

tid = os.getenv('AZURE_TENANT_ID')
cid = os.getenv('AZURE_CLIENT_ID')
sec = os.getenv('AZURE_CLIENT_SECRET')

print(f'Tenant: {tid[:8]}...')
print(f'Client: {cid[:8]}...')
print(f'Secret set: {bool(sec)}')

app = msal.ConfidentialClientApplication(
    cid, authority=f'https://login.microsoftonline.com/{tid}', client_credential=sec
)
result = app.acquire_token_for_client(scopes=['https://graph.microsoft.com/.default'])

if 'access_token' not in result:
    print('TOKEN FAILED:', result.get('error_description', result.get('error')))
    exit(1)

print('Token: OK')
token = result['access_token']

q = 'a'
filter_expr = f"startswith(displayName,'{q}') or startswith(mail,'{q}') or startswith(userPrincipalName,'{q}')"
params = urllib.parse.urlencode({'$filter': filter_expr, '$select': 'displayName,mail', '$top': '5'})
req = urllib.request.Request(
    f'https://graph.microsoft.com/v1.0/users?{params}',
    headers={'Authorization': f'Bearer {token}'}
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        print(f'Graph /users search: SUCCESS. Users returned: {len(data.get("value", []))}')
        for u in data.get('value', []):
            print(' -', u.get('displayName'), u.get('mail'))
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f'Graph /users search FAILED: HTTP {e.code}')
    print(body)
