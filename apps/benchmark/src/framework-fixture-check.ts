import path from "node:path";

import { chromium } from "playwright";

import {
  startApplicationRuntime,
  type TopoApplicationRuntime,
} from "@topo/application-runtime";
import { resolveProject } from "@topo/config";
import { loadLlmContext } from "@topo/llm-context";
import {
  isParameterizedRoutePath,
  type Framework,
  type ScreenState,
} from "@topo/schema";
import { scanWorkspace } from "@topo/workspace";

export const FRAMEWORK_FIXTURE_REPORT_VERSION = 2 as const;

export interface FrameworkFixtureRouteCase {
  routePath: string;
  visitPath: string;
  screen: string;
  expectedStatus?: number;
}

export interface FrameworkFixtureDefinition {
  id: string;
  rootDir: string;
  baseUrl: string;
  framework: Framework;
  runtimeAdapterId: string;
  routes: FrameworkFixtureRouteCase[];
  graphScreens?: Array<{ routePath: string; state: ScreenState }>;
  apiEndpoints: string[];
  flowId: string;
  flowStepCount: number;
}

export interface FrameworkFixtureCheck {
  id:
    | "graph-framework"
    | "project-recognition"
    | "graph-routes"
    | "dynamic-route-examples"
    | "graph-api-endpoints"
    | "llm-api-endpoints"
    | "graph-inferred-flows"
    | "llm-inferred-flows"
    | "llm-flow"
    | "native-runtime"
    | "browser-routes"
    | "runtime-shutdown";
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

const CHECK_ORDER: FrameworkFixtureCheck["id"][] = [
  "graph-framework",
  "project-recognition",
  "graph-routes",
  "dynamic-route-examples",
  "graph-api-endpoints",
  "llm-api-endpoints",
  "graph-inferred-flows",
  "llm-inferred-flows",
  "llm-flow",
  "native-runtime",
  "browser-routes",
  "runtime-shutdown",
];

export interface FrameworkFixtureResult {
  id: string;
  framework: Framework;
  baseUrl: string;
  routes: Array<{
    routePath: string;
    visitPath: string;
    screen: string;
    status: number | null;
    matched: boolean;
  }>;
  pageErrors: string[];
  consoleErrors: string[];
  checks: FrameworkFixtureCheck[];
  status: "pass" | "fail";
}

export interface FrameworkFixtureReport {
  schemaVersion: typeof FRAMEWORK_FIXTURE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  browser: "chromium";
  fixtures: FrameworkFixtureResult[];
  summary: { passed: number; failed: number; total: number };
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

async function originReleased(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
    return false;
  } catch {
    return true;
  }
}

async function runFixture(
  definition: FrameworkFixtureDefinition,
  headless: boolean,
): Promise<FrameworkFixtureResult> {
  const rootDir = path.resolve(definition.rootDir);
  const project = await resolveProject(rootDir);
  const graph = await scanWorkspace(project.sourceRoot, {
    adapterRootDir: project.projectRoot,
    adapterModules: project.config.extensions.frameworkAdapters,
    apiEndpointAdapterModules: project.config.extensions.apiEndpointAdapters,
    flowAdapterModules: project.config.extensions.flowAdapters,
    componentPreviewAdapterModules:
      project.config.extensions.componentPreviewAdapters,
    componentPreviews: project.config.preview.components,
    previewRoutes: project.config.preview.routes,
  });
  const expectedRoutes = definition.routes.map((route) => route.routePath);
  const actualRoutes = graph.screens.map((screen) => screen.routePath);
  const expectedGraphScreens = definition.graphScreens?.map(
    (screen) => `${screen.routePath}#${screen.state}`,
  );
  const actualGraphScreens = graph.screens.map(
    (screen) => `${screen.routePath}#${screen.state}`,
  );
  const graphScreensMatch = expectedGraphScreens
    ? sameValues(actualGraphScreens, expectedGraphScreens)
    : sameValues(actualRoutes, expectedRoutes);
  const dynamicRouteCases = definition.routes.filter((route) =>
    isParameterizedRoutePath(route.routePath),
  );
  const dynamicRouteExamplesMatch = dynamicRouteCases.every((route) =>
    graph.screens.some(
      (screen) =>
        screen.routePath === route.routePath &&
        screen.previewRoute?.status === "configured" &&
        screen.previewRoute.path === route.visitPath,
    ),
  );
  const context = await loadLlmContext(rootDir, graph, {
    projectRoot: rootDir,
    sourceRoot: rootDir,
    profileNames: [],
    previewRoutes: project.config.preview.routes,
  });
  const flowRecord = context.records.find(
    (record) =>
      record.kind === "flow" &&
      typeof record.data.id === "string" &&
      record.data.id === definition.flowId,
  );
  const flowSteps = context.records.filter(
    (record) =>
      record.kind === "flow-step" &&
      record.relationships.some(
        (relationship) => relationship.targetId === definition.flowId,
      ),
  );
  const actualApiEndpoints = graph.apiEndpoints.map(
    (endpoint) => `${endpoint.method} ${endpoint.path}`,
  );
  const llmApiEndpoints = context.records
    .filter((record) => record.kind === "api-endpoint")
    .map((record) => `${String(record.data.method)} ${String(record.data.path)}`);
  const contextTransitions = context.records.filter(
    (record) => record.kind === "flow-transition",
  );
  const contextInferredFlows = context.records.filter(
    (record) => record.kind === "inferred-flow",
  );
  const contextInferredSteps = context.records.filter(
    (record) => record.kind === "inferred-flow-step",
  );
  const recognitionMatches =
    graph.projectRecognition.status !== "unknown" &&
    graph.projectRecognition.frameworks.some(
      (framework) => framework.framework === definition.framework,
    ) &&
    graph.projectRecognition.capabilities.some(
      (capability) => capability.id === "routing",
    );
  const checksById = new Map<
    FrameworkFixtureCheck["id"],
    FrameworkFixtureCheck
  >();
  const recordCheck = (check: FrameworkFixtureCheck): void => {
    checksById.set(check.id, check);
  };
  const initialChecks: FrameworkFixtureCheck[] = [
    {
      id: "graph-framework",
      status: graph.framework === definition.framework ? "pass" : "fail",
      detail:
        graph.framework === definition.framework
          ? `Detected ${definition.framework}.`
          : `Expected ${definition.framework}, received ${graph.framework}.`,
      evidence: {
        expected: definition.framework,
        actual: graph.framework,
      },
    },
    {
      id: "project-recognition",
      status: recognitionMatches ? "pass" : "fail",
      detail: recognitionMatches
        ? `${definition.framework} and routing capability were recognized from source evidence.`
        : "Framework or routing capability recognition evidence is incomplete.",
      evidence: {
        status: graph.projectRecognition.status,
        frameworks: graph.projectRecognition.frameworks.map(
          (framework) => framework.framework,
        ),
        capabilities: graph.projectRecognition.capabilities.map(
          (capability) => capability.id,
        ),
        sourceFileCount: graph.projectRecognition.sourceFileCount,
      },
    },
    {
      id: "graph-routes",
      status: graphScreensMatch ? "pass" : "fail",
      detail: `${actualGraphScreens.length} normalized route screen state(s) were discovered.`,
      evidence: {
        expected: expectedGraphScreens ?? expectedRoutes,
        actual: expectedGraphScreens ? actualGraphScreens : actualRoutes,
      },
    },
    {
      id: "dynamic-route-examples",
      status: dynamicRouteExamplesMatch ? "pass" : "fail",
      detail:
        dynamicRouteCases.length === 0
          ? "This fixture has no parameterized routes."
          : `${dynamicRouteCases.length} parameterized route(s) resolve to concrete project-owned preview paths.`,
      evidence: {
        expected: dynamicRouteCases.map(
          (route) => `${route.routePath} -> ${route.visitPath}`,
        ),
        actual: graph.screens
          .filter((screen) => isParameterizedRoutePath(screen.routePath))
          .map(
            (screen) =>
              `${screen.routePath} -> ${screen.previewRoute?.status === "configured" ? screen.previewRoute.path : "unresolved"}`,
          ),
      },
    },
    {
      id: "graph-api-endpoints",
      status: sameValues(actualApiEndpoints, definition.apiEndpoints)
        ? "pass"
        : "fail",
      detail: `${actualApiEndpoints.length} normalized API endpoint(s) were discovered.`,
      evidence: { expected: definition.apiEndpoints, actual: actualApiEndpoints },
    },
    {
      id: "llm-api-endpoints",
      status: sameValues(llmApiEndpoints, definition.apiEndpoints)
        ? "pass"
        : "fail",
      detail: `${llmApiEndpoints.length} API endpoint(s) are independently queryable in LLM context.`,
      evidence: { expected: definition.apiEndpoints, actual: llmApiEndpoints },
    },
    {
      id: "graph-inferred-flows",
      status:
        graph.flowTransitions.length > 0 && graph.inferredFlows.length > 0
          ? "pass"
          : "fail",
      detail: `${graph.flowTransitions.length} source transition(s) compose ${graph.inferredFlows.length} inferred journey candidate(s).`,
      evidence: {
        transitions: graph.flowTransitions.length,
        inferredFlows: graph.inferredFlows.length,
        adapterIds: [
          ...new Set(
            graph.flowTransitions.map((transition) => transition.adapterId),
          ),
        ],
      },
    },
    {
      id: "llm-inferred-flows",
      status:
        contextTransitions.length === graph.flowTransitions.length &&
        contextInferredFlows.length === graph.inferredFlows.length &&
        contextInferredSteps.length ===
          graph.inferredFlows.reduce((sum, flow) => sum + flow.steps.length, 0)
          ? "pass"
          : "fail",
      detail: `${contextTransitions.length} transition, ${contextInferredFlows.length} inferred-flow, and ${contextInferredSteps.length} inferred-step record(s) are independently queryable.`,
      evidence: {
        transitions: contextTransitions.length,
        inferredFlows: contextInferredFlows.length,
        inferredSteps: contextInferredSteps.length,
      },
    },
    {
      id: "llm-flow",
      status:
        flowRecord && flowSteps.length === definition.flowStepCount
          ? "pass"
          : "fail",
      detail: `${flowSteps.length} independently queryable flow step(s) reference ${definition.flowId}.`,
      evidence: {
        flowId: definition.flowId,
        flowPresent: Boolean(flowRecord),
        expectedSteps: definition.flowStepCount,
        actualSteps: flowSteps.length,
      },
    },
  ];
  for (const check of initialChecks) recordCheck(check);
  const routeResults: FrameworkFixtureResult["routes"] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let runtime: TopoApplicationRuntime | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    runtime = await startApplicationRuntime({
      rootDir,
      baseUrl: definition.baseUrl,
      mode: "managed",
      readyTimeoutMs: 60_000,
    });
    recordCheck({
      id: "native-runtime",
      status:
        runtime.ownership === "managed" &&
        runtime.adapterId === definition.runtimeAdapterId
          ? "pass"
          : "fail",
      detail: `${runtime.ownership} runtime selected ${runtime.adapterId}.`,
      evidence: {
        ownership: runtime.ownership,
        adapterId: runtime.adapterId,
        pid: runtime.pid ?? -1,
      },
    });

    browser = await chromium.launch({ headless });
    for (const route of definition.routes) {
      const expectedStatus = route.expectedStatus ?? 200;
      const routeUrl = new URL(route.visitPath, definition.baseUrl).toString();
      const page = await browser.newPage({
        viewport: { width: 1_440, height: 900 },
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const sourceUrl = message.location().url;
        const expectedNavigationError =
          expectedStatus >= 400 &&
          text.includes(`status of ${expectedStatus}`) &&
          (!sourceUrl || sourceUrl === routeUrl);
        if (!expectedNavigationError) consoleErrors.push(text);
      });
      const response = await page.goto(routeUrl, {
        waitUntil: "domcontentloaded",
      });
      const status = response?.status() ?? null;
      let matched = false;
      try {
        await page.locator(`[data-topo-screen="${route.screen}"]`).waitFor({
          state: "visible",
          timeout: 10_000,
        });
        matched = status === expectedStatus;
      } catch {
        matched = false;
      } finally {
        await page.close();
      }
      routeResults.push({ ...route, status, matched });
    }
    recordCheck({
      id: "browser-routes",
      status:
        routeResults.every((route) => route.matched) &&
        pageErrors.length === 0 &&
        consoleErrors.length === 0
          ? "pass"
          : "fail",
      detail: `${routeResults.filter((route) => route.matched).length}/${routeResults.length} native routes rendered their expected screen identity.`,
      evidence: {
        matched: routeResults.filter((route) => route.matched).length,
        total: routeResults.length,
        pageErrors,
        consoleErrors,
      },
    });
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : "Framework fixture failed";
    if (!runtime) {
      recordCheck({
        id: "native-runtime",
        status: "fail",
        detail,
        evidence: { error: detail },
      });
    }
    if (!checksById.has("browser-routes")) {
      recordCheck({
        id: "browser-routes",
        status: "fail",
        detail: runtime
          ? detail
          : "Browser routes were not checked because the native runtime did not start.",
        evidence: { error: detail, runtimeStarted: Boolean(runtime) },
      });
    }
  } finally {
    await browser?.close();
    await runtime?.close();
  }

