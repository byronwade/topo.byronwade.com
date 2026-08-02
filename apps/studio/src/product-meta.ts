import productManifest from "../../../docs/product.json";

interface ProductMetadata {
  productVersion: string;
  repository: string;
  distribution: {
    status: "source-preview" | "package-preview" | "released";
    packageName: string;
    packagePublished: boolean;
  };
}

const manifest = productManifest as ProductMetadata;
const repository = manifest.repository.replace(/\/+$/, "");

export const topoProduct = Object.freeze({
  version: manifest.productVersion,
  repository,
  distribution: manifest.distribution,
  license: "Apache-2.0",
  links: Object.freeze({
    source: repository,
    documentation: `${repository}/tree/main/docs`,
    issues: `${repository}/issues/new`,
    license: `${repository}/blob/main/LICENSE`,
    releases: `${repository}/releases`,
  }),
});

export function distributionLabel(
  status: ProductMetadata["distribution"]["status"],
): string {
  if (status === "released") return "Released";
  if (status === "package-preview") return "Package preview";
  return "Source preview";
}
