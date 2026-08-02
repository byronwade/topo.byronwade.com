import { describe, expect, it } from "vitest";

import { validateCliReleaseContract } from "./release-contract.mjs";

function fixture() {
  return {
    manifest: {
      name: "@topo/cli",
      version: "0.1.0",
      private: false,
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/byronwade/topo.byronwade.com.git",
      },
      homepage: "https://topo.byronwade.com",
      engines: { node: ">=24" },
      files: ["dist", "README.md"],
      publishConfig: { access: "public", provenance: true },
      bin: { topo: "dist/index.js" },
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
      dependencies: { zod: "3.25.76" },
    },
    buildManifest: {
      schemaVersion: 1,
      package: "@topo/cli",
      version: "0.1.0",
      entry: "index.js",
      studio: "studio/index.html",
      bundledInternalPackages: true,
    },
  };
}

describe("CLI release contract", () => {
  it("returns exact machine-readable release evidence", () => {
    expect(
      validateCliReleaseContract({ ...fixture(), releaseTag: "v0.1.0" }),
    ).toEqual({
      schemaVersion: 1,
      package: "@topo/cli",
      version: "0.1.0",
      expectedTag: "v0.1.0",
      releaseTag: "v0.1.0",
      tagVerified: true,
      public: true,
      provenance: true,
      node: ">=24",
      entry: "dist/index.js",
      studio: "studio/index.html",
      bundledInternalPackages: true,
      runtimeDependencies: ["zod"],
    });
  });

  it("rejects a release tag that does not exactly match the package", () => {
    expect(() =>
      validateCliReleaseContract({ ...fixture(), releaseTag: "v0.2.0" }),
    ).toThrow("release tag v0.2.0 must exactly match package version v0.1.0");
  });

  it("rejects private, internal, or workspace-bound runtime packages", () => {
    const input = fixture();
    input.manifest.private = true;
    input.manifest.dependencies = {
      "@topo/schema": "workspace:*",
      zod: "workspace:^",
    };
    expect(() => validateCliReleaseContract(input)).toThrow(
      "package private must be explicitly false",
    );
    expect(() => validateCliReleaseContract(input)).toThrow(
      "runtime dependencies cannot include internal packages: @topo/schema",
    );
    expect(() => validateCliReleaseContract(input)).toThrow(
      "runtime dependencies cannot use workspace specifiers: @topo/schema, zod",
    );
  });

  it("rejects build evidence from a different package version", () => {
    const input = fixture();
    input.buildManifest.version = "0.0.9";
    expect(() => validateCliReleaseContract(input)).toThrow(
      "build version must match the packed manifest",
    );
  });
});