  const released = await originReleased(definition.baseUrl);
  recordCheck({
    id: "runtime-shutdown",
    status: runtime && released ? "pass" : "fail",
    detail:
      runtime && released
        ? "The managed fixture origin was released."
        : runtime
          ? "The fixture origin remained reachable after shutdown."
          : "No managed runtime handle was available to close.",
    evidence: { released, runtimeStarted: Boolean(runtime) },
  });
  const checks = CHECK_ORDER.map((id) => checksById.get(id)).filter(
    (check): check is FrameworkFixtureCheck => Boolean(check),
  );
  const status = checks.every((check) => check.status === "pass")
    ? "pass"
    : "fail";
  return {
    id: definition.id,
    framework: definition.framework,
    baseUrl: definition.baseUrl,
    routes: routeResults,
    pageErrors,
    consoleErrors,
    checks,
    status,
  };
}

export async function runFrameworkFixtureCheck(
  definitions: readonly FrameworkFixtureDefinition[],
  options: { headless?: boolean } = {},
): Promise<FrameworkFixtureReport> {
  const fixtures: FrameworkFixtureResult[] = [];
  for (const definition of definitions) {
    fixtures.push(await runFixture(definition, options.headless ?? true));
  }
  const passed = fixtures.filter((fixture) => fixture.status === "pass").length;
  return {
    schemaVersion: FRAMEWORK_FIXTURE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status: passed === fixtures.length ? "pass" : "fail",
    browser: "chromium",
    fixtures,
    summary: {
      passed,
      failed: fixtures.length - passed,
      total: fixtures.length,
    },
  };
}

