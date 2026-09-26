"""Inventory SearXNG's installed distributions from their actual bytes."""
import hashlib
import importlib.metadata
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(sys.argv[2])
legal = root / 'legal'
packages = []
for distribution in sorted(importlib.metadata.distributions(path=[str(root / 'dependencies')]), key=lambda d: d.metadata['Name'].lower()):
    metadata = distribution.metadata
    licenses = []
    for entry in distribution.files or []:
        if any(word in entry.name.lower() for word in ('license', 'copying', 'notice', 'copyright', 'authors')):
            target = pathlib.Path(distribution.locate_file(entry)).resolve()
            if target.is_relative_to(root) and target.is_file():
                licenses.append({'path': target.relative_to(root).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    declared = metadata.get('License-Expression') or metadata.get('License') or '; '.join(value for value in metadata.get_all('Classifier', []) if value.startswith('License ::'))
    if not declared or not licenses:
        raise RuntimeError(f'Missing license evidence for {metadata["Name"]}')
    packages.append({'name': metadata['Name'], 'version': metadata['Version'], 'declaredLicense': declared,
                     'projectUrls': metadata.get_all('Project-URL', []), 'licenseFiles': licenses})

searx_license = legal / 'SEARXNG_LICENSE.txt'
(legal / 'inventory.json').write_text(json.dumps({
    'searxng': {'commit': manifest['upstreamCommit'], 'source': manifest['upstreamUrl'], 'sha256': manifest['upstreamSha256'],
                'license': 'AGPL-3.0-or-later', 'licenseFile': {'path': searx_license.relative_to(root).as_posix(),
                'sha256': hashlib.sha256(searx_license.read_bytes()).hexdigest()}, 'modifications': 'searx/NODUS_MODIFICATIONS.txt'},
    'distributions': packages}, indent=2) + '\n')
lines = ['# Managed SearXNG third-party notices', '',
    f'SearXNG {manifest["upstreamCommit"]} (AGPL-3.0-or-later), distributed with Nodus under AGPL-3.0.',
    'Its complete source ships in searx/; searx/NODUS_MODIFICATIONS.txt lists the changes Nodus made.',
    'See SEARXNG_LICENSE.txt, SEARXNG_AUTHORS.rst and the Nodus Corresponding Source offer.',
    'It runs on the private CPython described in ../legal/ and serves only the local Nodus process.', '',
    '| Distribution | Version | License metadata |', '| --- | --- | --- |']
for package in packages:
    declared = package['declaredLicense'].splitlines()[0].replace('|', '/')
    lines.append(f'| {package["name"]} | {package["version"]} | {declared} |')
lines.extend(['', 'certifi retains its MPL license and Python source.',
              'curl_cffi bundles libcurl-impersonate; its wheel license files are listed in inventory.json.', ''])
(legal / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(lines))
