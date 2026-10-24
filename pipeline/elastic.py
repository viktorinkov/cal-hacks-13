import json
import os

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'pipeline', 'data')

MAPPINGS = {
    'radio': {
        '@timestamp': {'type': 'date'},
        'session': {'type': 'keyword'},
        'kind': {'type': 'keyword'},
        'id': {'type': 'integer'},
        'gateway_t': {'type': 'long'},
        'rssi_gateway': {'type': 'byte'},
        'flags': {'type': 'byte'},
        'sos': {'type': 'boolean'},
        'fall': {'type': 'boolean'},
        'pressed': {'type': 'boolean'},
        'neigh': {'type': 'byte'},
        'zone': {'type': 'integer'},
        'bat': {'type': 'short'},
        'state': {'type': 'byte'},
        'seq': {'type': 'integer'},
        'find': {'type': 'integer'},
        'exit_colour': {'type': 'byte'},
    },
    'heard': {
        '@timestamp': {'type': 'date'},
        'session': {'type': 'keyword'},
        'id': {'type': 'integer'},
        'gateway_t': {'type': 'long'},
        'rssi_gateway': {'type': 'byte'},
        'neighbours': {'type': 'nested', 'properties': {'id': {'type': 'integer'}, 'rssi': {'type': 'byte'}}},
        'stations': {'type': 'object'},
        'station_vector': {'type': 'dense_vector', 'dims': 5, 'similarity': 'l2_norm'},
    },
    'gateway': {
        '@timestamp': {'type': 'date'},
        'session': {'type': 'keyword'},
        'event': {'type': 'keyword'},
        'raw': {'type': 'text'},
    },
    'photos': {
        '@timestamp': {'type': 'date'},
        'camera_time': {'type': 'keyword'},
        'offset_s': {'type': 'float'},
        'sync': {'type': 'boolean'},
        'name': {'type': 'keyword'},
        'file': {'type': 'keyword'},
        'sha1': {'type': 'keyword'},
        'make': {'type': 'keyword'},
        'model': {'type': 'keyword'},
        'width': {'type': 'integer'},
        'height': {'type': 'integer'},
        'session': {'type': 'keyword'},
    },
}


def load_env():
    path = os.path.join(ROOT, '.env')
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())


class Elastic:
    def __init__(self, prefix='bandit'):
        load_env()
        self.url = os.environ.get('ELASTICSEARCH_URL', '').rstrip('/')
        key = os.environ.get('ELASTICSEARCH_API_KEY', '')
        if not self.url or not key:
            raise SystemExit('ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY must be set in .env')
        self.prefix = prefix
        self.http = requests.Session()
        self.http.headers.update({'Authorization': f'ApiKey {key}'})
        self.ready = set()

    def index(self, kind):
        return f'{self.prefix}-{kind}'

    def ensure(self, kind):
        name = self.index(kind)
        if name in self.ready:
            return name
        r = self.http.head(f'{self.url}/{name}', timeout=15)
        if r.status_code == 404:
            r = self.http.put(f'{self.url}/{name}', json={'mappings': {'properties': MAPPINGS[kind]}}, timeout=30)
            if r.status_code >= 300 and 'resource_already_exists' not in r.text:
                raise RuntimeError(f'creating {name}: {r.status_code} {r.text[:300]}')
        self.ready.add(name)
        return name

    def bulk(self, kind, docs):
        if not docs:
            return 0
        name = self.ensure(kind)
        lines = []
        for doc_id, doc in docs:
            lines.append(json.dumps({'index': {'_index': name, '_id': doc_id}}))
            lines.append(json.dumps(doc, separators=(',', ':')))
        r = self.http.post(f'{self.url}/_bulk', data='\n'.join(lines) + '\n',
                           headers={'Content-Type': 'application/x-ndjson'}, timeout=60)
        r.raise_for_status()
        body = r.json()
        if body.get('errors'):
            bad = [i for i in body['items'] if i['index'].get('error')]
            raise RuntimeError(f'{len(bad)} of {len(docs)} rejected, first: {bad[0]["index"]["error"]}')
        return len(docs)

    def count(self, kind, session=None):
        q = {'query': {'term': {'session': session}}} if session else {}
        r = self.http.post(f'{self.url}/{self.index(kind)}/_count', json=q, timeout=15)
        return r.json().get('count', 0) if r.ok else 0
