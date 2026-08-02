import type { ResourceKind } from "@topo/protocol";
import type { ApplicationGraph } from "@topo/schema";

const loadStudioValidation = () => import("./studio-validation");

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export async function parseGraphUpdate(
  value: string,
): Promise<ApplicationGraph | undefined> {
  const result = (await loadStudioValidation()).parseGraphEvent(
    parseJson(value),
  );
  return result.success ? result.data.graph : undefined;
}

export async function parseResourceUpdate(
  value: string,
): Promise<ResourceKind | undefined> {
  const result = (await loadStudioValidation()).parseResourceEvent(
    parseJson(value),
  );
  return result.success ? result.data.resource : undefined;
}
