"""Inventory licenses from the actual installed distributions, not a lock guess."""
import hashlib
import importlib.metadata
import json
import pathlib
import ssl
import sys

root = pathlib.Path(sys.argv[1]).resolve()
legal = root / 'legal'
packages = []
overrides = json.loads((pathlib.Path(__file__).parent / 'license_overrides.json').read_text())
for distribution in sorted(importlib.metadata.distributions(path=[str(root / 'dependencies')]), key=lambda d: d.metadata['Name'].lower()):
    metadata = distribution.metadata
    licenses = []
    for entry in distribution.files or []:
        if any(word in entry.name.lower() for word in ('license', 'copying', 'notice', 'copyright')):
            target = pathlib.Path(distribution.locate_file(entry)).resolve()
            if target.is_relative_to(root) and target.is_file():
                licenses.append({'path': target.relative_to(root).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    override = overrides.get(metadata['Name'])
    if override:
        target = legal / 'supplemental' / override['file']
        if distribution.version != override['version'] or hashlib.sha256(target.read_bytes()).hexdigest() != override['sha256']:
            raise RuntimeError('License supplement does not match the pinned release')
        licenses.append({'path': target.relative_to(root).as_posix(), 'sha256': override['sha256'], 'source': override['source']})
    declared = metadata.get('License-Expression') or metadata.get('License') or '; '.join(value for value in metadata.get_all('Classifier', []) if value.startswith('License ::'))
    if not declared or not licenses:
        raise RuntimeError(f'Missing license evidence for {metadata["Name"]}')
    packages.append({'name': metadata['Name'], 'version': metadata['Version'], 'declaredLicense': declared,
                     'projectUrls': metadata.get_all('Project-URL', []), 'licenseFiles': licenses})

python = json.loads((legal / 'python' / 'PYTHON.json').read_text())
native = []
for name, variants in python['build_info']['extensions'].items():
    for variant in variants:
        paths = variant.get('license_paths', [])
        for relative in paths:
            if not (legal / 'python' / relative).is_file():
                raise RuntimeError(f'Missing native license: {relative}')
        if paths or variant.get('licenses'):
            native.append({'module': name, 'licenses': variant.get('licenses', []), 'licensePaths': paths})
(legal / 'inventory.json').write_text(json.dumps({'pythonVersion': python['python_version'], 'target': python['target_triple'],
    'runtimeOpenSSL': ssl.OPENSSL_VERSION, 'pythonLicenses': python['licenses'], 'nativeModules': native, 'distributions': packages}, indent=2) + '\n')
lines = ['# Managed Zotero MCP third-party notices', '',
    'This private runtime is updated and removed with Nodus. Executables are separate from profile data.',
    'The inventory records installed bytes; every referenced license text accompanies the application.',
    'Zotero MCP: MIT; Nodus adapter: AGPL-3.0-only. See ZOTERO_MCP_LICENSE.txt and the Nodus source offer.', '',
    'CPython and linked native components: see python/PYTHON.json and python/licenses/.', '',
    '| Distribution | Version | License metadata |', '| --- | --- | --- |']
for package in packages:
    declared = package['declaredLicense'].splitlines()[0].replace('|', '/')
    lines.append(f'| {package["name"]} | {package["version"]} | {declared} |')
lines.extend(['', 'Unidecode includes GPL source modules and its full license in dependencies/.',
              'bibtexparser offers BSD as an alternative to LGPL; its COPYING text is retained.',
              'certifi retains its MPL license and Python source. No semantic model weights are distributed.', ''])
(legal / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(lines))
