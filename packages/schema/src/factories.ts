import type { ApplicationGraph } from "./index.js";
import { GraphVersion } from "./constants.js";

/**
 * Create the disconnected graph used before a scanner or daemon has supplied
 * repository-backed state. This module deliberately has no validation-runtime
 * dependency so browser shells can construct their empty state without loading
 * Zod. Untrusted graph data must still cross ApplicationGraphSchema.
 */
export function emptyApplicationGraph(rootDir: string): ApplicationGraph {
  return {
    version: GraphVersion,
    generatedAt: new Date().toISOString(),
    rootDir,
    previewBaseUrl: "http://localhost:3000",
    framework: "unknown",
    screens: [],
    components: [],
    apiEndpoints: [],
    projectRecognition: {
      version: 1,
      status: "unknown",
      frameworks: [],
      capabilities: [],
      sourceFileCount: 0,
    },
    flowTransitions: [],
    inferredFlows: [],
    edges: [],
    findings: [],
    sourceIssues: [],
  };
}
