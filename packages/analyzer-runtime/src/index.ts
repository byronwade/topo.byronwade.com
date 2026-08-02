import { createHash } from "node:crypto";

import {
  openPreview,
  type PreviewProfile,
  type PreviewSession,
} from "@topo/browser";
import type {
  Finding,
  InteractionProbeArtifact,
  RuntimeEffect,
  RuntimeEffectKind,
} from "@topo/schema";

export interface RuntimeProbeOptions {
  baseUrl: string;
  /** Canonical framework route identity retained in all evidence. */
  routePath: string;
  /** Concrete local path used for the browser request. */
  previewPath?: string;
  screenId?: string;
  profile?: PreviewProfile;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  maxControls?: number;
  settleMs?: number;
  openSession?: typeof openPreview;
}

export type RuntimeObservation = InteractionProbeArtifact;

export interface RuntimeProbeResult {
  observations: RuntimeObservation[];
  findings: Finding[];
}

interface ControlInfo {
  tagName: string;
  label: string;
  href: string;
  disabled: boolean;
  hidden: boolean;
  role: string;
  locator: string;
  activeIdentity: string;
  descriptor: string;
  probePolicy: string;
  formMethod: string;
  formAction: string;
}

interface PageState {
  href: string;
  domFingerprint: string;
  accessibility: string;
  active: string;
  storage: string;
  appEvents: string;
}

interface InstrumentedEvent {
  kind: "form-submit" | "dom";
  summary: string;
}

const EFFECT_ORDER: RuntimeEffectKind[] = [
  "navigation",
  "network",
  "dom",
  "dialog",
  "form-submit",
  "download",
  "focus",
  "storage",
  "app-event",
  "runtime-error",
];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function controlIdentity(routePath: string, info: ControlInfo): string {
  return `control:${fingerprint(`${routePath}\0${info.locator}\0${info.label}`).slice(0, 20)}`;
}

function artifactIdentity(controlId: string): string {
  return `interaction-probe:${controlId.slice("control:".length)}`;
}

async function readPageState(page: PreviewSession["page"]): Promise<PageState> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const [state, accessibility] = await Promise.all([
        page.evaluate(() => {
          const browserWindow = window as unknown as {
            __TOPO__?: { events?: unknown[] };
          };
          const storageEntries = (storage: Storage) =>
            Array.from({ length: storage.length }, (_, index) => {
              const key = storage.key(index) ?? "";
              return [key, storage.getItem(key) ?? ""] as const;
            }).sort(([left], [right]) => left.localeCompare(right));
          const active = document.activeElement as HTMLElement | null;
          return {
            href: window.location.href,
            dom: document.body?.innerHTML ?? "",
            active: active
              ? [
                  active.tagName.toLowerCase(),
                  active.id ? `#${active.id}` : "",
                  active.getAttribute("role") ?? "",
                  active.getAttribute("aria-label") ?? "",
                ].join(":")
              : "",
            storage: JSON.stringify({
              local: storageEntries(window.localStorage),
              session: storageEntries(window.sessionStorage),
            }),
            appEvents: JSON.stringify(browserWindow.__TOPO__?.events ?? []),
          };
        }),
        page
          .locator("body")
          .ariaSnapshot({ timeout: 1_000 })
          .catch(() => ""),
      ]);
      return {
        href: state.href,
        domFingerprint: fingerprint(state.dom),
        accessibility,
        active: state.active,
        storage: state.storage,
        appEvents: state.appEvents,
      };
    } catch (error: unknown) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !/execution context was destroyed|navigating|target page.*closed/i.test(
          error.message,
        )
      ) {
        throw error;
      }
      await page.waitForTimeout(50);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to read page state");
}

async function inspectControl(
  page: PreviewSession["page"],
  index: number,
): Promise<ControlInfo> {
  return page
    .locator("button, a[href], [role=button]")
    .nth(index)
    .evaluate((element, controlIndex) => {
      const htmlElement = element as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      const form = htmlElement.closest("form");
      const button = element instanceof HTMLButtonElement ? element : undefined;
      const anchor = element instanceof HTMLAnchorElement ? element : undefined;
      const label = (
        element.getAttribute("aria-label") ||
        element.textContent ||
        element.getAttribute("title") ||
        button?.value ||
        `${tagName} #${Number(controlIndex) + 1}`
      )
        .trim()
        .replace(/\s+/g, " ");
      const role =
        element.getAttribute("role") ||
        (tagName === "a" ? "link" : tagName === "button" ? "button" : "button");
      const elementId = htmlElement.id;
      const testId = element.getAttribute("data-testid");
      const locator = elementId
        ? `#${CSS.escape(elementId)}`
        : testId
          ? `[data-testid=${JSON.stringify(testId)}]`
          : `role=${role}[name=${JSON.stringify(label)}]`;
      const style = window.getComputedStyle(htmlElement);
      const formMethod = (
        button?.formMethod ||
        form?.getAttribute("method") ||
        "get"
      ).toLowerCase();
      const formAction =
        button?.formAction ||
        (form instanceof HTMLFormElement ? form.action : "") ||
        "";
      return {
        tagName,
        label,
        href: anchor?.href ?? "",
        disabled:
          button?.disabled === true ||
          element.getAttribute("aria-disabled") === "true",
        hidden:
          htmlElement.hidden ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          htmlElement.getClientRects().length === 0,
        role,
        locator,
        activeIdentity: [
          tagName,
          elementId ? `#${elementId}` : "",
          element.getAttribute("role") ?? "",
          element.getAttribute("aria-label") ?? "",
        ].join(":"),
        descriptor: [
          label,
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("title") ?? "",
          anchor?.href ?? "",
          formAction,
        ].join(" "),
        probePolicy:
          htmlElement
            .closest("[data-topo-probe]")
            ?.getAttribute("data-topo-probe") ?? "",
        formMethod,
        formAction,
      };
    }, index);
}

