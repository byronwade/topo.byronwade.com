import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  ApplicationRuntimeStartError,
  nextApplicationRuntimeAdapter,
  nuxtApplicationRuntimeAdapter,
  packageScriptApplicationRuntimeAdapter,
  resolveApplicationRuntimeAdapter,
  startApplicationRuntime,
  tanStackApplicationRuntimeAdapter,
  viteApplicationRuntimeAdapter,
  type ApplicationRuntimeContext,
  type TopoApplicationRuntime,
} from "./index.js";

const temporaryDirectories: string[] = [];
const openServers: Server[] = [];
const runtimes: TopoApplicationRuntime[] = [];

afterEach(async () => {
  await Promise.allSettled(
    runtimes.splice(0).map((runtime) => runtime.close()),
  );
  await Promise.allSettled(
    openServers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.allSettled(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixtureRoot(manifest: object = {}): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "topo-app-runtime-"));
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "runtime-fixture", ...manifest }, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ready");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function context(
  dependencies: readonly string[],
  scripts: Readonly<Record<string, string>> = { dev: "fixture" },
): ApplicationRuntimeContext {
  return {
    rootDir: "C:/fixture",
    baseUrl: "http://127.0.0.1:4321/",
    host: "127.0.0.1",
    port: 4321,
    packageManager: "pnpm",
    scripts,
    dependencies: new Set(dependencies),
  };
}

async function writeServerScript(
  rootDir: string,
  options: { exitAfterMs?: number; neverListen?: boolean } = {},
): Promise<void> {
  await writeFile(
    path.join(rootDir, "server.mjs"),
    `import { createServer } from "node:http";
console.log("fixture boot");
console.log("fixture args", JSON.stringify(process.argv.slice(2)));
${
  options.neverListen
    ? 'console.error("fixture failed"); process.exit(23);'
    : `const server = createServer((_request, response) => response.end("ready"));
server.listen(Number(process.env.PORT), process.env.HOST, () => console.log("fixture ready"));
${options.exitAfterMs ? `setTimeout(() => server.close(() => process.exit(17)), ${options.exitAfterMs});` : ""}`
}
`,
    "utf8",
  );
}

describe("application runtime adapters", () => {
  it("resolves framework-specific commands before the generic fallback", async () => {
    expect(
      await nextApplicationRuntimeAdapter.resolve(context(["next"])),
    ).toMatchObject({
      confidence: 1,
      command: {
        type: "package-script",
        script: "dev",
        args: ["--hostname", "127.0.0.1", "--port", "4321"],
      },
    });
    expect(
      await tanStackApplicationRuntimeAdapter.resolve(
        context(["@tanstack/react-router", "vite"]),
      ),
    ).toMatchObject({
      confidence: 0.95,
      command: {
        args: ["--host", "127.0.0.1", "--port", "4321", "--strictPort"],
      },
    });
    expect(
      await tanStackApplicationRuntimeAdapter.resolve(
        context(["@tanstack/react-start", "vite"]),
      ),
    ).toMatchObject({
      confidence: 0.95,
      command: {
        args: ["--host", "127.0.0.1", "--port", "4321", "--strictPort"],
      },
    });
    expect(
      await nuxtApplicationRuntimeAdapter.resolve(context(["nuxt"])),
    ).toMatchObject({
      confidence: 1,
      command: {
        args: ["--host", "127.0.0.1", "--port", "4321"],
      },
    });
    expect(
      await viteApplicationRuntimeAdapter.resolve(context(["vite", "vue"])),
    ).toMatchObject({
      confidence: 0.9,
      command: {
        args: ["--host", "127.0.0.1", "--port", "4321", "--strictPort"],
      },
    });
    expect(
      await packageScriptApplicationRuntimeAdapter.resolve(context([])),
    ).toMatchObject({
      confidence: 0.25,
      command: { type: "package-script", script: "dev" },
    });
  });

  it("does not claim a package without a dev script", async () => {
    expect(
      await nextApplicationRuntimeAdapter.resolve(context(["next"], {})),
    ).toBeUndefined();
    expect(
      await tanStackApplicationRuntimeAdapter.resolve(
        context(["@tanstack/react-router"], {}),
      ),
    ).toBeUndefined();
    expect(
      await nuxtApplicationRuntimeAdapter.resolve(context(["nuxt"], {})),
    ).toBeUndefined();
    expect(
      await viteApplicationRuntimeAdapter.resolve(context(["vite"], {})),
    ).toBeUndefined();
    expect(
      await packageScriptApplicationRuntimeAdapter.resolve(context([], {})),
    ).toBeUndefined();
  });

  it("validates and selects adapters without starting a process", async () => {
    await expect(
      resolveApplicationRuntimeAdapter(context(["next"]), [
        packageScriptApplicationRuntimeAdapter,
        nextApplicationRuntimeAdapter,
      ]),
    ).resolves.toMatchObject({
      adapterId: "next",
      resolution: { confidence: 1 },
    });
    await expect(
      resolveApplicationRuntimeAdapter(context([], {}), [
        nextApplicationRuntimeAdapter,
      ]),
    ).resolves.toBeUndefined();
    await expect(
      resolveApplicationRuntimeAdapter(context([]), [
        {
          apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
          id: "acme.invalid",
          displayName: "Invalid",
          resolve: () => ({
            confidence: 2,
            reasons: [],
            command: { type: "package-script", script: "dev" },
          }),
        },
      ]),
    ).rejects.toThrow("invalid match evidence");
  });
});

