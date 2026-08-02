import { emptyApplicationGraph, type ApplicationGraph } from "@topo/schema";

export function makeTestGraph(overrides: Partial<ApplicationGraph> = {}): ApplicationGraph { return { ...emptyApplicationGraph("test://topo"), ...overrides }; }
