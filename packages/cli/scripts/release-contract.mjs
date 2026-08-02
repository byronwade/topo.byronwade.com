const PACKAGE_NAME = "@topo/cli";
const REPOSITORY = "git+https://github.com/byronwade/topo.byronwade.com.git";
const HOMEPAGE = "https://topo.byronwade.com";
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function record(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function stringEntries(value) {
  return Object.entries(record(value)).filter(
    ([, child]) => typeof child === "string",
  );
}

/**
 * Validate the complete registry-facing CLI contract without contacting npm.
 * The packed manifest is authoritative because it is the artifact consumers
 * install; build.json ties that artifact back to the compiled Studio and CLI.
 */
export function validateCliReleaseContract({
  manifest,
  buildManifest,
  releaseTag,
}) {
  const packageManifest = record(manifest);
  const build = record(buildManifest);
  const publishConfig = record(packageManifest.publishConfig);
  const repository = record(packageManifest.repository);
  const binaries = record(packageManifest.bin);
  const rootExport = record(record(packageManifest.exports)["."]);
  const engines = record(packageManifest.engines);
  const packageFiles = Array.isArray(packageManifest.files)
    ? packageManifest.files
    : [];
  const runtimeDependencies = [
    ...stringEntries(packageManifest.dependencies),
    ...stringEntries(packageManifest.optionalDependencies),
    ...stringEntries(packageManifest.peerDependencies),
  ];
  const issues = [];
  const version = packageManifest.version;
  const expectedTag = typeof version === "string" ? `v${version}` : "";

  if (packageManifest.name !== PACKAGE_NAME)
    issues.push(`package name must be ${PACKAGE_NAME}`);
  if (typeof version !== "string" || !SEMVER.test(version))
    issues.push("package version must be valid semver");
  if (packageManifest.private !== false)
    issues.push("package private must be explicitly false");
  if (packageManifest.license !== "Apache-2.0")
    issues.push("package license must be Apache-2.0");
  if (repository.type !== "git" || repository.url !== REPOSITORY)
    issues.push(`repository must be ${REPOSITORY}`);
  if (packageManifest.homepage !== HOMEPAGE)
    issues.push(`homepage must be ${HOMEPAGE}`);
  if (engines.node !== ">=24") issues.push("Node engine must be >=24");
  if (binaries.topo !== "dist/index.js")
    issues.push("topo binary must target dist/index.js");
  if (
    rootExport.types !== "./dist/index.d.ts" ||
    rootExport.import !== "./dist/index.js"
  )
    issues.push("root export must expose compiled ESM and declarations");
  if (!packageFiles.includes("dist") || !packageFiles.includes("README.md"))
    issues.push("package files must include dist and README.md");
  if (publishConfig.access !== "public")
    issues.push("publish access must be public");
  if (publishConfig.provenance !== true)
    issues.push("npm provenance must remain enabled");

  const internalDependencies = runtimeDependencies
    .filter(([name]) => name.startsWith("@topo/"))
    .map(([name]) => name)
    .sort();
  const workspaceDependencies = runtimeDependencies
    .filter(([, specifier]) => specifier.startsWith("workspace:"))
    .map(([name]) => name)
    .sort();
  if (internalDependencies.length > 0)
    issues.push(
      `runtime dependencies cannot include internal packages: ${internalDependencies.join(", ")}`,
    );
  if (workspaceDependencies.length > 0)
    issues.push(
      `runtime dependencies cannot use workspace specifiers: ${workspaceDependencies.join(", ")}`,
    );

  if (build.schemaVersion !== 1)
    issues.push("build manifest must use schemaVersion 1");
  if (build.package !== packageManifest.name)
    issues.push("build package identity must match the packed manifest");
  if (build.version !== version)
    issues.push("build version must match the packed manifest");
  if (build.entry !== "index.js") issues.push("build entry must be index.js");
  if (build.studio !== "studio/index.html")
    issues.push("build Studio entry must be studio/index.html");
  if (build.bundledInternalPackages !== true)
    issues.push("internal Topo packages must be bundled");

  const normalizedTag =
    typeof releaseTag === "string" && releaseTag.trim()
      ? releaseTag.trim()
      : undefined;
  if (normalizedTag && normalizedTag !== expectedTag)
    issues.push(
      `release tag ${normalizedTag} must exactly match package version ${expectedTag}`,
    );

  if (issues.length > 0)
    throw new Error(`CLI release contract failed: ${issues.join("; ")}`);

  return {
    schemaVersion: 1,
    package: PACKAGE_NAME,
    version,
    expectedTag,
    releaseTag: normalizedTag ?? null,
    tagVerified: normalizedTag !== undefined,
    public: true,
    provenance: true,
    node: engines.node,
    entry: binaries.topo,
    studio: build.studio,
    bundledInternalPackages: true,
    runtimeDependencies: runtimeDependencies
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right)),
  };
}