export function builtInFrameworkFixtureDefinitions(
  repositoryRoot: string,
): FrameworkFixtureDefinition[] {
  return [
    {
      id: "next-app",
      rootDir: path.join(repositoryRoot, "apps", "playground-next-app"),
      baseUrl: "http://localhost:3040",
      framework: "next-app",
      runtimeAdapterId: "next",
      flowId: "review-customer-path",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/customers", "POST /api/customers"],
      graphScreens: [
        { routePath: "/", state: "default" },
        { routePath: "/", state: "not-found" },
        { routePath: "/dashboard", state: "default" },
        { routePath: "/dashboard", state: "loading" },
        { routePath: "/dashboard/customers", state: "default" },
        { routePath: "/settings", state: "default" },
      ],
      routes: [
        { routePath: "/", visitPath: "/", screen: "home" },
        {
          routePath: "/",
          visitPath: "/route-does-not-exist",
          screen: "app-not-found",
          expectedStatus: 404,
        },
        {
          routePath: "/dashboard",
          visitPath: "/dashboard",
          screen: "dashboard",
        },
        {
          routePath: "/dashboard/customers",
          visitPath: "/dashboard/customers",
          screen: "customers",
        },
        {
          routePath: "/settings",
          visitPath: "/settings",
          screen: "settings",
        },
      ],
    },
    {
      id: "next-pages",
      rootDir: path.join(repositoryRoot, "apps", "playground-next-pages"),
      baseUrl: "http://localhost:3020",
      framework: "next-pages",
      runtimeAdapterId: "next",
      flowId: "review-pages-customer",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/health"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "pages-overview" },
        {
          routePath: "/404",
          visitPath: "/route-does-not-exist",
          screen: "pages-not-found",
          expectedStatus: 404,
        },
        {
          routePath: "/customers",
          visitPath: "/customers",
          screen: "pages-customers",
        },
        {
          routePath: "/customers/[customerId]",
          visitPath: "/customers/acme-plumbing",
          screen: "pages-customer-detail",
        },
        {
          routePath: "/settings",
          visitPath: "/settings",
          screen: "pages-settings",
        },
      ],
    },
    {
      id: "tanstack-router",
      rootDir: path.join(repositoryRoot, "apps", "playground-tanstack-router"),
      baseUrl: "http://localhost:3010",
      framework: "tanstack-router",
      runtimeAdapterId: "tanstack",
      flowId: "review-job",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/health"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "overview" },
        { routePath: "/jobs", visitPath: "/jobs", screen: "jobs" },
        {
          routePath: "/jobs/:jobId",
          visitPath: "/jobs/rf-1042",
          screen: "job-detail",
        },
        {
          routePath: "/settings/profile",
          visitPath: "/settings/profile",
          screen: "profile",
        },
      ],
    },
    {
      id: "tanstack-start",
      rootDir: path.join(repositoryRoot, "apps", "playground-tanstack-start"),
      baseUrl: "http://localhost:3030",
      framework: "tanstack-start",
      runtimeAdapterId: "tanstack",
      flowId: "review-start-work-order",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/health"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "start-overview" },
        {
          routePath: "/work-orders",
          visitPath: "/work-orders",
          screen: "start-work-orders",
        },
        {
          routePath: "/work-orders/:workOrderId",
          visitPath: "/work-orders/wo-2041",
          screen: "start-work-order-detail",
        },
        {
          routePath: "/settings/team",
          visitPath: "/settings/team",
          screen: "start-team-settings",
        },
      ],
    },
    {
      id: "react",
      rootDir: path.join(repositoryRoot, "apps", "playground-react"),
      baseUrl: "http://localhost:3050",
      framework: "react-router",
      runtimeAdapterId: "vite",
      flowId: "review-react-customer",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/health"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "react-overview" },
        {
          routePath: "/customers",
          visitPath: "/customers",
          screen: "react-customers",
        },
        {
          routePath: "/customers/:customerId",
          visitPath: "/customers/acme-plumbing",
          screen: "react-customer",
        },
      ],
    },
    {
      id: "vue",
      rootDir: path.join(repositoryRoot, "apps", "playground-vue"),
      baseUrl: "http://localhost:3060",
      framework: "vue-router",
      runtimeAdapterId: "vite",
      flowId: "review-vue-project",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/health"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "vue-overview" },
        {
          routePath: "/projects",
          visitPath: "/projects",
          screen: "vue-projects",
        },
        {
          routePath: "/projects/:projectId",
          visitPath: "/projects/atlas",
          screen: "vue-project",
        },
      ],
    },
    {
      id: "nuxt",
      rootDir: path.join(repositoryRoot, "apps", "playground-nuxt"),
      baseUrl: "http://localhost:3070",
      framework: "nuxt",
      runtimeAdapterId: "nuxt",
      flowId: "review-nuxt-customer",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/customers"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "nuxt-overview" },
        {
          routePath: "/customers",
          visitPath: "/customers",
          screen: "nuxt-customers",
        },
        {
          routePath: "/customers/:customerId",
          visitPath: "/customers/acme-plumbing",
          screen: "nuxt-customer",
        },
      ],
    },
    {
      id: "svelte",
      rootDir: path.join(repositoryRoot, "apps", "playground-svelte"),
      baseUrl: "http://localhost:3080",
      framework: "sveltekit",
      runtimeAdapterId: "vite",
      flowId: "review-svelte-job",
      flowStepCount: 3,
      apiEndpoints: ["GET /api/jobs", "POST /api/jobs"],
      routes: [
        { routePath: "/", visitPath: "/", screen: "svelte-overview" },
        { routePath: "/jobs", visitPath: "/jobs", screen: "svelte-jobs" },
        {
          routePath: "/jobs/:jobId",
          visitPath: "/jobs/topo-1042",
          screen: "svelte-job",
        },
      ],
    },
  ];
}
