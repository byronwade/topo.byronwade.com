import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFlowStore, parseFlowJson, renderFlowJson } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("flow store", () => {
  it("round trips branching flow JSON", () => {
    const flow = parseFlowJson(
      renderFlowJson({
        version: 1,
        id: "checkout",
        title: "Checkout",
        description: "Complete a purchase.",
        status: "verified",
        entryStepId: "cart",
        tags: ["commerce"],
        steps: [
          {
            id: "cart",
            title: "Review cart",
            routePath: "/cart",
            noteIds: [],
            nextStepIds: ["pay"],
          },
          {
            id: "pay",
            title: "Pay",
            routePath: "/checkout",
            noteIds: [],
            nextStepIds: [],
          },
        ],
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
      }),
    );

    expect(flow.steps[0]?.nextStepIds).toEqual(["pay"]);
  });

  it("persists flows and reports malformed files to readers", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-flows-"));
    temporaryDirectories.push(directory);
    const store = createFlowStore(directory);
    await store.write({
      id: "onboarding",
      title: "Onboarding",
      entryStepId: "start",
      steps: [
        {
          id: "start",
          title: "Start",
          routePath: "/start",
          noteIds: [],
          nextStepIds: [],
        },
      ],
    });
    await fs.writeFile(
      path.join(directory, ".topo", "flows", "broken.json"),
      "{ nope",
      "utf8",
    );

    const inspection = await store.inspect();
    expect(inspection.flows.map((flow) => flow.id)).toEqual(["onboarding"]);
    expect(inspection.issues[0]?.filePath).toBe(".topo/flows/broken.json");
  });

  it("updates branching definitions atomically and can clear the entry step", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-flows-"));
    temporaryDirectories.push(directory);
    const store = createFlowStore(directory);
    const created = await store.write({
      id: "customer-review",
      title: "Customer review",
      entryStepId: "open",
      steps: [
        {
          id: "open",
          title: "Open customer",
          routePath: "/customers/:id",
          noteIds: [],
          nextStepIds: [],
        },
      ],
    });

    vi.setSystemTime(new Date("2026-08-01T02:00:00.000Z"));
    const updated = await store.update(created.id, {
      title: "Review customer branches",
      entryStepId: null,
      status: "verified",
    });

    expect(updated).toMatchObject({
      id: created.id,
      title: "Review customer branches",
      status: "verified",
      createdAt: "2026-08-01T01:00:00.000Z",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    expect(updated?.entryStepId).toBeUndefined();
    expect(updated?.steps).toEqual(created.steps);
    expect(await store.update("missing", { title: "No flow" })).toBeUndefined();
  });

  it("preserves namespaced ids without colliding with hyphenated ids", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-flows-"));
    temporaryDirectories.push(directory);
    const store = createFlowStore(directory);

    await store.write({ id: "journey:checkout", title: "Namespaced" });
    await store.write({ id: "journey-checkout", title: "Hyphenated" });

    expect(await store.get("journey:checkout")).toMatchObject({
      title: "Namespaced",
    });
    expect(await store.get("journey-checkout")).toMatchObject({
      title: "Hyphenated",
    });
    expect(await fs.readdir(path.join(directory, ".topo", "flows"))).toEqual(
      expect.arrayContaining([
        "journey%3Acheckout.json",
        "journey-checkout.json",
      ]),
    );
  });

  it("serializes concurrent updates from independent store instances", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-flows-"));
    temporaryDirectories.push(directory);
    await createFlowStore(directory).write({
      id: "parallel-review",
      title: "Parallel review",
    });

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        createFlowStore(directory).update("parallel-review", {
          description: `writer-${index}`,
        }),
      ),
    );

    const flow = await createFlowStore(directory).get("parallel-review");
    expect(flow?.description).toBe("writer-23");
    expect(
      (await fs.readdir(path.join(directory, ".topo", "flows"))).filter(
        (name) => name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  }, 15_000);

  it("removes only the exact encoded flow identity", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-flows-"));
    temporaryDirectories.push(directory);
    const store = createFlowStore(directory);
    await store.write({ id: "journey:checkout", title: "Namespaced" });
    await store.write({ id: "journey-checkout", title: "Hyphenated" });

    expect(await store.remove("journey:checkout")).toBe(true);
    expect(await store.remove("journey:checkout")).toBe(false);
    expect(await store.get("journey-checkout")).toMatchObject({
      title: "Hyphenated",
    });
  });
});
