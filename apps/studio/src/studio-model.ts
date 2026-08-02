import type {
  ApplicationGraph,
  ComponentPreviewArtifact,
  Flow,
  Finding,
  InteractionProbeArtifact,
  NoteAnchor,
  NoteRecord,
  RouteSnapshot,
  ScreenNode,
  UpdateNoteInput,
  VisualBaseline,
  VisualComparison,
} from "@topo/schema";
import type { ReviewExportOptions as ExporterReviewExportOptions } from "@topo/exporter";
import type { DoctorReport } from "@topo/protocol";

export type StudioNote = NoteRecord;

export type StudioNoteFilter =
  "all" | "open" | "drifted" | "resolved" | "element" | "screen" | "flow";

export interface NoteAnchorSignalRow {
  key:
    | "source"
    | "component"
    | "role-name"
    | "test-locator"
    | "dom-fingerprint"
    | "coordinates";
  label: string;
  value: string;
  present: boolean;
}

export function noteAnchorStatus(note: StudioNote): NoteAnchor["status"] {
  return note.anchor?.status ?? "unbound";
}

function anchorSignal(
  key: NoteAnchorSignalRow["key"],
  label: string,
  value: string | undefined,
): NoteAnchorSignalRow {
  return {
    key,
    label,
    value: value ?? "Not recorded",
    present: value !== undefined,
  };
}

export function getNoteAnchorSignalRows(
  note: StudioNote,
): NoteAnchorSignalRow[] {
  const anchor = note.anchor;
  const source = anchor?.source
    ? [anchor.source.filePath, anchor.source.line, anchor.source.column]
        .filter((value) => value !== undefined)
        .join(":")
    : undefined;
  const roleAndName = anchor?.role
    ? anchor.accessibleName
      ? `${anchor.role} · “${anchor.accessibleName}”`
      : anchor.role
    : anchor?.accessibleName
      ? `“${anchor.accessibleName}”`
      : undefined;
  const coordinates = anchor?.coordinates
    ? [
        `x ${Math.round(anchor.coordinates.x * 100)}%`,
        `y ${Math.round(anchor.coordinates.y * 100)}%`,
        ...(anchor.coordinates.width
          ? [`w ${Math.round(anchor.coordinates.width * 100)}%`]
          : []),
        ...(anchor.coordinates.height
          ? [`h ${Math.round(anchor.coordinates.height * 100)}%`]
          : []),
        ...(anchor.driftPixels !== undefined
          ? [`${anchor.driftPixels}px drift`]
          : []),
      ].join(" · ")
    : undefined;

  return [
    anchorSignal("source", "Source", source),
    anchorSignal("component", "Component", anchor?.componentSymbol),
    anchorSignal("role-name", "Role + name", roleAndName),
    anchorSignal("test-locator", "Test locator", anchor?.testLocator),
    anchorSignal("dom-fingerprint", "DOM fingerprint", anchor?.domFingerprint),
    anchorSignal("coordinates", "Coordinates", coordinates),
  ];
}

export function filterStudioNotes(
  notes: readonly StudioNote[],
  filter: StudioNoteFilter,
): StudioNote[] {
  if (filter === "all") return [...notes];
  if (filter === "open" || filter === "resolved") {
    return notes.filter((note) => note.status === filter);
  }
  if (filter === "drifted") {
    return notes.filter((note) => noteAnchorStatus(note) === "drifted");
  }
  return notes.filter((note) => note.type === filter);
}

