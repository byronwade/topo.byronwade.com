import { access } from "node:fs/promises";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

export interface BrowserRuntimeInspection {
  available: boolean;
  executablePath: string;
  error?: string;
}

export async function inspectBrowserRuntime(
  configuredExecutablePath?: string,
): Promise<BrowserRuntimeInspection> {
  const executablePath = configuredExecutablePath ?? chromium.executablePath();
  try {
    await access(executablePath);
    return { available: true, executablePath };
  } catch (error) {
    return {
      available: false,
      executablePath,
      error: error instanceof Error ? error.message : "Browser is unavailable",
    };
  }
}

export interface PreviewCookie {
  name: string;
  value: string;
  domain?: string;
}

export interface PreviewProfile {
  name: string;
  headers?: Record<string, string>;
  cookies?: PreviewCookie[];
  localStorage?: Record<string, string>;
}

export interface PreviewSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export interface PreviewSessionOptions {
  baseUrl: string;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  profile?: PreviewProfile;
}

export interface PreviewBrowserOptions {
  headless?: boolean;
  executablePath?: string;
}

export interface CaptureReadiness {
  readySelector: string;
  errorSelector?: string;
  timeoutMs?: number;
}

export interface CaptureRouteOptions extends PreviewSessionOptions {
  routePath: string;
  fullPage?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  readiness?: CaptureReadiness;
}

export interface CaptureRouteResult {
  url: string;
  title: string;
  screenshot: Buffer;
  width: number;
  height: number;
  capturedAt: string;
}

function cookieDomain(baseUrl: string, cookie: PreviewCookie): string {
  if (cookie.domain) return cookie.domain;
  return new URL(baseUrl).hostname;
}

async function applyProfile(
  session: PreviewSession,
  options: PreviewSessionOptions,
): Promise<void> {
  const profile = options.profile;
  if (!profile) return;

  if (profile.cookies?.length) {
    await session.context.addCookies(
      profile.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookieDomain(options.baseUrl, cookie),
        path: "/",
      })),
    );
  }

  if (profile.localStorage && Object.keys(profile.localStorage).length > 0) {
    await session.page.evaluate((values) => {
      for (const [key, value] of Object.entries(values))
        window.localStorage.setItem(key, value);
    }, profile.localStorage);
  }
}

interface ReadinessResult {
  status: "ready" | "error";
  message?: string;
}

async function waitForReadiness(
  page: Page,
  readiness: CaptureReadiness,
): Promise<void> {
  const handle = await page.waitForFunction(
    ({ readySelector, errorSelector }) => {
      if (errorSelector) {
        const error = document.querySelector(errorSelector);
        if (error) {
          return {
            status: "error",
            message: error.textContent?.trim() || "Preview reported an error",
          };
        }
      }

      if (document.querySelector(readySelector)) return { status: "ready" };
      return undefined;
    },
    {
      readySelector: readiness.readySelector,
      errorSelector: readiness.errorSelector,
    },
    { timeout: readiness.timeoutMs ?? 10_000 },
  );
  const result = (await handle.jsonValue()) as ReadinessResult;
  await handle.dispose();

  if (result.status === "error") {
    throw new Error(
      `Component preview failed: ${result.message ?? "unknown error"}`,
    );
  }
}

export async function launchPreviewBrowser(
  options: PreviewBrowserOptions = {},
): Promise<Browser> {
  return chromium.launch({
    headless: options.headless ?? true,
    executablePath: options.executablePath,
  });
}

async function openPreviewInBrowser(
  browser: Browser,
  options: PreviewSessionOptions,
  closeBrowser: boolean,
): Promise<PreviewSession> {
  const context = await browser.newContext({
    baseURL: options.baseUrl,
    extraHTTPHeaders: options.profile?.headers,
    viewport: options.viewport ?? { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const session: PreviewSession = {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      if (closeBrowser) await browser.close();
    },
  };

  await page.goto(options.baseUrl, { waitUntil: "domcontentloaded" });
  await applyProfile(session, options);
  return session;
}

export async function openPreview(
  options: PreviewSessionOptions,
): Promise<PreviewSession> {
  const browser = await launchPreviewBrowser(options);
  try {
    return await openPreviewInBrowser(browser, options, true);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function captureRouteWithBrowser(
  browser: Browser,
  options: CaptureRouteOptions,
): Promise<CaptureRouteResult> {
  const session = await openPreviewInBrowser(browser, options, false);
  try {
    const url = new URL(options.routePath, options.baseUrl).toString();
    await session.page.goto(url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
    });
    if (options.readiness) {
      await waitForReadiness(session.page, options.readiness);
    }
    const screenshot = await session.page.screenshot({
      type: "png",
      fullPage: options.fullPage ?? true,
    });
    const viewport = session.page.viewportSize() ??
      options.viewport ?? { width: 1440, height: 1000 };
    return {
      url,
      title: await session.page.title(),
      screenshot,
      width: viewport.width,
      height: viewport.height,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}

export async function captureRoute(
  options: CaptureRouteOptions,
): Promise<CaptureRouteResult> {
  const browser = await launchPreviewBrowser(options);
  try {
    return await captureRouteWithBrowser(browser, options);
  } finally {
    await browser.close();
  }
}
