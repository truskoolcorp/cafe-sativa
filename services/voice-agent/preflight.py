"""Fail clearly on configuration gaps, without ever printing secret values."""
import os
from urllib.parse import urlparse

REQUIRED = ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
            'CS_LIVEKIT_AGENT_NAME', 'CS_VOICE_LLM_MODEL', 'OPENAI_API_KEY',
            'DEEPGRAM_API_KEY', 'ELEVEN_API_KEY')

def missing_configuration(environ):
    missing = [name for name in REQUIRED if not environ.get(name, '').strip()]
    url = urlparse(environ.get('LIVEKIT_URL', ''))
    if 'LIVEKIT_URL' not in missing and (url.scheme != 'wss' or not url.hostname or url.username or url.password):
        missing.append('LIVEKIT_URL (valid wss endpoint required)')
    if environ.get('CS_LIVEKIT_AGENT_NAME') != 'cafe-sativa-hosts':
        missing.append('CS_LIVEKIT_AGENT_NAME (dedicated cafe-sativa-hosts required)')
    return missing

if __name__ == '__main__':
    missing = missing_configuration(os.environ)
    if missing:
        raise SystemExit('Voice worker configuration incomplete: ' + ', '.join(missing))
    print('Café Sativa voice worker configuration present; live registration still required.')
