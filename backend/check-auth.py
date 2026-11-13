#!/usr/bin/env python3
"""Read-only hosted auth/deployment checks. Never prints keys, tokens or OAuth state."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'ntbkbvlsgymupjdpuvob'
APP = 'https://cleopos.online'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, headers=None):
    try:
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(urllib.request.Request(url, headers=headers or {}), timeout=20) as response:
            return response.status, response.read(8_000_000), response.headers
    except urllib.error.HTTPError as error:
        return error.code, b'', error.headers
    except (urllib.error.URLError, TimeoutError):
        return None, b'', {}


def main():
    public = {}
    env_file = Path(__file__).resolve().parents[1] / '.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                if key in ('CLEO_SUPABASE_URL', 'CLEO_SUPABASE_PUBLISHABLE_KEY'):
                    public[key] = value.strip().strip('\"\'')
    public.update({k: os.environ[k] for k in ('CLEO_SUPABASE_URL', 'CLEO_SUPABASE_PUBLISHABLE_KEY') if k in os.environ})
    key = public.get('CLEO_SUPABASE_PUBLISHABLE_KEY', '')
    # Keep destinations fixed: proxy-backed credentials must never follow a caller-supplied URL.
    api = 'https://' + PROJECT + '.supabase.co'
    results = {}
    code, body, _ = request(api + '/auth/v1/settings', {'apikey': key})
    results['public_auth_http'] = code
    if code == 200:
        settings = json.loads(body)
        results['facebook_enabled'] = settings.get('external', {}).get('facebook') is True
        results['email_enabled'] = settings.get('external', {}).get('email') is True
        results['signups_allowed'] = settings.get('disable_signup') is False
        results['email_confirmation_required'] = settings.get('mailer_autoconfirm') is False
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if token:
        code, body, _ = request('https://api.supabase.com/v1/projects/' + PROJECT + '/config/auth', {'Authorization': 'Bearer ' + token})
        results['management_auth_http'] = code
        if code == 200:
            config = json.loads(body)
            # Never print the full auth config: it contains provider/SMTP secrets.
            results['site_url_matches'] = config.get('site_url', '').rstrip('/') == APP
            redirects = config.get('uri_allow_list', '')
            if isinstance(redirects, str):
                redirects = [x.strip() for x in redirects.split(',')]
            results['app_redirect_present'] = any(x in redirects for x in (APP + '/index.html', APP + '/index.html**'))
    else:
        results['management_checks'] = 'blocked: SUPABASE_ACCESS_TOKEN is not bound'
    code, page, _ = request(APP + '/index.html')
    results['deployed_app_http'] = code
    if code == 200:
        title = re.search(rb'<title[^>]*>(.*?)</title>', page, re.IGNORECASE | re.DOTALL)
        results['deployed_title'] = title[1].decode(errors='replace')[:200] if title else None
        results['deployed_app_is_cleo'] = bool(re.search(rb'id=[\"\']cleo-env[\"\']', page))
        match = re.search(rb'<script[^>]+src="assets/vendor/supabase-js-2\.118\.0\.js"[^>]+integrity="(sha384-[^"]+)"', page)
        code, sdk, headers = request(APP + '/assets/vendor/supabase-js-2.118.0.js')
        results['deployed_sdk_http'] = code
        if code == 200:
            results['deployed_sdk_javascript'] = headers.get('Content-Type', '').split(';')[0] in ('text/javascript', 'application/javascript')
            digest = 'sha384-' + base64.b64encode(hashlib.sha384(sdk).digest()).decode()
            results['deployed_sdk_integrity'] = bool(match and digest == match[1].decode())
    print(json.dumps(results, indent=2))
    required = ('facebook_enabled', 'email_enabled', 'signups_allowed', 'email_confirmation_required',
                'site_url_matches', 'app_redirect_present', 'deployed_app_is_cleo', 'deployed_sdk_javascript', 'deployed_sdk_integrity')
    return 0 if all(results.get(name) is True for name in required) else 2


if __name__ == '__main__':
    sys.exit(main())
