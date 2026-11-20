import os
from urllib.parse import urlparse
from dotenv import dotenv_values
from .db import ROOT, PROVIDER_ENV_OVERRIDES

def provider_settings():
    # Refresh provider settings on requests; never expose the API key to clients.
    values = dotenv_values(ROOT / '.env')
    defaults = {'DEEPSEEK_API_KEY':'', 'DEEPSEEK_MODEL':'deepseek-v4.1-flash', 'DEEPSEEK_URL':'', 'DEEPSEEK_BASE_URL':''}
    settings = {key: (os.getenv(key, default) if key in PROVIDER_ENV_OVERRIDES else values.get(key, os.getenv(key, default))) or default
                for key, default in defaults.items()}
    endpoint = settings['DEEPSEEK_URL'].strip()
    if not endpoint:
        legacy = settings['DEEPSEEK_BASE_URL'].strip().rstrip('/')
        endpoint = (legacy if legacy.endswith('/chat/completions') else legacy + '/chat/completions') if legacy else 'https://api.chatanywhere.org/v1/chat/completions'
    settings['DEEPSEEK_URL'] = endpoint
    settings['provider'] = 'ChatAnywhere' if (urlparse(endpoint).hostname or '').lower().endswith(('.chatanywhere.org', '.chatanywhere.tech')) else 'Провайдер модели'
    return settings
