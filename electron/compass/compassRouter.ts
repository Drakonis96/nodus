import type {
  CompassLane,
  CompassProviderId,
  CompassQueryPlan,
  CompassQueryStrategy,
} from "@shared/compass";

export interface CompassRoute {
  provider: CompassProviderId;
  strategy: CompassQueryStrategy;
  lane: CompassLane;
}
const unique = (routes: CompassRoute[]) =>
  routes.filter(
    (route, index, all) =>
      all.findIndex(
        (other) =>
          other.provider === route.provider && other.lane === route.lane,
      ) === index,
  );

export function routeCompassRequests(plan: CompassQueryPlan): CompassRoute[] {
  const allowed = new Set(plan.providers);
  const use = (provider: CompassProviderId) =>
    allowed.size === 0 || allowed.has(provider);
  const route = (
    provider: CompassProviderId,
    strategy: CompassQueryStrategy = "balanced",
    lane: CompassLane = plan.lane,
  ): CompassRoute => ({ provider, strategy, lane });
  const text = `${plan.text} ${plan.disciplines.join(" ")}`.toLocaleLowerCase();
  const types = new Set(plan.types);
  const doi = plan.identifiers.some((entry) => entry.scheme === "doi");
  const isbn = plan.identifiers.some((entry) => entry.scheme === "isbn");
  const orcid = plan.identifiers.some((entry) => entry.scheme === "orcid");
  if (plan.mode === "similar")
    return [
      route("openalex", "semantic", "scholarly"),
      route("semanticscholar", "similar", "scholarly"),
    ];
  if (allowed.size)
    return [...allowed].map((provider) =>
      route(
        provider,
        doi || isbn
          ? "identifier"
          : provider === "hal" ||
              provider === "bnf" ||
              provider === "gallica" ||
              provider === "arxiv"
            ? "strict"
            : "balanced",
        ["loc", "internetarchive", "gallica"].includes(provider)
          ? "primary"
          : "scholarly",
      ),
    );
  let routes: CompassRoute[] = [];
  if (doi)
    routes = [
      route("openalex", "identifier", "scholarly"),
      route("crossref", "identifier", "scholarly"),
      route("opencitations", "identifier", "scholarly"),
    ];
  else if (isbn)
    routes = [
      route("openlibrary", "identifier", "scholarly"),
      route("doab", "identifier", "scholarly"),
      route("oapen", "identifier", "scholarly"),
      route("bnf", "identifier", "scholarly"),
    ];
  else if (plan.lane === "primary")
    routes = [
      route("loc", "balanced", "primary"),
      route("internetarchive", "balanced", "primary"),
      route("gallica", "strict", "primary"),
    ];
  else {
    if (orcid)
      return unique([
        route("openalex", "identifier"),
        route("crossref", "identifier"),
        route("datacite", "identifier"),
        route("openaire", "identifier"),
      ]).filter((entry) => use(entry.provider));
    if (plan.authors.length)
      return unique([
        route("openalex", "strict"),
        route("crossref", "strict"),
        route("datacite", "strict"),
        route("zenodo", "strict"),
        route("core", "strict"),
        route("openaire", "strict"),
      ]).filter((entry) => use(entry.provider));
    routes.push(
      route("openalex"),
      route(
        "core",
        plan.expressions.conceptPairs.length ? "concept-pair" : "balanced",
      ),
      route("doaj"),
      route("openaire"),
    );
    if (
      types.has("book") ||
      types.has("chapter") ||
      /\b(?:book|libro|livre|livro|monograph|chapter|cap[ií]tulo|literatura de viajes|travel writing|récits de voyage)\b/i.test(
        text,
      )
    )
      routes.unshift(
        route("openlibrary"),
        route("doab"),
        route("oapen"),
        route("bnf", "strict"),
        route("core", "balanced"),
      );
    if (
      plan.languages.some((language) => language === "fr") ||
      /\b(?:fran[cç]ais|french|france|humanities|sciences humaines)\b/i.test(
        text,
      )
    )
      routes.unshift(
        route("hal", "strict"),
        route("bnf", "strict"),
        route("gallica", "strict", "primary"),
      );
    if (
      [...types].some((type) =>
        ["thesis", "report", "dataset", "preprint"].includes(type),
      ) ||
      /\b(?:thesis|tesis|dissertation|dataset|report|informe|preprint)\b/i.test(
        text,
      )
    )
      routes.unshift(
        route("datacite"),
        route("zenodo", "strict"),
        route("openaire"),
        route("hal", "strict"),
      );
    if (
      /\b(?:medicine|medical|health|medicina|biomed|salud|médecine|santé)\b/i.test(
        text,
      )
    )
      routes.unshift(route("europepmc", "strict"));
    if (
      /\b(?:computer science|informatics|informática|informatique|software|algorithm|machine learning|artificial intelligence)\b/i.test(
        text,
      )
    )
      routes.unshift(
        route("dblp"),
        route("arxiv", "strict"),
        route("semanticscholar"),
      );
  }
  return unique(routes).filter((entry) => use(entry.provider));
}

export function routeCompassProviders(
  plan: CompassQueryPlan,
): CompassProviderId[] {
  return routeCompassRequests(plan).map((route) => route.provider);
}
