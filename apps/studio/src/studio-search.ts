import type {
  ApplicationGraph,
  Flow,
  InteractionProbeArtifact,
} from "@topo/schema";
import type { StudioSearchMatch, StudioSearchRecord } from "@topo/studio-api";
import type { DoctorReport } from "@topo/protocol";

import type { StudioNote } from "./studio-model";

export interface StudioProjectSearchSources {
  graph: ApplicationGraph;
  notes: readonly StudioNote[];
  flows: readonly Flow[];
  interactionProbes: readonly InteractionProbeArtifact[];
  doctorReport: DoctorReport;
}

export interface StudioSearchActions {
  go(destinationId: string, view?: string): void;
  selectScreen(id: string): void;
  selectComponent(id: string): void;
  selectApiEndpoint(id: string): void;
  selectFlow(id: string): void;
  selectFlowStep(id: string): void;
  selectNote(id: string): void;
  selectFinding(id: string): void;
  selectProbe(id: string): void;
}

function sourceText(source: { filePath: string; line?: number }): string {
  return `${source.filePath}${source.line ? `:${source.line}` : ""}`;
}

/**
 * Project canonical Studio records into a small, JSON-readable navigation
 * index. Every target keeps the exact stable entity identity used by Studio.
 */
export function createStudioProjectSearchRecords({
  graph,
  notes,
  flows,
  interactionProbes,
  doctorReport,
}: StudioProjectSearchSources): StudioSearchRecord[] {
  const screensByRoute = new Map(
    graph.screens.map((screen) => [screen.routePath, screen]),
  );
  const records: StudioSearchRecord[] = [];

  for (const screen of graph.screens) {
    records.push({
      id: `search:route:${screen.id}`,
      kind: "route",
      title: screen.routePath,
      description: `${screen.title} · ${screen.state} · ${screen.renderStatus}`,
      text: [
        screen.group,
        screen.framework,
        sourceText(screen.source),
        ...screen.tags,
      ].join(" "),
      target: {
        destinationId: "atlas",
        view: "routes",
        selection: { kind: "screen", id: screen.id },
      },
    });
  }

  for (const component of graph.components) {
    records.push({
      id: `search:component:${component.id}`,
      kind: "component",
      title: component.name,
      description: `${component.previewStatus} preview · used by ${component.usedBy.length} screens`,
      text: [
        sourceText(component.source),
        ...component.usedBy,
        ...component.previewSources.map((source) => JSON.stringify(source)),
      ].join(" "),
      target: {
        destinationId: "atlas",
        view: "components",
        selection: { kind: "component", id: component.id },
      },
    });
  }

  for (const endpoint of graph.apiEndpoints) {
    records.push({
      id: `search:api-endpoint:${endpoint.id}`,
      kind: "api-endpoint",
      title: `${endpoint.method} ${endpoint.path}`,
      description:
        endpoint.summary ??
        `${endpoint.security.status} security · ${endpoint.responses.length} responses`,
      text: [
        endpoint.operationId,
        endpoint.description,
        ...endpoint.tags,
        ...endpoint.frameworks,
        ...endpoint.adapterIds,
        JSON.stringify(endpoint.parameters),
        endpoint.requestContentTypes.join(" "),
        JSON.stringify(endpoint.responses),
        JSON.stringify(endpoint.discoveries),
      ]
        .filter(Boolean)
        .join(" "),
      target: {
        destinationId: "atlas",
        view: "apis",
        selection: { kind: "api-endpoint", id: endpoint.id },
      },
    });
  }

  for (const flow of flows) {
    records.push({
      id: `search:flow:${flow.id}`,
      kind: "flow",
      title: flow.title,
      description: `${flow.status} flow · ${flow.steps.length} steps`,
      text: [flow.id, flow.description, ...flow.tags].join(" "),
      target: {
        destinationId: "atlas",
        view: "flows",
        selection: { kind: "flow", id: flow.id },
      },
    });
    for (const step of flow.steps) {
      records.push({
        id: `search:flow-step:${flow.id}:${step.id}`,
        kind: "flow-step",
        title: `${flow.title} › ${step.title}`,
        description: [step.routePath ?? "Unbound route", step.action]
          .filter(Boolean)
          .join(" · "),
        text: [
          flow.id,
          step.id,
          step.screenId,
          step.expected,
          ...step.noteIds,
          ...step.nextStepIds,
        ]
          .filter(Boolean)
          .join(" "),
        target: {
          destinationId: "atlas",
          view: "flows",
          selection: {
            kind: "flow-step",
            id: step.id,
            parentId: flow.id,
          },
        },
      });
    }
  }

  for (const note of notes) {
    records.push({
      id: `search:note:${note.id}`,
      kind: "note",
      title: note.title,
      description: [note.status, note.type, note.targetRoute]
        .filter(Boolean)
        .join(" · "),
      text: [
        note.id,
        note.body,
        note.author,
        note.targetId,
        note.targetKind,
        note.anchor?.componentSymbol,
        note.anchor?.accessibleName,
        note.anchor?.testLocator,
        note.anchor?.source?.filePath,
      ]
        .filter(Boolean)
        .join(" "),
      target: {
        destinationId: "notes",
        view: "detail",
        selection: { kind: "note", id: note.id },
      },
    });
  }

  for (const finding of graph.findings) {
    records.push({
      id: `search:finding:${finding.id}`,
      kind: "finding",
      title: finding.title,
      description: `${finding.severity} · ${finding.status} · ${Math.round(finding.confidence * 100)}% confidence`,
      text: [
        finding.description,
        finding.source ? sourceText(finding.source) : undefined,
        ...finding.evidence,
      ]
        .filter(Boolean)
        .join(" "),
      target: {
        destinationId: "doctor",
        view: "findings",
        selection: { kind: "finding", id: finding.id },
      },
    });
  }

  for (const probe of interactionProbes) {
    const screen = probe.screenId
      ? graph.screens.find((candidate) => candidate.id === probe.screenId)
      : screensByRoute.get(probe.routePath);
    records.push({
      id: `search:interaction:${probe.id}`,
      kind: "interaction",
      title: probe.control.label,
      description: `${probe.status} · ${probe.routePath}`,
      text: [
        probe.control.role,
        probe.control.tagName,
        probe.control.locator,
        probe.error,
        ...probe.evidence,
        ...probe.effects.flatMap((effect) => [effect.kind, effect.summary]),
      ]
        .filter(Boolean)
        .join(" "),
      target: {
        destinationId: "atlas",
        view: "probe",
        selection: {
          kind: "interaction-probe",
          id: probe.id,
          ...(screen ? { parentId: screen.id } : {}),
        },
      },
    });
  }

  for (const check of doctorReport.checks) {
    records.push({
      id: `search:doctor-check:${check.id}`,
      kind: "doctor-check",
      title: check.title,
      description: `${check.status} · ${check.scope}`,
      text: [check.detail, check.action, JSON.stringify(check.evidence)]
        .filter(Boolean)
        .join(" "),
      target: { destinationId: "doctor", view: "index" },
    });
  }

  return records;
}

/** Apply one serialized search target through the ordinary Studio actions. */
export function activateStudioSearchResult(
  result: StudioSearchMatch,
  actions: StudioSearchActions,
): void {
  const selection = result.target.selection;
  if (selection) {
    switch (selection.kind) {
      case "screen":
        actions.selectScreen(selection.id);
        break;
      case "component":
        actions.selectComponent(selection.id);
        break;
      case "api-endpoint":
        actions.selectApiEndpoint(selection.id);
        break;
      case "flow":
        actions.selectFlow(selection.id);
        break;
      case "flow-step":
        if (selection.parentId) actions.selectFlow(selection.parentId);
        actions.selectFlowStep(selection.id);
        break;
      case "note":
        actions.selectNote(selection.id);
        break;
      case "finding":
        actions.selectFinding(selection.id);
        break;
      case "interaction-probe":
        if (selection.parentId) actions.selectScreen(selection.parentId);
        actions.selectProbe(selection.id);
        break;
    }
  }
  actions.go(result.target.destinationId, result.target.view);
}
