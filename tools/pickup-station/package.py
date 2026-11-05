"""Build the deployment bundle from an explicit allowlist; never package local secrets."""
from pathlib import Path
import hashlib
import zipfile

base = Path(__file__).resolve().parent
names = [
    'Code.gs', 'Sheets.gs', 'Operations.gs', 'Access.gs', 'Index.html', 'appsscript.json',
    'config.sheet.example.json', 'config.example.json', 'README.md', 'PILOT-CHECKLIST.md',
]
contents = {name: (base / name).read_bytes() for name in names}
import re
server_build = re.search(r'function getBuild\(\) \{\s*return "([^"]+)"', contents['Code.gs'].decode()).group(1)
client_build = re.search(r'const clientBuild = "([^"]+)"', contents['Index.html'].decode()).group(1)
assert server_build == client_build, f'Build stamps differ: Code.gs {server_build}, Index.html {client_build}'
checksums = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in contents.items())
target = base / 'pickup-station-deployment.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in contents.items():
        archive.writestr('pickup-station/' + name, data)
    archive.writestr('pickup-station/SHA256SUMS', checksums)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    for name, data in contents.items():
        assert hashlib.sha256(archive.read('pickup-station/' + name)).digest() == hashlib.sha256(data).digest()
print(f'Verified {target.name}: {len(names)} deployment files plus SHA256SUMS. Build {server_build}.')
