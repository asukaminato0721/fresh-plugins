#!/usr/bin/env bash
# Requires Python 3, jsonschema, and PyYAML.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
python3 - <<'PY'
import json
import os
from pathlib import Path
from urllib.request import urlopen

import jsonschema
import yaml

manifest = json.loads(Path('package.json').read_text())
schema_path = os.environ.get('FRESH_PACKAGE_SCHEMA')
if schema_path:
    schema = json.loads(Path(schema_path).read_text())
else:
    with urlopen(manifest['$schema'], timeout=30) as response:
        schema = json.load(response)
jsonschema.validate(manifest, schema)
fresh = manifest['fresh']
pack = fresh['languages'][0] if manifest['type'] == 'bundle' else fresh
grammar_path = Path(pack['grammar']['file'])
grammar = yaml.safe_load(grammar_path.read_text())
assert 'extends' not in grammar, 'External grammar inheritance is not supported'
assert 'main' in grammar['contexts'], 'The grammar must have a main context'
assert grammar['file_extensions'] == pack['grammar']['extensions'], 'Extension lists differ'
assert grammar_path.with_name('LICENSE').is_file(), 'The grammar license is missing'
assert Path('LICENSE').is_file(), 'The package license is missing'
print(f"{manifest['name']}: manifest and grammar structure are valid")
PY
