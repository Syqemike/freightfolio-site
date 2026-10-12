#!/bin/bash
# Fetch Cloudflare Pages deployment logs
TOKEN=$(python3 -c "import json; print(json.load(open('/home/hatch/workspace/user/.credentials/cloudflare.json'))['api_token'])")
ACCOUNT="f7394d5f133c3e5f63e5e2b6c118ab15"
DEPLOY_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/freightfolio/deployments?per_page=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result'][0]['id'])")
curl -s -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/freightfolio/deployments/$DEPLOY_ID/history/logs" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for entry in d['result']['data']:
    line = entry.get('line', '')
    # Filter for errors and important lines
    if any(kw in line.lower() for kw in ['error', 'failed', 'could not', 'no matching', 'build']):
        print(line[:200])
"
