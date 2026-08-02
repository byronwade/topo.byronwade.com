export interface ResolveDaemonUrlOptions {
  environmentUrl?: string;
  embeddedUrl?: string;
  currentOrigin?: string;
  production?: boolean;
}

const EMBEDDED_PLACEHOLDER = "__TOPO_DAEMON_URL__";

function normalizeHttpBase(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate === EMBEDDED_PLACEHOLDER) return undefined;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function resolveDaemonUrl(options: ResolveDaemonUrlOptions): string {
  const environmentUrl = normalizeHttpBase(options.environmentUrl);
  if (environmentUrl) return environmentUrl;
  const embeddedUrl = normalizeHttpBase(options.embeddedUrl);
  if (embeddedUrl) return embeddedUrl;
  const currentOrigin = normalizeHttpBase(options.currentOrigin);
  if (options.production && currentOrigin) return currentOrigin;
  return "http://localhost:4599";
}
