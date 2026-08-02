import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { StudioLocation, StudioOverlay } from "./design/boards";
import type { StudioNote, StudioSettings } from "./studio-model";
import type { useTopoData } from "./useTopoData";
import type { CanvasInteractionMode } from "@topo/react";
import type { RuntimeBridgeEvent } from "@topo/runtime-bridge";
import type { Flow } from "@topo/schema";
import type { WriteNoteInput } from "@topo/schema";
import type { StudioSelectionState } from "@topo/studio-api";
import type { FlowTraceSession } from "./flow-trace";

export type TopoData = ReturnType<typeof useTopoData>;

export type StudioSelection = StudioSelectionState;

export interface StudioFlowTraceRuntime {
  session?: FlowTraceSession;
  start(): void;
  record(events: readonly RuntimeBridgeEvent[]): void;
  finish(): Promise<Flow | undefined>;
  cancel(): void;
}

export interface StudioActions {
  navigate(path: string): void;
  /** Navigate by destination id (or an absolute path), with an optional view. */
  go(destinationOrPath: string, view?: string): void;
  closeOverlay(): void;
  openOverlay(overlay: Exclude<StudioOverlay, undefined>): void;
  createNote(input: WriteNoteInput): Promise<StudioNote | undefined>;
  selectScreen(id: string): void;
  selectFlow(id: string): void;
  selectFlowStep(id: string): void;
  selectComponent(id: string): void;
  selectApiEndpoint(id: string): void;
  selectComponentPreview(id: string): void;
  selectNote(id: string): void;
  selectFinding(id?: string): void;
  selectProbe(id?: string): void;
}

export interface TopoStudioRuntime {
  data: TopoData;
  location: StudioLocation;
  selection: StudioSelection;
  actions: StudioActions;
  canvas: {
    mode: CanvasInteractionMode;
    setMode(mode: CanvasInteractionMode): void;
    fit(): void;
  };
  flowTrace: StudioFlowTraceRuntime;
  settings: StudioSettings;
  setSettings: Dispatch<SetStateAction<StudioSettings>>;
}

const TopoStudioContext = createContext<TopoStudioRuntime | undefined>(
  undefined,
);

export function TopoStudioProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: TopoStudioRuntime;
}) {
  return (
    <TopoStudioContext.Provider value={runtime}>
      {children}
    </TopoStudioContext.Provider>
  );
}

export function useStudio(): TopoStudioRuntime {
  const runtime = useContext(TopoStudioContext);
  if (!runtime) {
    throw new Error("useStudio must be used inside TopoStudioProvider");
  }
  return runtime;
}
