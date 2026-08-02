import { describe, expect, it } from "vitest";

import { resolveDaemonUrl } from "./daemon-url.js";

describe("resolveDaemonUrl", () => {
  it("prefers an explicit build-time origin", () => {
    expect(
      resolveDaemonUrl({
        environmentUrl: "http://127.0.0.1:4601/",
        embeddedUrl: "http://127.0.0.1:4599",
        currentOrigin: "http://127.0.0.1:4173",
        production: true,
      }),
    ).toBe("http://127.0.0.1:4601");
  });

  it("uses daemon evidence injected by the local Studio host", () => {
    expect(
      resolveDaemonUrl({
        embeddedUrl: "http://127.0.0.1:4599",
        currentOrigin: "http://127.0.0.1:4173",
        production: true,
      }),
    ).toBe("http://127.0.0.1:4599");
  });

  it("uses the production origin only when no embedded value exists", () => {
    expect(
      resolveDaemonUrl({
        embeddedUrl: "__TOPO_DAEMON_URL__",
        currentOrigin: "https://studio.example.com/",
        production: true,
      }),
    ).toBe("https://studio.example.com");
  });

  it("keeps the source-development default and ignores unsafe values", () => {
    expect(
      resolveDaemonUrl({
        embeddedUrl: "javascript:alert(1)",
        currentOrigin: "http://127.0.0.1:4173",
        production: false,
      }),
    ).toBe("http://localhost:4599");
  });
});
