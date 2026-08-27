import type {
  CompassProviderAdapter,
  CompassProviderId,
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
  requestText,
  result,
  text,
  xmlValues,
} from "./provider";
import { compassAuthorNameScore } from "../authorNames";

const authors = (values: unknown[]) =>
  values
    .map(author)
    .filter((entry): entry is NonNullable<ReturnType<typeof author>> =>
      Boolean(entry),
    );
const yearOf = (value: unknown) =>
  Number(text(value).match(/\b(?:1[5-9]\d{2}|20\d{2})\b/)?.[0]) || undefined;
const mapType = (value: unknown) => {
  const key = text(value).toLocaleLowerCase();
  return /book-chapter|chapter/.test(key)
    ? "chapter"
    : /book|monograph/.test(key)
      ? "book"
      : /thesis|dissertation/.test(key)
        ? "thesis"
        : /dataset/.test(key)
          ? "dataset"
          : /preprint/.test(key)
            ? "preprint"
            : /report/.test(key)
              ? "report"
              : "article";
};

function openAlex(): CompassProviderAdapter {
  return adapter(providerDescriptor("openalex"), async (context) => {
    const doi = context.query.identifiers.find(
      (entry) => entry.scheme === "doi",
    )?.value;
    if (doi) {
      const { data } = await requestJson(
        `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
        context.signal,
      );
      return page([mapOpenAlex(data)], "openalex", undefined, "OpenAlex");
    }
    const orcid = context.query.identifiers.find(
      (entry) => entry.scheme === "orcid",
    )?.value;
    const requestedAuthor = context.query.authors[0];
    let resolvedAuthorIds: string[] = [];
    if (orcid) {
      const { data } = await requestJson(
        `https://api.openalex.org/authors/https://orcid.org/${encodeURIComponent(orcid)}`,
        context.signal,
      );
      if (data?.id) resolvedAuthorIds = [text(data.id).split("/").pop()!];
    } else if (requestedAuthor) {
      const authorUrl = new URL("https://api.openalex.org/authors");
      authorUrl.searchParams.set("search", requestedAuthor);
      authorUrl.searchParams.set("per-page", "10");
      const { data } = await requestJson(authorUrl.toString(), context.signal);
      const matchingAuthors = (Array.isArray(data?.results) ? data.results : [])
        .filter(
          (entry: any) =>
            compassAuthorNameScore(requestedAuthor, text(entry?.display_name)) >=
            0.9,
        )
        .sort(
          (left: any, right: any) =>
            Number(Boolean(right?.orcid)) - Number(Boolean(left?.orcid)) ||
            Number(right?.works_count ?? 0) - Number(left?.works_count ?? 0),
        )
        .slice(0, 3);
      resolvedAuthorIds = matchingAuthors
        .slice(0, matchingAuthors[0]?.orcid ? 1 : 3)
        .map((entry: any) => text(entry?.id).split("/").pop())
        .filter(Boolean);
    }
    const url = new URL("https://api.openalex.org/works");
    const expression = queryFor(context);
    if (!resolvedAuthorIds.length)
      // Anonymous calls choose one paid search operation: semantic OR lexical.
      url.searchParams.set(
        context.strategy === "semantic" ? "search.semantic" : "search",
        expression,
      );
    url.searchParams.set("per-page", "25");
    url.searchParams.set("cursor", context.cursor ?? "*");
    const filters = [
      resolvedAuthorIds.length
        ? `author.id:${resolvedAuthorIds.join("|")}`
        : "",
      context.query.fromYear
        ? `from_publication_date:${context.query.fromYear}-01-01`
        : "",
      context.query.toYear
        ? `to_publication_date:${context.query.toYear}-12-31`
        : "",
      context.query.openAccessOnly ? "is_oa:true" : "",
    ].filter(Boolean);
    if (filters.length) url.searchParams.set("filter", filters.join(","));
    const { data } = await requestJson(url.toString(), context.signal);
    return page(
      (Array.isArray(data?.results) ? data.results : []).map(mapOpenAlex),
      "openalex",
      data?.meta?.next_cursor,
      "OpenAlex",
    );
  });
}
function mapOpenAlex(work: any) {
  const inverted =
    work?.abstract_inverted_index &&
    typeof work.abstract_inverted_index === "object"
      ? Object.entries(work.abstract_inverted_index)
          .flatMap(([word, positions]) =>
            Array.isArray(positions)
              ? positions.map((position) => [Number(position), word] as const)
              : [],
          )
          .sort((left, right) => left[0] - right[0])
          .map((entry) => entry[1])
          .join(" ")
      : undefined;
  const pdf = downloadLink(
    "openalex",
    work?.best_oa_location?.pdf_url ?? work?.primary_location?.pdf_url,
    { mediaType: "application/pdf", license: work?.best_oa_location?.license },
  );
  const value = result({
    provider: "openalex",
    providerId: work?.id,
    title: work?.title,
    abstract: inverted,
    authors: authors(
      (work?.authorships ?? []).map((entry: any) => entry.author),
    ),
    year: Number(work?.publication_year) || undefined,
    issuedDate: work?.publication_date,
    url: work?.primary_location?.landing_page_url ?? work?.id,
    doi: text(work?.doi).replace(/^https?:\/\/doi\.org\//i, ""),
    ids: [
      identifier("pmid", work?.ids?.pmid),
      identifier("pmcid", work?.ids?.pmcid),
    ].filter(Boolean) as any,
    language: work?.language,
    venue: work?.primary_location?.source?.display_name,
    citationCount: Number(work?.cited_by_count) || undefined,
    type: mapType(work?.type),
    nativeScore: Number(work?.relevance_score) || undefined,
    downloads: pdf ? [pdf] : [],
  });
  if (work?.open_access)
    value.openAccess = {
      status: work.open_access.oa_status ?? "unknown",
      url: work.open_access.oa_url,
      provider: "openalex",
      verifiedAt: new Date().toISOString(),
    };
  value.topics = (work?.topics ?? [])
    .map((topic: any) => text(topic?.display_name, 120))
    .filter(Boolean);
  return value;
}

function core(): CompassProviderAdapter {
  return adapter(providerDescriptor("core"), async (context) => {
    const url = new URL("https://api.core.ac.uk/v3/search/works");
    const requestedAuthor = context.query.authors[0];
    url.searchParams.set(
      "q",
      requestedAuthor
        ? `authors:"${requestedAuthor.replaceAll('"', "")}"`
        : queryFor(context),
    );
    url.searchParams.set("limit", requestedAuthor ? "25" : "1");
    url.searchParams.set("offset", context.cursor ?? "0");
    const { data } = await requestJson(url.toString(), context.signal);
    const items = Array.isArray(data?.results) ? data.results : [];
    const records = items.map((work: any) => {
      const pdf = downloadLink("core", work?.downloadUrl, {
        mediaType: "application/pdf",
        open: true,
      });
      const value = result({
        provider: "core",
        providerId: work?.id,
        title: work?.title,
        abstract: work?.abstract,
        authors: authors(Array.isArray(work?.authors) ? work.authors : []),
        year: work?.yearPublished,
        issuedDate: work?.publishedDate,
        url: work?.sourceFulltextUrls?.[0] ?? work?.links?.[0]?.url,
        doi: work?.doi,
        ids: [identifier("core", work?.id)].filter(Boolean) as any,
        language: work?.language?.code ?? work?.language,
        venue: work?.journals?.[0]?.title,
        type: mapType(work?.documentType),
        downloads: pdf ? [pdf] : [],
      });
      if (pdf)
        value.openAccess = {
          status: "green",
          url: pdf.url,
          provider: "core",
          verifiedAt: pdf.verifiedAt,
        };
      return value;
    });
    const offset = Number(context.cursor ?? 0);
    return page(
      records,
      "core",
      records.length === (requestedAuthor ? 25 : 1) &&
        offset + records.length < Number(data?.totalHits ?? Infinity)
        ? String(offset + records.length)
        : undefined,
      "CORE",
    );
  });
}

function doaj(): CompassProviderAdapter {
  return adapter(providerDescriptor("doaj"), async (context) => {
    const pageNumber = Math.max(1, Number(context.cursor ?? 1));
    const expression = encodeURIComponent(queryFor(context));
    const { data } = await requestJson(
      `https://doaj.org/api/search/articles/${expression}?page=${pageNumber}&pageSize=25`,
      context.signal,
    );
    const records = (Array.isArray(data?.results) ? data.results : []).map(
      (hit: any) => {
        const record = hit?.bibjson ?? hit;
        const links = Array.isArray(record?.link) ? record.link : [];
        const full = links.find((link: any) =>
          /fulltext|pdf/i.test(`${link?.type} ${link?.content_type}`),
        );
        const dl = downloadLink("doaj", full?.url, {
          mediaType: full?.content_type,
          license: record?.license?.[0]?.type,
        });
        const value = result({
          provider: "doaj",
          providerId:
            hit?.id ??
            record?.identifier?.find((id: any) => id.type === "doi")?.id,
          title: record?.title,
          abstract: record?.abstract,
          authors: authors(record?.author ?? []),
          year: yearOf(record?.year),
          url: links[0]?.url,
          doi: record?.identifier?.find((id: any) => id.type === "doi")?.id,
          ids: (record?.identifier ?? [])
            .map((id: any) => identifier(id?.type, id?.id))
            .filter(Boolean),
          language: record?.journal?.language?.[0],
          venue: record?.journal?.title,
          type: "article",
          rights: record?.license?.[0]?.type,
          downloads: dl ? [dl] : [],
        });
        value.openAccess = {
          status: "gold",
          url: dl?.url ?? links[0]?.url,
          license: record?.license?.[0]?.type,
          provider: "doaj",
          verifiedAt: new Date().toISOString(),
        };
        value.topics = (record?.keywords ?? []).map((entry: unknown) =>
          text(entry, 120),
        );
        return value;
      },
    );
    return page(
      records,
      "doaj",
      pageNumber * 25 < Number(data?.total ?? 0)
        ? String(pageNumber + 1)
        : undefined,
      "DOAJ",
    );
  });
}

function openAire(): CompassProviderAdapter {
  return adapter(providerDescriptor("openaire"), async (context) => {
    const pageNumber = Math.max(1, Number(context.cursor ?? 1));
    const url = new URL("https://api.openaire.eu/search/publications");
    const orcid = context.query.identifiers.find(
      (entry) => entry.scheme === "orcid",
    )?.value;
    if (orcid) url.searchParams.set("orcid", orcid);
    else if (context.query.authors[0])
      url.searchParams.set("author", context.query.authors[0]);
    else url.searchParams.set("keywords", queryFor(context));
    url.searchParams.set("size", "25");
    url.searchParams.set("page", String(pageNumber));
    if (context.query.fromYear)
      url.searchParams.set(
        "fromDateAccepted",
        `${context.query.fromYear}-01-01`,
      );
    if (context.query.toYear)
      url.searchParams.set("toDateAccepted", `${context.query.toYear}-12-31`);
    if (context.query.openAccessOnly) url.searchParams.set("OA", "true");
    const { data } = await requestText(url.toString(), context.signal);
    const blocks = [
      ...data.matchAll(
        /<(?:\w+:)?result\b[^>]*>([\s\S]*?)<\/(?:\w+:)?result>/gi,
      ),
    ].map((match) => match[1]);
    const records = blocks.map((block) => {
      const pids = xmlValues(block, "pid");
      const doi = pids.find((pid) => /^10\./.test(pid));
      const urls = xmlValues(block, "url");
      const access = xmlValues(block, "bestaccessright")[0];
      const value = result({
        provider: "openaire",
        providerId: xmlValues(block, "originalId")[0] ?? pids[0] ?? urls[0],
        title: xmlValues(block, "title")[0],
        abstract: xmlValues(block, "description")[0],
        authors: authors(xmlValues(block, "creator")),
        year: yearOf(xmlValues(block, "dateofacceptance")[0]),
        issuedDate: xmlValues(block, "dateofacceptance")[0],
        url: urls[0],
        doi,
        ids: pids
          .map((pid) => identifier(/^10\./.test(pid) ? "doi" : "external", pid))
          .filter(Boolean) as any,
        language: xmlValues(block, "language")[0],
        type: mapType(xmlValues(block, "resulttype")[0]),
      });
      if (/open|embargo/i.test(access))
        value.openAccess = {
          status: "green",
          url: urls[0],
          provider: "openaire",
          verifiedAt: new Date().toISOString(),
        };
      return value;
    });
    const total = Number(xmlValues(data, "total")[0] ?? 0);
    return page(
      records,
      "openaire",
      records.length === 25 && (!total || pageNumber * 25 < total)
        ? String(pageNumber + 1)
        : undefined,
      "OpenAIRE",
    );
  });
}

export function generalAdapters(): Array<
  [CompassProviderId, CompassProviderAdapter]
> {
  const list = [openAlex(), core(), doaj(), openAire()];
  return list.map((entry) => [entry.id, entry]);
}