async function installInstrumentation(
  page: PreviewSession["page"],
): Promise<void> {
  await page.evaluate(() => {
    const instrumentedWindow = window as unknown as {
      __topoRecordProbeEvent?: (event: InstrumentedEvent) => Promise<void>;
    };
    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target as HTMLFormElement | null;
        void instrumentedWindow.__topoRecordProbeEvent?.({
          kind: "form-submit",
          summary: `Form submitted to ${form?.action || window.location.href}`,
        });
      },
      true,
    );
    const observer = new MutationObserver((records) => {
      if (records.length === 0) return;
      void instrumentedWindow.__topoRecordProbeEvent?.({
        kind: "dom",
        summary: `${records.length} DOM mutation(s) observed`,
      });
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
  });
}

export function isDestructiveControl(label: string, href = ""): boolean {
  return /\b(delete|remove|destroy|pay|payment|purchase|cancel|send|logout|log out|sign out|irreversible)\b/i.test(
    `${label} ${href}`,
  );
}

function safetyReason(info: ControlInfo): string | undefined {
  if (info.disabled) return "Control is disabled";
  if (info.hidden) return "Control is hidden and cannot be safely activated";
  if (info.probePolicy.toLowerCase() === "skip") {
    return 'Control is explicitly excluded with data-topo-probe="skip"';
  }
  if (
    isDestructiveControl(info.descriptor, `${info.href} ${info.formAction}`)
  ) {
    return "Control label or destination matched the destructive-action safety policy";
  }
  if (
    info.formAction &&
    info.formMethod !== "get" &&
    info.probePolicy.toLowerCase() !== "safe"
  ) {
    return `Control submits a non-GET form (${info.formMethod.toUpperCase()}) without data-topo-probe="safe"`;
  }
  return undefined;
}

function findingFor(observation: RuntimeObservation): Finding {
  return {
    id: observation.id,
    severity: "low",
    status: "open",
    title: "Control may be inert",
    description:
      "The isolated runtime probe activated this control and observed no recognized navigation, network, DOM, dialog, form, download, focus, storage, application-event, or runtime-error effect. This is evidence for review, not an automatic broken-control verdict.",
    evidence: [
      `Probe artifact: ${observation.id}`,
      `Probe route: ${observation.routePath}`,
      ...observation.evidence,
    ],
    confidence: 0.82,
  };
}

function addEffect(
  effects: Map<RuntimeEffectKind, RuntimeEffect>,
  kind: RuntimeEffectKind,
  summary: string,
): void {
  if (!effects.has(kind)) effects.set(kind, { kind, summary });
}

function orderedEffects(
  effects: Map<RuntimeEffectKind, RuntimeEffect>,
): RuntimeEffect[] {
  return EFFECT_ORDER.flatMap((kind) => {
    const effect = effects.get(kind);
    return effect ? [effect] : [];
  });
}

