import productData from "../../../docs/product.json";

export type FeatureStatus =
  "available" | "preview" | "planned" | "considering" | "removed";

export interface ProductFeature {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: FeatureStatus;
  docs: string[];
}

export interface ProductPlan {
  id: string;
  name: string;
  availability: "available" | "considering" | "planned";
  priceLabel: string;
  summary: string;
  features: string[];
}

export interface ProductManifest {
  productVersion: string;
  updatedAt: string;
  repository: string;
  distribution: {
    status: "source-preview" | "package-preview" | "released";
    packageName: string;
    packagePublished: boolean;
  };
  plans: ProductPlan[];
  features: ProductFeature[];
}

export const product = productData as ProductManifest;

export function featuresForPlan(plan: ProductPlan): ProductFeature[] {
  const featureById = new Map(
    product.features.map((feature) => [feature.id, feature]),
  );
  return plan.features.flatMap((featureId) => {
    const feature = featureById.get(featureId);
    return feature ? [feature] : [];
  });
}

export function statusLabel(status: FeatureStatus): string {
  if (status === "available") return "Available now";
  if (status === "preview") return "Preview";
  if (status === "considering") return "Exploring";
  if (status === "removed") return "Removed";
  return "Planned";
}