describe("startApplicationRuntime", { timeout: 20_000 }, () => {
  it("reuses a reachable application without taking process ownership", async () => {
    const rootDir = await fixtureRoot();
    const existing = await serve();
    const runtime = await startApplicationRuntime({
      rootDir,
      baseUrl: existing.url,
    });
    runtimes.push(runtime);

    expect(runtime.ownership).toBe("reused");
    expect(runtime.adapterId).toBe("external");
    expect(runtime.pid).toBeUndefined();
    await runtime.close();
    expect(await fetch(existing.url).then((response) => response.text())).toBe(
      "ready",
    );
  });

  it("starts an explicit tokenized command, retains logs, and releases the port", async () => {
    const rootDir = await fixtureRoot();
    await writeServerScript(rootDir);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const streamed: string[] = [];
    const runtime = await startApplicationRuntime({
      rootDir,
      baseUrl: url,
      command: [process.execPath, "server.mjs"],
      readyTimeoutMs: 10_000,
      onLog: (entry) => streamed.push(entry.text),
    });
    runtimes.push(runtime);

    expect(runtime.ownership).toBe("managed");
    expect(runtime.adapterId).toBe("configured");
    expect(runtime.pid).toBeTypeOf("number");
    expect(await fetch(url).then((response) => response.text())).toBe("ready");
    expect(streamed).toContain("fixture boot");
    expect(
      runtime.getRecentLogs().some((line) => line.text === "fixture ready"),
    ).toBe(true);

    await runtime.close();
    await expect(fetch(url)).rejects.toThrow();
    await expect(runtime.exit).resolves.toMatchObject({ expected: true });
  });

  it("runs a detected package script through the platform package manager", async () => {
    const rootDir = await fixtureRoot({
      packageManager: "pnpm@10.12.1",
      scripts: { dev: "node server.mjs" },
      dependencies: {
        "@tanstack/react-router": "1.0.0",
        vite: "8.0.0",
      },
    });
    await writeServerScript(rootDir);
    const port = await freePort();
    const runtime = await startApplicationRuntime({
      rootDir,
      baseUrl: `http://127.0.0.1:${port}`,
      readyTimeoutMs: 10_000,
    });
    runtimes.push(runtime);

    expect(runtime.adapterId).toBe("tanstack");
    expect(runtime.ownership).toBe("managed");
    expect(
      runtime
        .getRecentLogs()
        .some((line) =>
          line.text.includes(
            `fixture args ["--host","127.0.0.1","--port","${port}","--strictPort"]`,
          ),
        ),
    ).toBe(true);
    await runtime.close();
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
  }, 15_000);

  it("surfaces bounded process output when startup exits early", async () => {
    const rootDir = await fixtureRoot();
    await writeServerScript(rootDir, { neverListen: true });
    const port = await freePort();

    await expect(
      startApplicationRuntime({
        rootDir,
        baseUrl: `http://127.0.0.1:${port}`,
        command: [process.execPath, "server.mjs"],
        readyTimeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      name: "ApplicationRuntimeStartError",
      logs: expect.arrayContaining([
        expect.objectContaining({ text: "fixture failed" }),
      ]),
    });
  });

  it("reports an unexpected exit after readiness", async () => {
    const rootDir = await fixtureRoot();
    await writeServerScript(rootDir, { exitAfterMs: 500 });
    const port = await freePort();
    const runtime = await startApplicationRuntime({
      rootDir,
      baseUrl: `http://127.0.0.1:${port}`,
      command: [process.execPath, "server.mjs"],
      readyTimeoutMs: 10_000,
    });
    runtimes.push(runtime);

    await expect(runtime.exit).resolves.toEqual({
      code: 17,
      signal: null,
      expected: false,
    });
  });

  it("loads a project runtime adapter without lifecycle changes", async () => {
    const projectRoot = await fixtureRoot();
    const rootDir = path.join(projectRoot, "apps", "web");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      path.join(rootDir, "package.json"),
      '{"name":"nested-runtime-fixture"}\n',
      "utf8",
    );
    await writeServerScript(rootDir);
    await writeFile(
      path.join(projectRoot, "runtime-adapter.mjs"),
      `export const applicationRuntimeAdapter = {
  apiVersion: ${APPLICATION_RUNTIME_ADAPTER_API_VERSION},
  id: "fixture.runtime",
  displayName: "Fixture runtime",
  resolve: () => ({
    confidence: 1,
    reasons: ["Fixture adapter"],
    command: { type: "process", executable: ${JSON.stringify(process.execPath)}, args: ["server.mjs"] }
  })
};
`,
      "utf8",
    );
    const port = await freePort();
    const runtime = await startApplicationRuntime({
      rootDir,
      adapterRootDir: projectRoot,
      baseUrl: `http://127.0.0.1:${port}`,
      adapterModules: ["./runtime-adapter.mjs"],
      readyTimeoutMs: 10_000,
    });
    runtimes.push(runtime);

    expect(runtime.adapterId).toBe("fixture.runtime");
    expect(runtime.ownership).toBe("managed");
  });

  it("keeps remote and explicitly external origins reuse-only", async () => {
    const rootDir = await fixtureRoot();
    const port = await freePort();
    await expect(
      startApplicationRuntime({
        rootDir,
        baseUrl: `http://127.0.0.1:${port}`,
        mode: "external",
      }),
    ).rejects.toThrow("Start it separately");

    const unavailableRemoteFetch: typeof fetch = async () => {
      throw new TypeError("offline");
    };
    await expect(
      startApplicationRuntime({
        rootDir,
        baseUrl: "https://example.com",
        command: [process.execPath, "server.mjs"],
        fetch: unavailableRemoteFetch,
      }),
    ).rejects.toThrow("must be started externally");
  });

  it("refuses to take over an occupied origin in managed mode", async () => {
    const rootDir = await fixtureRoot();
    const existing = await serve();
    await expect(
      startApplicationRuntime({
        rootDir,
        baseUrl: existing.url,
        mode: "managed",
      }),
    ).rejects.toBeInstanceOf(ApplicationRuntimeStartError);
  });
});