export async function probeRoute(
  options: RuntimeProbeOptions,
): Promise<RuntimeProbeResult> {
  const session = await (options.openSession ?? openPreview)(options);
  const observations: RuntimeObservation[] = [];
  const instrumentedEvents: InstrumentedEvent[] = [];
  try {
    const page = session.page;
    const requestPath = options.previewPath ?? options.routePath;
    const routeUrl = new URL(requestPath, options.baseUrl).toString();
    await page.exposeBinding(
      "__topoRecordProbeEvent",
      (_source, event: InstrumentedEvent) => {
        if (event?.kind === "form-submit" || event?.kind === "dom") {
          instrumentedEvents.push(event);
        }
      },
    );
    await page.goto(routeUrl, { waitUntil: "domcontentloaded" });
    const controls = page.locator("button, a[href], [role=button]");
    const total = Math.min(await controls.count(), options.maxControls ?? 40);

    for (let index = 0; index < total; index += 1) {
      await page.goto(routeUrl, { waitUntil: "domcontentloaded" });
      await installInstrumentation(page);
      await page.waitForTimeout(25);
      instrumentedEvents.length = 0;
      const control = page.locator("button, a[href], [role=button]").nth(index);
      const info = await inspectControl(page, index);
      const controlId = controlIdentity(options.routePath, info);
      const base: Omit<
        InteractionProbeArtifact,
        "status" | "effects" | "evidence" | "observedAt"
      > = {
        version: 1,
        id: artifactIdentity(controlId),
        routePath: options.routePath,
        ...(options.previewPath ? { previewPath: options.previewPath } : {}),
        ...(options.screenId ? { screenId: options.screenId } : {}),
        control: {
          index,
          id: controlId,
          label: info.label,
          tagName: info.tagName,
          role: info.role,
          locator: info.locator,
        },
      };
      const unsafe = safetyReason(info);
      if (unsafe) {
        observations.push({
          ...base,
          status: "skipped",
          effects: [],
          evidence: [unsafe],
          observedAt: new Date().toISOString(),
        });
        continue;
      }

      const requests: string[] = [];
      const dialogs: string[] = [];
      const downloads: string[] = [];
      const runtimeErrors: string[] = [];
      const popups: string[] = [];
      const onRequest = (request: { url(): string }) =>
        requests.push(request.url());
      const onPageError = (error: Error) => runtimeErrors.push(error.message);
      const onDialog = (dialog: {
        message(): string;
        dismiss(): Promise<void>;
      }) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      };
      const onDownload = (download: { suggestedFilename(): string }) =>
        downloads.push(download.suggestedFilename());
      const onPopup = (popup: { url(): string; close(): Promise<void> }) => {
        popups.push(popup.url());
        void popup.close();
      };
      page.on("request", onRequest);
      page.on("pageerror", onPageError);
      page.on("dialog", onDialog);
      page.on("download", onDownload);
      page.on("popup", onPopup);
      const before = await readPageState(page);
      let activationError: string | undefined;

      try {
        await control.click({ timeout: 1_500 });
        await page
          .waitForLoadState("domcontentloaded", { timeout: 1_500 })
          .catch(() => undefined);
        await page.waitForTimeout(options.settleMs ?? 200);
      } catch (error: unknown) {
        activationError =
          error instanceof Error ? error.message : "Unable to activate control";
      }

      let after: PageState | undefined;
      try {
        after = await readPageState(page);
      } catch (error: unknown) {
        activationError ??=
          error instanceof Error
            ? error.message
            : "Unable to read the page after activation";
      }
      page.off("request", onRequest);
      page.off("pageerror", onPageError);
      page.off("dialog", onDialog);
      page.off("download", onDownload);
      page.off("popup", onPopup);

      const effects = new Map<RuntimeEffectKind, RuntimeEffect>();
      if (after && after.href !== before.href) {
        addEffect(effects, "navigation", `URL changed to ${after.href}`);
      } else if (popups.length > 0) {
        addEffect(effects, "navigation", `Opened ${popups[0]}`);
      }
      if (requests.length > 0) {
        addEffect(
          effects,
          "network",
          `${requests.length} network request(s): ${requests.slice(0, 3).join(", ")}`,
        );
      }
      const domEvents = instrumentedEvents.filter(
        (event) => event.kind === "dom",
      );
      if (
        domEvents.length > 0 ||
        (after &&
          (after.domFingerprint !== before.domFingerprint ||
            after.accessibility !== before.accessibility))
      ) {
        addEffect(
          effects,
          "dom",
          domEvents[0]?.summary ??
            "DOM or accessibility representation changed",
        );
      }
      if (dialogs.length > 0) {
        addEffect(effects, "dialog", `Dialog opened: ${dialogs[0]}`);
      }
      const formEvents = instrumentedEvents.filter(
        (event) => event.kind === "form-submit",
      );
      if (formEvents.length > 0) {
        addEffect(effects, "form-submit", formEvents[0]!.summary);
      }
      if (downloads.length > 0) {
        addEffect(effects, "download", `Downloaded ${downloads[0]}`);
      }
      if (
        after &&
        after.active !== before.active &&
        after.active !== info.activeIdentity
      ) {
        addEffect(
          effects,
          "focus",
          `Focus changed to ${after.active || "document"}`,
        );
      }
      if (after && after.storage !== before.storage) {
        addEffect(effects, "storage", "Local or session storage changed");
      }
      if (after && after.appEvents !== before.appEvents) {
        addEffect(
          effects,
          "app-event",
          "Preview bridge recorded an application event",
        );
      }
      if (runtimeErrors.length > 0) {
        addEffect(
          effects,
          "runtime-error",
          `Runtime error: ${runtimeErrors[0]}`,
        );
      }

      const ordered = orderedEffects(effects);
      const evidence = [
        `Activated ${info.locator} on ${options.routePath}${options.previewPath ? ` via ${options.previewPath}` : ""}`,
      ];
      if (ordered.length > 0) {
        evidence.push(...ordered.map((effect) => effect.summary));
      } else if (!activationError) {
        evidence.push(
          `Observed no recognized effect after ${options.settleMs ?? 200}ms`,
        );
      }
      observations.push({
        ...base,
        status: activationError
          ? "activation-error"
          : ordered.length > 0
            ? "effect-observed"
            : "possibly-inert",
        effects: ordered,
        evidence,
        observedAt: new Date().toISOString(),
        ...(activationError ? { error: activationError } : {}),
      });
    }
  } finally {
    await session.close();
  }

  return {
    observations,
    findings: observations
      .filter((observation) => observation.status === "possibly-inert")
      .map(findingFor),
  };
}
