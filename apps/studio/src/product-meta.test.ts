import { describe, expect, it } from "vitest";

import { distributionLabel, topoProduct } from "./product-meta";

describe("Studio product metadata", () => {
  it("renders canonical manifest version and repository actions", () => {
    expect(topoProduct.version).toBe("0.1.0");
    expect(topoProduct.distribution.status).toBe("source-preview");
    expect(distributionLabel(topoProduct.distribution.status)).toBe(
      "Source preview",
    );
    expect(topoProduct.links.source).toBe(
      "https://github.com/byronwade/topo.byronwade.com",
    );
    expect(topoProduct.links.documentation.endsWith("/tree/main/docs")).toBe(
      true,
    );
    expect(topoProduct.links.license.endsWith("/blob/main/LICENSE")).toBe(true);
  });
});
