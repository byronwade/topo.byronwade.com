export type StudioDestination = string;

export type StudioOverlay =
  "navigation" | "command" | "welcome" | "annotate" | "export" | undefined;

export interface StudioLocation {
  destination: StudioDestination;
  view: string;
  overlay?: StudioOverlay;
  canvas?: "map";
}

export {
  studioBoards as PAPER_BOARD_CONTRACTS,
  studioFrame as PAPER_STUDIO_FRAME,
} from "@topo/studio-api";
export type { StudioBoard as PaperBoardContract } from "@topo/studio-api";