function normalizeNoteSearch(value: string): string[] {
  return value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Applies the visible Notes index facet and a bounded text query without
 * changing the order or authority of the underlying Markdown records.
 */
export function searchStudioNotes(
  notes: readonly StudioNote[],
  filter: StudioNoteFilter,
  query: string,
): StudioNote[] {
  const filtered = filterStudioNotes(notes, filter);
  const terms = normalizeNoteSearch(query);
  if (terms.length === 0) return filtered;

  return filtered.filter((note) => {
    const anchor = note.anchor;
    const searchable = [
      note.id,
      note.title,
      note.body,
      note.type,
      note.status,
      note.targetKind,
      note.targetId,
      note.targetRoute,
      note.author,
      noteAnchorStatus(note),
      anchor?.source?.filePath,
      anchor?.componentSymbol,
      anchor?.role,
      anchor?.accessibleName,
      anchor?.testLocator,
      anchor?.domFingerprint,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
}

function noteTargetsExactScreen(note: StudioNote, screen: ScreenNode): boolean {
  if (note.targetKind === "screen" && note.targetId) {
    return note.targetId === screen.id;
  }

  return (
    note.targetRoute === screen.routePath &&
    note.anchor?.source?.filePath === screen.source.filePath
  );
}

export function createScreenNoteAnchor(
  note: StudioNote,
  screen: ScreenNode,
  verifiedAt: string,
): NoteAnchor {
  const existing = noteTargetsExactScreen(note, screen)
    ? note.anchor
    : undefined;
  return {
    ...(existing?.componentSymbol
      ? { componentSymbol: existing.componentSymbol }
      : {}),
    ...(existing?.role ? { role: existing.role } : {}),
    ...(existing?.accessibleName
      ? { accessibleName: existing.accessibleName }
      : {}),
    ...(existing?.testLocator ? { testLocator: existing.testLocator } : {}),
    ...(existing?.domFingerprint
      ? { domFingerprint: existing.domFingerprint }
      : {}),
    ...(existing?.coordinates ? { coordinates: existing.coordinates } : {}),
    status: "attached",
    source: screen.source,
    verifiedAt,
  };
}

function patchedValue<T>(
  patch: T | null | undefined,
  current: T | undefined,
): T | undefined {
  return patch === null ? undefined : (patch ?? current);
}

export function applyNotePatch(
  note: StudioNote,
  patch: UpdateNoteInput,
  updatedAt: string,
): StudioNote {
  return {
    ...note,
    type: patch.type ?? note.type,
    title: patch.title ?? note.title,
    body: patch.body ?? note.body,
    targetKind: patchedValue(patch.targetKind, note.targetKind),
    targetId: patchedValue(patch.targetId, note.targetId),
    targetRoute: patchedValue(patch.targetRoute, note.targetRoute),
    status: patch.status ?? note.status,
    author: patchedValue(patch.author, note.author),
    anchor: patchedValue(patch.anchor, note.anchor),
    updatedAt,
  };
}

export interface StudioSnapshot extends RouteSnapshot {
  imageUrl?: string;
}

export interface StudioComponentPreviewArtifact extends ComponentPreviewArtifact {
  imageUrl?: string;
}

export interface StudioVisualBaseline extends VisualBaseline {
  imageUrl?: string;
}

export interface StudioVisualComparison extends VisualComparison {
  imageUrl?: string;
}

export interface StudioSettings {
  theme: "light" | "dark" | "system";
  promoteOnHover: boolean;
  maxLiveScreens: number;
  runtimeDiagnostics: boolean;
  previewProfile: string;
}

export type ReviewExportOptions = Required<ExporterReviewExportOptions>;

export const defaultSettings: StudioSettings = {
  theme: "dark",
  promoteOnHover: true,
  maxLiveScreens: 4,
  runtimeDiagnostics: false,
  previewProfile: "Anonymous",
};

export function normalizeStudioSettings(value: unknown): StudioSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof StudioSettings, unknown>>)
      : {};
  const theme =
    input.theme === "light" ||
    input.theme === "dark" ||
    input.theme === "system"
      ? input.theme
      : defaultSettings.theme;
  const requestedLimit =
    typeof input.maxLiveScreens === "number" &&
    Number.isFinite(input.maxLiveScreens)
      ? Math.round(input.maxLiveScreens)
      : defaultSettings.maxLiveScreens;
  return {
    theme,
    promoteOnHover:
      typeof input.promoteOnHover === "boolean"
        ? input.promoteOnHover
        : defaultSettings.promoteOnHover,
    maxLiveScreens: Math.min(8, Math.max(1, requestedLimit)),
    runtimeDiagnostics:
      typeof input.runtimeDiagnostics === "boolean"
        ? input.runtimeDiagnostics
        : defaultSettings.runtimeDiagnostics,
    previewProfile:
      typeof input.previewProfile === "string" &&
      input.previewProfile.trim().length > 0
        ? input.previewProfile.trim()
        : defaultSettings.previewProfile,
  };
}

const primaryRoutes = [
  "/",
  "/customers",
  "/customers/[id]",
  "/jobs",
  "/jobs/new",
  "/jobs/[id]",
  "/pricing",
  "/docs",
  "/docs/[slug]",
  "/signup",
  "/signup/verify",
  "/onboarding",
  "/settings",
  "/billing",
];

const workspaceRoutes = [
  "/workspace",
  "/workspace/overview",
  "/workspace/dispatch",
  "/workspace/dispatch/map",
  "/workspace/dispatch/calendar",
  "/workspace/jobs",
  "/workspace/jobs/new",
  "/workspace/jobs/[id]",
  "/workspace/jobs/[id]/invoice",
  "/workspace/jobs/[id]/activity",
  "/workspace/customers",
  "/workspace/customers/new",
  "/workspace/customers/[id]",
  "/workspace/customers/[id]/locations",
  "/workspace/customers/[id]/history",
  "/workspace/technicians",
  "/workspace/technicians/[id]",
  "/workspace/invoices",
  "/workspace/invoices/[id]",
  "/workspace/messages",
  "/workspace/reports",
  "/workspace/reports/revenue",
  "/workspace/reports/operations",
  "/workspace/settings",
  "/workspace/settings/company",
  "/workspace/settings/team",
  "/workspace/settings/notifications",
  "/workspace/inventory",
  "/workspace/inventory/[id]",
  "/workspace/calendar",
  "/workspace/estimates",
  "/workspace/estimates/[id]",
  "/workspace/search",
];

const demoRoutes = [...primaryRoutes, ...workspaceRoutes];

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function fixtureScreenImage(
  routePath: string,
  title: string,
  index: number,
): string {
  const accent = ["#2E8BFF", "#35D89A", "#A979FF", "#FFB000"][index % 4];
  return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="512" viewBox="0 0 720 512">
  <rect width="720" height="512" fill="#0b0d12"/>
  <rect x="0" y="0" width="720" height="48" fill="#11141b"/>
  <circle cx="24" cy="24" r="7" fill="${accent}"/>
  <rect x="44" y="18" width="92" height="12" rx="6" fill="#2a2f3a"/>
  <rect x="0" y="48" width="142" height="464" fill="#0e1117"/>
  <rect x="20" y="84" width="88" height="9" rx="4" fill="#2a303c"/>
  <rect x="20" y="116" width="102" height="8" rx="4" fill="#1d222b"/>
  <rect x="20" y="146" width="76" height="8" rx="4" fill="#1d222b"/>
  <text x="178" y="94" fill="#f4f6f9" font-family="Inter,Arial" font-size="28" font-weight="650">${title}</text>
  <text x="178" y="120" fill="#717887" font-family="monospace" font-size="12">${routePath}</text>
  <rect x="178" y="154" width="506" height="112" rx="10" fill="#121720" stroke="#242b37"/>
  <rect x="198" y="176" width="136" height="10" rx="5" fill="${accent}" opacity=".8"/>
  <rect x="198" y="204" width="426" height="9" rx="4" fill="#29303b"/>
  <rect x="198" y="225" width="316" height="9" rx="4" fill="#202630"/>
  <rect x="178" y="286" width="242" height="176" rx="10" fill="#10151d" stroke="#242b37"/>
  <rect x="442" y="286" width="242" height="176" rx="10" fill="#10151d" stroke="#242b37"/>
  <rect x="198" y="312" width="86" height="9" rx="4" fill="#303746"/>
  <rect x="462" y="312" width="104" height="9" rx="4" fill="#303746"/>
  <path d="M204 420 C250 360 302 440 386 338" fill="none" stroke="${accent}" stroke-width="4"/>
  <rect x="462" y="348" width="196" height="16" rx="4" fill="#1d2530"/>
  <rect x="462" y="378" width="158" height="16" rx="4" fill="#1d2530"/>
  <rect x="462" y="408" width="178" height="16" rx="4" fill="#1d2530"/>
</svg>`);
}

function fixtureComponentImage(name: string, index: number): string {
  const accent = ["#2E8BFF", "#35D89A", "#A979FF", "#FFB000"][index % 4];
  return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
  <rect width="720" height="420" fill="#0d1016"/>
  <rect x="72" y="66" width="576" height="288" rx="18" fill="#151a23" stroke="#2b3340" stroke-width="2"/>
  <circle cx="122" cy="118" r="18" fill="${accent}"/>
  <text x="156" y="127" fill="#f4f6f9" font-family="Inter,Arial" font-size="28" font-weight="650">${name}</text>
  <rect x="108" y="170" width="504" height="18" rx="9" fill="#2b3340"/>
  <rect x="108" y="210" width="392" height="14" rx="7" fill="#222936"/>
  <rect x="108" y="250" width="176" height="54" rx="10" fill="${accent}"/>
  <rect x="308" y="250" width="142" height="54" rx="10" fill="#222936"/>
</svg>`);
}

function makeScreen(routePath: string, index: number): ScreenNode {
  const segments = routePath.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? "home";
  const dynamicParent = segments.at(-2);
  const dynamicTitle = dynamicParent
    ? {
        customers: "Customer",
        estimates: "Estimate",
        invoices: "Invoice",
        inventory: "Inventory item",
        jobs: "Job",
        technicians: "Technician",
      }[dynamicParent]
    : undefined;
  const title =
    routePath === "/"
      ? "Home"
      : /^\[.+\]$/.test(leaf) && dynamicTitle
        ? dynamicTitle
        : leaf
            .replace(/[\[\]]/g, "")
            .replace(/[-_]/g, " ")
            .replace(/^./, (value) => value.toUpperCase());
  return {
    id: `fixture:screen:${index}`,
    kind: "screen",
    title,
    routePath,
    framework: "next-app",
    adapterId: "topo.next",
    state: "default",
    group: routePath.split("/").filter(Boolean)[0]
      ? `/${routePath.split("/").filter(Boolean)[0]}`
      : "/",
    source: {
      filePath:
        routePath === "/"
          ? "app/(marketing)/page.tsx"
          : `app${routePath.replace(/\[[^\]]+\]/g, "[id]")}/page.tsx`,
      line: 1,
    },
    renderStatus: index < 3 ? "live" : index < 44 ? "captured" : "unseen",
    tags: index === 0 ? ["entry"] : [],
  };
}

const findingSeeds: Array<
  Pick<Finding, "title" | "description" | "severity" | "confidence">
> = [
  {
    title: "Possibly inert",
    description: "Button “Watch the tour” produced no recognized effect.",
    severity: "medium",
    confidence: 0.82,
  },
  {
    title: "No keyboard handler",
    description:
      "Clickable div in FeatureCard has no role, tabIndex or key handler.",
    severity: "medium",
    confidence: 0.94,
  },
  {
    title: "Unresolved route",
    description:
      "/customers/[id] links to /billing/checkout, which matches no route.",
    severity: "high",
    confidence: 0.97,
  },
  {
    title: "Empty link",
    description: "/pricing contains an anchor with href=#.",
    severity: "low",
    confidence: 0.91,
  },
  {
    title: "Form with no submit path",
    description:
      "/jobs/new contains form#create-job without a recognized submit path.",
    severity: "medium",
    confidence: 0.76,
  },
  {
    title: "Capture failed",
    description: "/jobs/new raised a runtime error during snapshot capture.",
    severity: "high",
    confidence: 1,
  },
];

const fixtureComponentDomains = [
  "forms",
  "navigation",
  "feedback",
  "data",
  "customers",
  "jobs",
  "billing",
  "scheduling",
  "dispatch",
  "ui",
] as const;

type FixtureComponentDomain = (typeof fixtureComponentDomains)[number];

const fixtureComponentRoles = [
  "Card",
  "List",
  "Table",
  "Form",
  "Picker",
  "Panel",
  "Header",
  "Summary",
  "Status",
  "Timeline",
  "Actions",
  "EmptyState",
] as const;

const fixtureComponentDomainLabels = {
  forms: "Form",
  navigation: "Navigation",
  feedback: "Feedback",
  data: "Data",
  customers: "Customer",
  jobs: "Job",
  billing: "Billing",
  scheduling: "Schedule",
  dispatch: "Dispatch",
  ui: "UI",
} as const satisfies Record<FixtureComponentDomain, string>;

function fixtureDomainComponentName(
  domain: FixtureComponentDomain,
  role: (typeof fixtureComponentRoles)[number],
): string {
  if (domain === "dispatch" && role === "Card") return "AssignmentDrawer";
  if (domain === "data" && role === "Table") return "DataGrid";
  if (domain === "jobs" && role === "Timeline") {
    return "JobActivityTimeline";
  }
  return `${fixtureComponentDomainLabels[domain]}${role}`;
}

const fixturePrimaryComponents = [
  { name: "Button", domain: "ui" },
  { name: "StatusPill", domain: "feedback" },
  { name: "DataTable", domain: "data" },
  { name: "InvoiceRow", domain: "billing" },
  { name: "JobTimeline", domain: "jobs" },
  { name: "CustomerSummaryCard", domain: "customers" },
  { name: "TechnicianPicker", domain: "scheduling" },
  { name: "RouteMapPanel", domain: "dispatch" },
] as const satisfies ReadonlyArray<{
  name: string;
  domain: FixtureComponentDomain;
}>;

const fixtureComponentCatalog = [
  ...fixturePrimaryComponents,
  ...fixtureComponentDomains.flatMap((domain) =>
    fixtureComponentRoles.map((role) => ({
      name: fixtureDomainComponentName(domain, role),
      domain,
    })),
  ),
] as const;

function fixtureComponentIdentity(index: number) {
  const component = fixtureComponentCatalog[index];
  if (!component) {
    throw new Error(`Missing demo component identity at index ${index}`);
  }
  const { name, domain } = component;
  const directory = [
    "customers",
    "jobs",
    "billing",
    "scheduling",
    "dispatch",
  ].includes(domain)
    ? `features/${domain}/components`
    : `components/${domain}`;
  return { name, directory };
}

export const fixtureGraph: ApplicationGraph = {
  version: 1,
  generatedAt: new Date().toISOString(),
  rootDir: "demo://fieldbase-web",
  previewBaseUrl: "http://localhost:3000",
  framework: "next-app",
  screens: demoRoutes.map((routePath, index) => makeScreen(routePath, index)),
  components: fixtureComponentCatalog.map((_, index) => {
    const { name, directory } = fixtureComponentIdentity(index);
    const previewPath = `${directory}/${name}${index === 0 ? ".topo" : ".stories"}.tsx`;
    return {
      id: `fixture:component:${index}`,
      kind: "component" as const,
      name,
      source: { filePath: `${directory}/${name}.tsx`, line: 1 },
      previewStatus:
        index < 104 ? ("renderable" as const) : ("missing" as const),
      previewSources:
        index < 104
          ? [
              {
                id: `${index === 0 ? "topo" : "storybook"}:${previewPath}#Default`,
                title: "Default",
                adapterId: index === 0 ? "topo" : "storybook",
                source: { filePath: previewPath, line: 1 },
                exportName: "Default",
                locator: `${previewPath}#Default`,
                priority: index === 0 ? 200 : 100,
                ...(index === 0
                  ? {
                      readiness: {
                        readySelector: 'html[data-topo-preview-status="ready"]',
                        errorSelector: 'html[data-topo-preview-status="error"]',
                        timeoutMs: 10_000,
                      },
                    }
                  : {}),
              },
              ...(index === 0
                ? [
                    {
                      id: `topo:${previewPath}#Loading`,
                      title: "Loading",
                      adapterId: "topo" as const,
                      discovery: "colocated" as const,
                      source: { filePath: previewPath, line: 7 },
                      exportName: "Loading",
                      locator: `${previewPath}#Loading`,
                      priority: 201,
                      readiness: {
                        readySelector: 'html[data-topo-preview-status="ready"]',
                        errorSelector: 'html[data-topo-preview-status="error"]',
                        timeoutMs: 10_000,
                      },
                    },
                  ]
                : []),
            ]
          : [],
      usedBy: Array.from(
        { length: index === 5 ? 12 : Math.min(4, index % 5) },
        (_, usedIndex) => `fixture:screen:${usedIndex}`,
      ),
    };
  }),
  apiEndpoints: ([
    ["GET", "/api/customers", "listCustomers", "List customers"],
    ["POST", "/api/customers", "createCustomer", "Create customer"],
    ["GET", "/api/customers/{id}", "getCustomer", "Get customer"],
    ["PATCH", "/api/customers/{id}", "updateCustomer", "Update customer"],
    ["GET", "/api/jobs", "listJobs", "List scheduled jobs"],
    ["POST", "/api/jobs", "createJob", "Create job"],
    ["GET", "/api/technicians", "listTechnicians", "List technicians"],
    ["GET", "/api/dispatch/board", "getDispatchBoard", "Load dispatch board"],
  ] as const).map(([method, endpointPath, operationId, summary], index) => ({
    version: 1 as const,
    id: `api:http:${method}:${endpointPath}`,
    kind: "api-endpoint" as const,
    protocol: "http" as const,
    method: method as "GET" | "POST" | "PATCH",
    path: endpointPath,
    title: summary,
    operationId,
    summary,
    description: `${summary} in the Fieldbase demo application.`,
    frameworks: ["next-app"],
    adapterIds: ["source-api", "openapi"],
    tags: [endpointPath.split("/")[2] ?? "API"],
    parameters: endpointPath.includes("{id}")
      ? [{ name: "id", in: "path" as const, required: true, schema: { type: "string" } }]
      : [],
    requestContentTypes: method === "POST" || method === "PATCH" ? ["application/json"] : [],
    responses: [
      { status: method === "POST" ? "201" : "200", description: "Successful response", contentTypes: ["application/json"] },
    ],
    security: { status: "declared" as const, schemes: ["previewSession"] },
    discoveries: [
      {
        adapterId: "source-api",
        kind: "framework-source" as const,
        framework: "next-app",
        source: { filePath: `app/api/${endpointPath.split("/").slice(2).join("/").replace("{id}", "[id]")}/route.ts`, line: index + 3 },
        confidence: 1,
      },
      {
        adapterId: "openapi",
        kind: "openapi" as const,
        framework: "openapi",
        source: { filePath: "openapi.yaml", line: 12 + index * 8 },
        confidence: 1,
      },
    ],
  })),
  projectRecognition: {
    version: 1,
    status: "recognized",
    frameworks: [
      {
        framework: "next-app",
        confidence: 1,
        adapterIds: ["topo.next"],
        reasons: [
          "Next.js App Router packages and route conventions were detected.",
        ],
      },
    ],
    capabilities: [
      {
        id: "routing",
        confidence: 1,
        reasons: ["47 canonical route screens were discovered."],
        sources: [{ filePath: "app/page.tsx", line: 1 }],
      },
      {
        id: "api",
        confidence: 1,
        reasons: ["8 source and OpenAPI operations were merged."],
        sources: [{ filePath: "openapi.yaml", line: 1 }],
      },
      {
        id: "component-previews",
        confidence: 1,
        reasons: ["Storybook and colocated previews were discovered."],
        sources: [{ filePath: "components/StatusCard.topo.tsx", line: 1 }],
      },
      {
        id: "typescript",
        confidence: 0.98,
        reasons: ["TypeScript source and package evidence is present."],
        sources: [],
      },
    ],
    sourceFileCount: 286,
  },
  flowTransitions: [
    {
      version: 1,
      id: "flow-transition:demo-home-customers",
      adapterId: "source-flow",
      kind: "navigation",
      sourceScreenId: "fixture:screen:0",
      sourceRoutePath: demoRoutes[0]!,
      target: {
        kind: "screen",
        status: "resolved",
        routePath: demoRoutes[1]!,
        screenId: "fixture:screen:1",
      },
      action: `Follow link to ${demoRoutes[1]}`,
      source: { filePath: "components/AppNavigation.tsx", line: 18 },
      confidence: 0.96,
    },
    {
      version: 1,
      id: "flow-transition:demo-customers-api",
      adapterId: "source-flow",
      kind: "request",
      sourceScreenId: "fixture:screen:1",
      sourceRoutePath: demoRoutes[1]!,
      target: {
        kind: "api-endpoint",
        status: "resolved",
        method: "GET",
        path: "/api/customers",
        endpointId: "api:http:GET:/api/customers",
      },
      action: "Request GET /api/customers",
      source: { filePath: "app/customers/page.tsx", line: 22 },
      confidence: 0.9,
    },
    {
      version: 1,
      id: "flow-transition:demo-customers-new",
      adapterId: "source-flow",
      kind: "navigation",
      sourceScreenId: "fixture:screen:1",
      sourceRoutePath: demoRoutes[1]!,
      target: {
        kind: "screen",
        status: "resolved",
        routePath: demoRoutes[2]!,
        screenId: "fixture:screen:2",
      },
      action: `Follow link to ${demoRoutes[2]}`,
      source: { filePath: "app/customers/page.tsx", line: 48 },
      confidence: 0.96,
    },
  ],
  inferredFlows: [
    {
      version: 1,
      id: "inferred-flow:demo-customer-journey",
      title: "Customer workspace inferred journey",
      description:
        "Read-only journey inferred from literal navigation and request evidence.",
      entryStepId: "inferred-step:demo-home",
      confidence: 0.94,
      adapterIds: ["source-flow"],
      transitionCount: 3,
      truncated: false,
      steps: [
        {
          id: "inferred-step:demo-home",
          kind: "screen",
          title: "Entry",
          routePath: demoRoutes[0]!,
          screenId: "fixture:screen:0",
          transitionIds: [],
          sources: [{ filePath: "app/page.tsx", line: 1 }],
          nextStepIds: ["inferred-step:demo-customers"],
        },
        {
          id: "inferred-step:demo-customers",
          kind: "screen",
          title: "Customers",
          routePath: demoRoutes[1]!,
          screenId: "fixture:screen:1",
          action: `Follow link to ${demoRoutes[1]}`,
          transitionIds: ["flow-transition:demo-home-customers"],
          sources: [
            { filePath: "components/AppNavigation.tsx", line: 18 },
          ],
          nextStepIds: [
            "inferred-step:demo-customers-api",
            "inferred-step:demo-customers-new",
          ],
        },
        {
          id: "inferred-step:demo-customers-api",
          kind: "api-endpoint",
          title: "GET /api/customers",
          endpointId: "api:http:GET:/api/customers",
          action: "Request GET /api/customers",
          transitionIds: ["flow-transition:demo-customers-api"],
          sources: [{ filePath: "app/customers/page.tsx", line: 22 }],
          nextStepIds: [],
        },
        {
          id: "inferred-step:demo-customers-new",
          kind: "screen",
          title: "New customer",
          routePath: demoRoutes[2]!,
          screenId: "fixture:screen:2",
          action: `Follow link to ${demoRoutes[2]}`,
          transitionIds: ["flow-transition:demo-customers-new"],
          sources: [{ filePath: "app/customers/page.tsx", line: 48 }],
          nextStepIds: [],
        },
      ],
    },
  ],
  edges: [
    [0, 1],
    [0, 6],
    [0, 7],
    [0, 9],
    [1, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [3, 5],
    [4, 5],
    [5, 13],
    [7, 8],
    [9, 10],
    [10, 11],
    [11, 3],
    [12, 13],
  ].map(([sourceIndex, targetIndex], index) => ({
    id: `fixture:edge:${index}`,
    source: `fixture:screen:${sourceIndex}`,
    target: `fixture:screen:${targetIndex}`,
    kind: "navigation" as const,
    confidence: 0.96,
  })),
  findings: Array.from({ length: 14 }, (_, index) => {
    const seed = findingSeeds[index % findingSeeds.length]!;
    return {
      id: `fixture:finding:${index}`,
      title: seed.title,
      description: seed.description,
      severity: seed.severity,
      status: "open" as const,
      source: {
        filePath:
          index % 2 ? "app/(marketing)/page.tsx" : "app/jobs/new/page.tsx",
        line: 24 + index,
      },
      evidence: [seed.description],
      confidence: seed.confidence,
    };
  }),
  sourceIssues: [],
};

export const fixtureSnapshots: StudioSnapshot[] = fixtureGraph.screens.map(
  (screen, index) => ({
    id: `fixture-snapshot-${index + 1}`,
    screenId: screen.id,
    routePath: screen.routePath,
    capturedAt: new Date(Date.now() - (index + 2) * 60_000).toISOString(),
    status: "captured",
    contentHash: `fixture-screen-${index + 1}`,
    width: 1440,
    height: 1024,
    imageUrl: fixtureScreenImage(screen.routePath, screen.title, index),
  }),
);

export const fixtureVisualBaselines: StudioVisualBaseline[] =
  fixtureGraph.screens.slice(0, 8).map((screen, index) => ({
    version: 1,
    id: `fixture-visual-baseline-${index + 1}`,
    screenId: screen.id,
    routePath: screen.routePath,
    sourceSnapshotId: `fixture-snapshot-${index + 1}`,
    acceptedAt: new Date(Date.now() - (index + 12) * 60_000).toISOString(),
    artifactPath: `.topo/snapshots/fixture-baseline-${index + 1}.png`,
    contentHash: (index % 16).toString(16).repeat(64),
    width: 1440,
    height: 1024,
    imageUrl: fixtureScreenImage(
      screen.routePath,
      `${screen.title} baseline`,
      index,
    ),
  }));

export const fixtureVisualComparisons: StudioVisualComparison[] =
  fixtureVisualBaselines.map((baseline, index) => {
    const changed = index === 0 || index === 3;
    return {
      version: 1,
      id: `fixture-visual-comparison-${index + 1}`,
      screenId: baseline.screenId,
      routePath: baseline.routePath,
      baselineId: baseline.id,
      baselineHash: baseline.contentHash,
      currentSnapshotId: `fixture-snapshot-${index + 1}`,
      currentHash: changed
        ? ((index + 8) % 16).toString(16).repeat(64)
        : baseline.contentHash,
      comparedAt: new Date(Date.now() - (index + 2) * 60_000).toISOString(),
      status: changed ? "changed" : "unchanged",
      threshold: 0.1,
      changedPixels: changed ? 18_432 + index * 1_024 : 0,
      totalPixels: 1_474_560,
      changeRatio: changed ? (18_432 + index * 1_024) / 1_474_560 : 0,
      baselineSize: { width: 1440, height: 1024 },
      currentSize: { width: 1440, height: 1024 },
      ...(changed
        ? {
            artifactPath: `.topo/comparisons/fixture-${index + 1}.png`,
            imageUrl: fixtureScreenImage(
              baseline.routePath,
              "Pixel difference",
              index + 12,
            ),
          }
        : {}),
    };
  });

export const fixturePreviewArtifacts: StudioComponentPreviewArtifact[] = [
  ...fixtureGraph.components
    .slice(0, 16)
    .map((component, index): StudioComponentPreviewArtifact => ({
      version: 1,
      id: `fixture-component-preview-${index + 1}`,
      targetKind: "component",
      targetId: component.id,
      previewId: component.previewSources[0]!.id,
      adapterId: component.previewSources[0]!.adapterId,
      title: component.previewSources[0]!.title,
      source: component.previewSources[0]!.source,
      capturedAt: new Date(Date.now() - (index + 1) * 90_000).toISOString(),
      status: "captured",
      contentHash: (index % 16).toString(16).repeat(64),
      width: 720,
      height: 420,
      imageUrl: fixtureComponentImage(component.name, index),
    })),
  (() => {
    const component = fixtureGraph.components[0]!;
    const preview = component.previewSources[1]!;
    return {
      version: 1 as const,
      id: "fixture-component-preview-button-loading",
      targetKind: "component" as const,
      targetId: component.id,
      previewId: preview.id,
      adapterId: preview.adapterId,
      title: preview.title,
      source: preview.source,
      capturedAt: new Date(Date.now() - 45_000).toISOString(),
      status: "captured" as const,
      contentHash: "f".repeat(64),
      width: 720,
      height: 420,
      imageUrl: fixtureComponentImage(`${component.name} · Loading`, 16),
    };
  })(),
];

const now = new Date().toISOString();

export const fixtureDoctorReport: DoctorReport = {
  schemaVersion: 1,
  generatedAt: now,
  projectRoot: "~/code/fieldbase",
  sourceRoot: "~/code/fieldbase",
  ok: true,
  summary: { total: 2, passed: 2, warnings: 0, errors: 0 },
  checks: [
    {
      id: "demo.runtime-probes",
      scope: "environment",
      title: "Runtime probes are intentionally paused",
      status: "pass",
      severity: "info",
      detail:
        "The public demo uses deterministic evidence and never probes a visitor's machine.",
      action: "Run Topo locally for live probes",
      evidence: { demoMode: true, runtimeProbes: false },
    },
    {
      id: "demo.preview-profile",
      scope: "security",
      title: "Deterministic Fieldbase demo profile",
      status: "pass",
      severity: "info",
      detail:
        "Fixture screens contain no production credentials, cookies, or sessions.",
      evidence: { demoMode: true, secretsIncluded: false },
    },
  ],
};

function fixtureProbe(
  suffix: string,
  routePath: string,
  label: string,
  status: InteractionProbeArtifact["status"],
  effects: InteractionProbeArtifact["effects"] = [],
  error?: string,
): InteractionProbeArtifact {
  const screenId = fixtureGraph.screens.find(
    (screen) => screen.routePath === routePath && screen.state === "default",
  )?.id;
  return {
    version: 1,
    id: `fixture-interaction-probe-${suffix}`,
    routePath,
    ...(screenId ? { screenId } : {}),
    control: {
      index: suffix === "route-error" ? -1 : 0,
      id: `fixture-control-${suffix}`,
      label,
      tagName: suffix === "route-error" ? "document" : "button",
      role: suffix === "route-error" ? "document" : "button",
      locator:
        suffix === "route-error"
          ? routePath
          : `role=button[name=${JSON.stringify(label)}]`,
    },
    status,
    effects,
    evidence:
      status === "possibly-inert"
        ? [
            `Activated ${label} on ${routePath}`,
            "Observed no recognized effect after 200ms",
          ]
        : status === "skipped"
          ? ["Control matched the destructive-action safety policy"]
          : effects.length > 0
            ? effects.map((effect) => effect.summary)
            : [`Unable to probe ${routePath}: ${error ?? "unknown error"}`],
    observedAt: now,
    ...(error ? { error } : {}),
  };
}

export const fixtureInteractionProbes: InteractionProbeArtifact[] = [
  fixtureProbe("watch-tour", "/", "Watch the tour", "possibly-inert"),
  fixtureProbe("open-dashboard", "/", "Open dashboard", "effect-observed", [
    {
      kind: "navigation",
      summary: "URL changed to /dashboard",
    },
  ]),
  fixtureProbe("delete-customer", "/", "Delete customer", "skipped"),
  fixtureProbe(
    "route-error",
    "/jobs",
    "Route probe for /jobs",
    "activation-error",
    [],
    "Preview server unavailable",
  ),
];

const probeStatusPriority: Record<InteractionProbeArtifact["status"], number> =
  {
    "possibly-inert": 0,
    "activation-error": 1,
    "effect-observed": 2,
    skipped: 3,
  };

export function selectInteractionProbe(
  probes: readonly InteractionProbeArtifact[],
  routePath: string,
  preferredId?: string,
): InteractionProbeArtifact | undefined {
  const routeProbes = probes
    .filter((probe) => probe.routePath === routePath)
    .sort(
      (left, right) =>
        probeStatusPriority[left.status] - probeStatusPriority[right.status] ||
        right.observedAt.localeCompare(left.observedAt) ||
        left.id.localeCompare(right.id),
    );
  return (
    routeProbes.find((probe) => probe.id === preferredId) ?? routeProbes[0]
  );
}

function makeFlow(
  id: string,
  title: string,
  routes: string[],
  actions: string[],
): Flow {
  return {
    version: 1,
    id,
    title,
    description: `${title} traced from the application preview.`,
    status: "verified",
    entryStepId: `${id}-step-1`,
    tags: [],
    steps: routes.map((routePath, index) => ({
      id: `${id}-step-${index + 1}`,
      title: routePath,
      routePath,
      action: actions[index],
      noteIds: [],
      nextStepIds: index < routes.length - 1 ? [`${id}-step-${index + 2}`] : [],
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export const fixtureFlows: Flow[] = [
  makeFlow(
    "book-a-job",
    "Book a job",
    [
      "/jobs",
      "/jobs/new",
      "/customers/[id]",
      "/jobs/[id]",
      "/billing/checkout",
    ],
    ["click", "submit", "click", "broken"],
  ),
  makeFlow(
    "sign-up",
    "Sign up",
    ["/signup", "/signup/verify", "/onboarding", "/jobs"],
    ["submit", "verify", "finish"],
  ),
  makeFlow(
    "invoice-a-job",
    "Invoice a job",
    ["/jobs", "/jobs/[id]", "/billing", "/jobs/[id]", "/customers/[id]", "/"],
    ["open", "invoice", "pay", "return", "close"],
  ),
  makeFlow(
    "reset-password",
    "Reset password",
    ["/signup", "/signup/verify", "/settings"],
    ["request", "verify"],
  ),
  makeFlow(
    "assign-technician",
    "Assign technician",
    ["/jobs", "/jobs/[id]", "/customers/[id]", "/jobs/[id]", "/jobs"],
    ["open", "assign", "confirm", "return"],
  ),
];

const noteSeeds = [
  [
    "Copy still says “tech” — legal wants “technician”",
    "element",
    "/",
    "attached",
    "open",
  ],
  [
    "Empty state never shows when a tech has zero jobs",
    "screen",
    "/jobs",
    "drifted",
    "open",
  ],
  [
    "Invoice total rounds down — finance flagged this twice",
    "element",
    "/jobs/[id]",
    "attached",
    "open",
  ],
  [
    "Book-a-job flow breaks at /billing/checkout — see step 5",
    "flow",
    "/billing/checkout",
    "unbound",
    "open",
  ],
  [
    "Technician picker has no preview fixture",
    "element",
    "/jobs/new",
    "drifted",
    "open",
  ],
  [
    "Pricing page hero copy signed off",
    "screen",
    "/pricing",
    "attached",
    "resolved",
  ],
  [
    "Admin role can open invoices without permission",
    "element",
    "/billing",
    "attached",
    "open",
  ],
  [
    "Customer header clips at the mobile breakpoint",
    "element",
    "/customers/[id]",
    "drifted",
    "open",
  ],
  [
    "Loading skeleton does not match job detail",
    "screen",
    "/jobs/[id]",
    "attached",
    "open",
  ],
  [
    "Confirm cancellation copy with support",
    "flow",
    "/jobs/[id]",
    "attached",
    "open",
  ],
  [
    "Keyboard focus skips the scheduled-date picker",
    "element",
    "/jobs/new",
    "drifted",
    "open",
  ],
] as const;

export const fixtureNotes: StudioNote[] = Array.from(
  { length: 11 },
  (_, index) => {
    const seed = noteSeeds[index % noteSeeds.length]!;
    const screen = fixtureGraph.screens.find(
      (candidate) => candidate.routePath === seed[2],
    );
    const verifiedAt = new Date(
      Date.now() - (index + 1) * 86_400_000,
    ).toISOString();
    return {
      version: 1,
      id: `fixture-note-${index + 1}`,
      type: seed[1],
      title: seed[0],
      body:
        index === 0
          ? "Copy still says ‘tech’. Legal signed off on ‘technician’ only — change before the beta post."
          : "Versioned review context stored as Markdown in .topo/notes.",
      targetKind: seed[1] === "flow" ? "flow" : "screen",
      ...(seed[1] !== "flow" && screen ? { targetId: screen.id } : {}),
      targetRoute: seed[2],
      status: seed[4],
      createdAt: now,
      updatedAt: verifiedAt,
      author: ["byron", "priya", "sam"][index % 3],
      ...(screen && seed[3] !== "unbound"
        ? {
            anchor: {
              status: seed[3],
              source: screen.source,
              verifiedAt,
              ...(seed[3] === "drifted" ? { driftPixels: 14 } : {}),
              ...(index === 0
                ? {
                    componentSymbol: "MarketingHero",
                    role: "heading",
                    accessibleName: "Run the whole app from one canvas",
                    testLocator: "hero-headline",
                    domFingerprint: "fixture-a91c",
                    coordinates: {
                      x: 0.18,
                      y: 0.21,
                      width: 0.46,
                      height: 0.08,
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  },
);

export function findingTone(finding: Finding): "error" | "warning" | "info" {
  if (finding.severity === "high") return "error";
  if (finding.severity === "medium" || finding.severity === "low") {
    return "warning";
  }
  return "info";
}
