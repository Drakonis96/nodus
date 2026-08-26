import type {
  CompassProviderAdapter,
  CompassProviderId,
  CompassPublicationType,
} from "@shared/compass";
import { providerDescriptor } from "./catalog";
import {
  adapter,
  author,
  downloadLink,
  identifier,
  page,
  queryFor,
  requestJson,
  result,
  text,
} from "./provider";

const authors = (values: unknown[]) =>
  values
    .map(author)
    .filter((entry): entry is NonNullable<ReturnType<typeof author>> =>
      Boolean(entry),
    );
const typeOf = (value: unknown): CompassPublicationType => {
  const key = text(value).toLocaleLowerCase();
  return /thesis|dissertation/.test(key)
    ? "thesis"
    : /dataset|data set/.test(key)
      ? "dataset"
      : /report/.test(key)
        ? "report"
        : /preprint|working paper/.test(key)
          ? "preprint"
          : /book/.test(key)
            ? "book"
            : /chapter/.test(key)
              ? "chapter"
              : "article";
};

function hal(): CompassProviderAdapter {
  return adapter(providerDescriptor("hal"), async (context) => {
    const url = new URL("https://api.archives-ouvertes.fr/search/");
    const cursor = context.cursor ?? "*";
    const escaped = queryFor(context).replace(
      /([+\-!(){}[\]^"~*?:\\/])/g,
      "\\$1",
    );
    url.searchParams.set("q", `(${escaped})`);
    url.searchParams.set("rows", "25");
    url.searchParams.set("wt", "json");
    url.searchParams.set("cursorMark", cursor);
    url.searchParams.set("sort", "docid asc");
    url.searchParams.set(
      "fl",
      "docid,title_s,authFullName_s,producedDateY_i,producedDate_s,uri_s,doiId_s,abstract_s,language_s,docType_s,fileMain_s,license_s,keyword_s",
    );
    const fq = [
      context.query.fromYear || context.query.toYear
        ? `producedDateY_i:[${context.query.fromYear ?? "*"} TO ${context.query.toYear ?? "*"}]`
        : "",
      context.query.openAccessOnly ? "openAccess_bool:true" : "",
    ].filter(Boolean);
    for (const filter of fq) url.searchParams.append("fq", filter);
    const { data } = await requestJson(url.toString(), context.signal);
    const records = (data?.response?.docs ?? []).map((doc: any) => {
      const file = Array.isArray(doc?.fileMain_s)
        ? doc.fileMain_s[0]
        : doc?.fileMain_s;
      const dl = downloadLink("hal", file, {
        mediaType: "application/pdf",
        license: Array.isArray(doc?.license_s)
          ? doc.license_s[0]
          : doc?.license_s,
      });
      const value = result({
        provider: "hal",
        providerId: doc?.docid,
        title: Array.isArray(doc?.title_s) ? doc.title_s[0] : doc?.title_s,
        abstract: Array.isArray(doc?.abstract_s)
          ? doc.abstract_s[0]
          : doc?.abstract_s,
        authors: authors(
          Array.isArray(doc?.authFullName_s)
            ? doc.authFullName_s
            : [doc?.authFullName_s],
        ),
        year: Number(doc?.producedDateY_i) || undefined,
        issuedDate: Array.isArray(doc?.producedDate_s)
          ? doc.producedDate_s[0]
          : doc?.producedDate_s,
        url: Array.isArray(doc?.uri_s) ? doc.uri_s[0] : doc?.uri_s,
        doi: Array.isArray(doc?.doiId_s) ? doc.doiId_s[0] : doc?.doiId_s,
        language: Array.isArray(doc?.language_s)
          ? doc.language_s[0]
          : doc?.language_s,
        type: typeOf(
          Array.isArray(doc?.docType_s) ? doc.docType_s[0] : doc?.docType_s,
        ),
        downloads: dl ? [dl] : [],
      });
      value.topics = (Array.isArray(doc?.keyword_s) ? doc.keyword_s : []).slice(
        0,
        20,
      );
      if (dl)
        value.openAccess = {
          status: "green",
          url: dl.url,
          license: dl.license,
          provider: "hal",
          verifiedAt: dl.verifiedAt,
        };
      return value;
    });
    return page(
      records,
      "hal",
      data?.nextCursorMark && data.nextCursorMark !== cursor
        ? data.nextCursorMark
        : undefined,
      "HAL",
    );
  });
}

function datacite(): CompassProviderAdapter {
  return adapter(providerDescriptor("datacite"), async (context) => {
    const pageNumber = Math.max(1, Number(context.cursor ?? 1));
    const doi = context.query.identifiers.find(
      (entry) => entry.scheme === "doi",
    )?.value;
    const url = new URL(
      doi
        ? `https://api.datacite.org/dois/${encodeURIComponent(doi)}`
        : "https://api.datacite.org/dois",
    );
    if (!doi) {
      url.searchParams.set("query", queryFor(context));
      url.searchParams.set("page[size]", "25");
      url.searchParams.set("page[number]", String(pageNumber));
      if (context.query.fromYear || context.query.toYear)
        url.searchParams.set(
          "query",
          `${queryFor(context)} AND published:[${context.query.fromYear ?? "*"} TO ${context.query.toYear ?? "*"}]`,
        );
    }
    const { data } = await requestJson(url.toString(), context.signal);
    const entries = doi ? [data?.data] : (data?.data ?? []);
    const records = entries.filter(Boolean).map((entry: any) => {
      const attrs = entry?.attributes ?? {};
      const content = (attrs?.contentUrl ?? [])
        .map((link: unknown) =>
          downloadLink("datacite", link, {
            license: attrs?.rightsList?.[0]?.rightsIdentifier,
          }),
        )
        .filter(Boolean) as NonNullable<ReturnType<typeof downloadLink>>[];
      const value = result({
        provider: "datacite",
        providerId: entry?.id,
        title: attrs?.titles?.[0]?.title,
        abstract: attrs?.descriptions?.[0]?.description,
        authors: authors(
          (attrs?.creators ?? []).map((creator: any) => ({
            name: creator?.name,
            given: creator?.givenName,
            family: creator?.familyName,
          })),
        ),
        year: Number(attrs?.publicationYear) || undefined,
        issuedDate: attrs?.dates?.[0]?.date,
        url: attrs?.url,
        doi: attrs?.doi ?? entry?.id,
        ids: (attrs?.alternateIdentifiers ?? [])
          .map((id: any) =>
            identifier(id?.alternateIdentifierType, id?.alternateIdentifier),
          )
          .filter(Boolean),
        language: attrs?.language,
        venue: attrs?.publisher,
        type: typeOf(attrs?.types?.resourceTypeGeneral),
        rights: attrs?.rightsList?.[0]?.rights,
        downloads: content,
      });
      value.topics = (attrs?.subjects ?? [])
        .slice(0, 20)
        .map((subject: any) => text(subject?.subject, 120));
      if (content.length)
        value.openAccess = {
          status: "green",
          url: content[0].url,
          license: content[0].license,
          provider: "datacite",
          verifiedAt: content[0].verifiedAt,
        };
      return value;
    });
    const totalPages = Number(data?.meta?.totalPages ?? 1);
    return page(
      records,
      "datacite",
      !doi && pageNumber < totalPages ? String(pageNumber + 1) : undefined,
      "DataCite",
    );
  });
}

function zenodo(): CompassProviderAdapter {
  return adapter(providerDescriptor("zenodo"), async (context) => {
    const pageNumber = Math.max(1, Number(context.cursor ?? 1));
    const url = new URL("https://zenodo.org/api/records");
    url.searchParams.set("q", queryFor(context));
    url.searchParams.set("size", "25");
    url.searchParams.set("page", String(pageNumber));
    url.searchParams.set("sort", "bestmatch");
    if (context.query.fromYear || context.query.toYear)
      url.searchParams.set(
        "q",
        `${queryFor(context)} AND publication_date:[${context.query.fromYear ?? "*"} TO ${context.query.toYear ?? "*"}]`,
      );
    const { data } = await requestJson(url.toString(), context.signal);
    const hits = data?.hits?.hits ?? [];
    const records = hits.map((record: any) => {
      const metadata = record?.metadata ?? {};
      const files = (record?.files ?? [])
        .map((file: any) =>
          downloadLink("zenodo", file?.links?.self ?? file?.links?.download, {
            mediaType: file?.type,
            format: file?.key,
            license: metadata?.license?.id,
          }),
        )
        .filter(Boolean) as NonNullable<ReturnType<typeof downloadLink>>[];
      const value = result({
        provider: "zenodo",
        providerId: record?.id,
        title: metadata?.title,
        abstract: metadata?.description,
        authors: authors(
          (metadata?.creators ?? []).map((creator: any) => ({
            name: creator?.name,
            orcid: creator?.orcid,
          })),
        ),
        year: Number(metadata?.publication_date?.slice(0, 4)) || undefined,
        issuedDate: metadata?.publication_date,
        url: record?.links?.html,
        doi: metadata?.doi,
        ids: [identifier("conceptdoi", metadata?.conceptdoi)].filter(
          Boolean,
        ) as any,
        language: metadata?.language,
        type: typeOf(metadata?.resource_type?.type),
        rights: metadata?.license?.id,
        downloads: files,
      });
      value.topics = (metadata?.keywords ?? [])
        .slice(0, 20)
        .map((entry: unknown) => text(entry, 120));
      if (files.length)
        value.openAccess = {
          status: "green",
          url: files[0].url,
          license: metadata?.license?.id,
          provider: "zenodo",
          verifiedAt: files[0].verifiedAt,
        };
      return value;
    });
    const total = Number(data?.hits?.total?.value ?? data?.hits?.total ?? 0);
    return page(
      records,
      "zenodo",
      pageNumber * 25 < total ? String(pageNumber + 1) : undefined,
      "Zenodo",
    );
  });
}

export function repositoryAdapters(): Array<
  [CompassProviderId, CompassProviderAdapter]
> {
  const list = [hal(), datacite(), zenodo()];
  return list.map((entry) => [entry.id, entry]);
}
