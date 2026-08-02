import { lazy } from "react";

import { useStudio } from "./studio-runtime";

const AtlasWorkspace = lazy(async () => {
  const module = await import("./components/AtlasWorkspace");
  return { default: module.AtlasWorkspace };
});

const EditorWorkspace = lazy(async () => {
  const module = await import("./components/EditorWorkspace");
  return { default: module.EditorWorkspace };
});

const NotesWorkspace = lazy(async () => {
  const module = await import("./components/NotesWorkspace");
  return { default: module.NotesWorkspace };
});

const DoctorWorkspace = lazy(async () => {
  const module = await import("./components/DoctorWorkspace");
  return { default: module.DoctorWorkspace };
});

const SettingsWorkspace = lazy(async () => {
  const module = await import("./components/SettingsWorkspace");
  return { default: module.SettingsWorkspace };
});

export function AtlasDestination() {
  const { actions, canvas, data, flowTrace, location, selection, settings } =
    useStudio();
  const previewSession = data.getPreviewSession(settings.previewProfile);
  const previewProfile = previewSession?.profileName ?? settings.previewProfile;
  return (
    <AtlasWorkspace
      atlasOrganization={data.atlasOrganization}
      busyAction={data.busyAction}
      canvasView={location.canvas}
      connected={data.connected}
      flows={data.flows}
      graph={data.graph}
      interactionProbes={data.interactionProbes}
      interactionMode={canvas.mode}
      flowTrace={flowTrace}
      maxLiveScreens={settings.maxLiveScreens}
      notes={data.notes}
      previewArtifacts={data.previewArtifacts}
      previewBaseUrl={previewSession?.launchUrl ?? data.graph.previewBaseUrl}
      promoteOnHover={settings.promoteOnHover}
      snapshots={data.snapshots}
      visualBaselines={data.visualBaselines}
      visualComparisons={data.visualComparisons}
      onAcceptVisualBaseline={(screenId) =>
        void data.acceptVisualBaseline(screenId)
      }
      onCapture={() => void data.capture(previewProfile)}
      onCaptureComponents={(componentIds) =>
        void data.captureComponents(componentIds, previewProfile)
      }
      onCreateFlow={async () => {
        const created = await data.createFlow({ title: "Untitled flow" });
        if (created) {
          actions.selectFlow(created.id);
          actions.selectFlowStep(created.entryStepId ?? "");
        }
        return created;
      }}
      onDeleteFlow={async (flowId) => {
        const removed = await data.deleteFlow(flowId);
        if (removed) {
          const next = data.flows.find((flow) => flow.id !== flowId);
          actions.selectFlow(next?.id ?? "");
          actions.selectFlowStep(next?.entryStepId ?? next?.steps[0]?.id ?? "");
        }
        return removed;
      }}
      onNavigate={actions.navigate}
      onOpenProbe={() => actions.navigate("/atlas/probe")}
      onRunProbe={(routePath) =>
        void data.runChecks({
          runtime: true,
          routes: [routePath],
          profile: previewProfile,
        })
      }
      onScaffoldComponentPreview={data.scaffoldComponentPreview}
      onSelectComponent={actions.selectComponent}
      onSelectApiEndpoint={actions.selectApiEndpoint}
      onSelectComponentPreview={actions.selectComponentPreview}
      onSelectFlow={actions.selectFlow}
      onSelectFlowStep={actions.selectFlowStep}
      onSelectProbe={actions.selectProbe}
      onSelectScreen={actions.selectScreen}
      onUpdateFlow={data.updateFlow}
      selectedComponentId={selection.componentId}
      selectedEndpointId={selection.endpointId}
      selectedPreviewId={selection.previewId}
      selectedFlowId={selection.flowId}
      selectedFlowStepId={selection.flowStepId}
      selectedProbeId={selection.probeId}
      selectedScreenId={selection.screenId}
      view={location.view}
    />
  );
}

export function NotesDestination() {
  const { actions, canvas, data, location, selection, settings } = useStudio();
  const previewSession = data.getPreviewSession(settings.previewProfile);
  return (
    <NotesWorkspace
      busyAction={data.busyAction}
      connected={data.connected}
      graph={data.graph}
      interactionMode={canvas.mode}
      notes={data.notes}
      previewBaseUrl={previewSession?.launchUrl ?? data.graph.previewBaseUrl}
      snapshots={data.snapshots}
      onDeleteNote={data.deleteNote}
      onNavigate={actions.navigate}
      onSelectNote={actions.selectNote}
      onSelectScreen={actions.selectScreen}
      onUpdateNote={data.updateNote}
      selectedNoteId={selection.noteId}
      view={location.view}
    />
  );
}

export function DoctorDestination() {
  const { actions, canvas, data, location, selection, settings } = useStudio();
  const previewSession = data.getPreviewSession(settings.previewProfile);
  return (
    <DoctorWorkspace
      busyAction={data.busyAction}
      connected={data.connected}
      doctorReport={data.doctorReport}
      graph={data.graph}
      interactionMode={canvas.mode}
      notes={data.notes}
      onNavigate={actions.navigate}
      onRunChecks={() =>
        void (async () => {
          await data.runChecks();
          if (settings.runtimeDiagnostics) {
            await data.runChecks({
              runtime: true,
              profile: previewSession?.profileName ?? settings.previewProfile,
            });
          }
        })()
      }
      onSelectFinding={actions.selectFinding}
      onSelectScreen={actions.selectScreen}
      previewBaseUrl={previewSession?.launchUrl ?? data.graph.previewBaseUrl}
      selectedScreenId={selection.screenId}
      selectedFindingId={selection.findingId}
      snapshots={data.snapshots}
      runtimeDiagnostics={settings.runtimeDiagnostics}
      view={location.view}
    />
  );
}

export function SettingsDestination() {
  const { actions, data, location, settings, setSettings } = useStudio();
  return (
    <SettingsWorkspace
      adapterInventory={data.adapterInventory}
      busyAction={data.busyAction}
      cacheReport={data.cacheReport}
      dataMode={data.mode}
      graph={data.graph}
      projectSettings={data.projectSettings}
      onChange={setSettings}
      onCleanCache={() => void data.cleanCache()}
      onNavigate={actions.navigate}
      settings={settings}
      previewSessions={data.previewSessions}
      view={location.view}
    />
  );
}

export function EditorDestination() {
  const { actions, canvas, data, location, selection, settings } = useStudio();
  const previewSession = data.getPreviewSession(settings.previewProfile);
  return (
    <EditorWorkspace
      connected={data.connected}
      graph={data.graph}
      interactionMode={canvas.mode}
      notes={data.notes}
      previewBaseUrl={previewSession?.launchUrl ?? data.graph.previewBaseUrl}
      onNavigate={actions.navigate}
      onSelectComponent={actions.selectComponent}
      onSelectFinding={actions.selectFinding}
      onSelectNote={actions.selectNote}
      onSelectScreen={actions.selectScreen}
      selectedScreenId={selection.screenId}
      snapshots={data.snapshots}
      view={location.view}
    />
  );
}
