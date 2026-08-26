import fs from 'node:fs';
import path from 'node:path';

const stripGitSuffix = (value) => String(value).replace(/\.git$/, '');

export function loadSiteMetadata(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const release = packageJson.releaseMetadata || {};
  const repositoryValue = typeof packageJson.repository === 'string'
    ? packageJson.repository
    : packageJson.repository?.url;
  const repository = stripGitSuffix(repositoryValue || '');
  const author = typeof packageJson.author === 'string'
    ? { name: packageJson.author, url: '' }
    : packageJson.author || {};

  const versionDoi = release.versionDoi || null;
  const metadata = {
    siteUrl: String(packageJson.homepage || '').replace(/\/+$/, ''),
    websiteId: `${String(packageJson.homepage || '').replace(/\/+$/, '')}/#website`,
    softwareId: `${String(packageJson.homepage || '').replace(/\/+$/, '')}/#software`,
    authorId: `${String(packageJson.homepage || '').replace(/\/+$/, '')}/#creator`,
    projectName: 'Nodus Research',
    softwareName: 'Nodus',
    version: packageJson.version,
    releaseTag: `v${packageJson.version}`,
    releaseDate: release.dateReleased,
    conceptDoi: release.conceptDoi,
    versionDoi,
    citationDoi: versionDoi || release.conceptDoi,
    versionDoiPending: !versionDoi,
    license: packageJson.license,
    licenseUrl: `https://spdx.org/licenses/${packageJson.license}.html`,
    repository,
    authorName: author.name,
    orcid: author.url,
    socialImage: `${String(packageJson.homepage || '').replace(/\/+$/, '')}/assets/social/nodus-research-og.png`,
  };

  for (const key of ['siteUrl', 'websiteId', 'softwareId', 'authorId', 'projectName', 'softwareName', 'version', 'releaseTag', 'releaseDate', 'conceptDoi', 'citationDoi', 'license', 'licenseUrl', 'repository', 'authorName', 'orcid', 'socialImage']) {
    if (!metadata[key]) throw new Error(`package.json is missing site metadata: ${key}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error(`Invalid release version: ${metadata.version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.releaseDate)) throw new Error(`Invalid release date: ${metadata.releaseDate}`);
  for (const doi of [metadata.conceptDoi, metadata.versionDoi].filter(Boolean)) {
    if (!/^10\.5281\/zenodo\.\d+$/.test(doi)) throw new Error(`Invalid Zenodo DOI: ${doi}`);
  }
  if (metadata.versionDoi && metadata.conceptDoi === metadata.versionDoi) {
    throw new Error('The all-versions concept DOI and immutable version DOI must remain distinct.');
  }
  return Object.freeze(metadata);
}

export function personEntity(metadata) {
  return {
    '@type': 'Person',
    '@id': metadata.authorId,
    name: metadata.authorName,
    url: metadata.orcid,
    sameAs: [metadata.orcid],
  };
}

export function websiteEntity(metadata) {
  return {
    '@type': 'WebSite',
    '@id': metadata.websiteId,
    url: `${metadata.siteUrl}/`,
    name: metadata.projectName,
    alternateName: ['nodusresearch.com'],
    description: 'Nodus Research is the independent open-source project behind the Nodus desktop application.',
    inLanguage: 'en',
    creator: { '@id': metadata.authorId },
  };
}

export function softwareEntity(metadata) {
  const identifiers = [
    { '@type': 'PropertyValue', propertyID: 'Concept DOI', value: metadata.conceptDoi },
    ...(metadata.versionDoi
      ? [{ '@type': 'PropertyValue', propertyID: 'Version DOI', value: metadata.versionDoi }]
      : []),
    { '@type': 'PropertyValue', propertyID: 'Release tag', value: metadata.releaseTag },
  ];
  const sameAs = [
    metadata.repository,
    `https://doi.org/${metadata.conceptDoi}`,
    ...(metadata.versionDoi ? [`https://doi.org/${metadata.versionDoi}`] : []),
  ];
  return {
    '@type': 'SoftwareApplication',
    '@id': metadata.softwareId,
    name: metadata.softwareName,
    url: `${metadata.siteUrl}/app/`,
    isPartOf: { '@id': metadata.websiteId },
    applicationCategory: 'EducationalApplication',
    applicationSubCategory: 'Academic research workspace',
    operatingSystem: 'macOS, Windows, Linux',
    description: 'Nodus is a free, open-source, local-first desktop workspace for academic research. It connects sources, ideas and evidence, supports Zotero libraries and semantic search, and keeps the research corpus on the researcher’s own computer.',
    softwareVersion: metadata.version,
    datePublished: metadata.releaseDate,
    releaseNotes: `${metadata.repository}/releases/tag/${metadata.releaseTag}`,
    license: metadata.licenseUrl,
    codeRepository: metadata.repository,
    isAccessibleForFree: true,
    downloadUrl: `${metadata.repository}/releases/latest`,
    softwareHelp: `${metadata.siteUrl}/wiki/`,
    identifier: identifiers,
    sameAs,
    author: { '@id': metadata.authorId },
    creator: { '@id': metadata.authorId },
  };
}

export function formatReleaseDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
