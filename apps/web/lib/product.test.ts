import { describe, expect, it } from "vitest";

import { featuresForPlan, product } from "./product";

describe("public product manifest", () => {
  it("keeps the current Community plan and hosted direction distinct", () => {
    const community = product.plans.find((plan) => plan.id === "community");
    const hosted = product.plans.find((plan) => plan.id === "hosted");

    expect(community?.availability).toBe("available");
    expect(hosted?.availability).toBe("considering");
    expect(hosted?.priceLabel).not.toMatch(/^\$/);
  });

  it("resolves plan features from the canonical manifest", () => {
    for (const plan of product.plans) {
      expect(featuresForPlan(plan)).toHaveLength(plan.features.length);
    }
  });
});
