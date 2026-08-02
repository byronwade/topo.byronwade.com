export const STUDIO_SHOWCASE_ROUTE_BASE = "/demo-studio";
export const STUDIO_SHOWCASE_ASSET_BASE = "/_topo-studio";

/**
 * Builds the single public handoff into Topo Studio. The configured value is
 * an optional origin owned by the deployment; visitors cannot choose an
 * arbitrary redirect target. Without an override, the website uses its
 * generated same-origin Studio showcase.
 */
export function buildStudioDemoUrl(configuredOrigin?: string): string {
  const origin = configuredOrigin?.trim();
  if (!origin) {
    return `${STUDIO_SHOWCASE_ROUTE_BASE}/welcome?demo=1&source=website`;
  }
  const url = new URL(origin);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("TOPO_DEMO_STUDIO_URL must use http or https.");
  }

  url.pathname = "/welcome";
  url.search = "";
  url.hash = "";
  url.searchParams.set("demo", "1");
  url.searchParams.set("source", "website");
  return url.toString();
}
