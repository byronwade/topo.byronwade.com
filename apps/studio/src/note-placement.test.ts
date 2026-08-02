import { describe, expect, it } from "vitest";

import { NoteAnchorSchema } from "@topo/schema";

import {
  createPlacedNoteUpdate,
  normalizeArtboardPoint,
  resolveNotePlacement,
} from "./note-placement";
import { fixtureGraph, type StudioNote } from "./studio-model";

const screen = fixtureGraph.screens[0]!;
const note: StudioNote = {
  version: 1,
  id: "note:placement",
  type: "element",
  title: "Pin the call to action",
  body: "The label needs revision.",
  targetKind: "screen",
  targetId: screen.id,
  targetRoute: screen.routePath,
  status: "open",
  author: "byron",
  anchor: {
    status: "drifted",
    source: screen.source,
    componentSymbol: "MarketingHero",
    role: "button",
    accessibleName: "Watch the tour",
    testLocator: "hero-tour",
    domFingerprint: "fixture-a91c",
    coordinates: { x: 0.1, y: 0.2 },
    driftPixels: 14,
  },
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

describe("note placement geometry", () => {
  it("normalizes transformed client coordinates and clamps the artboard edge", () => {
    expect(
      normalizeArtboardPoint(
        { x: 490, y: 390 },
        { left: 100, top: 37, width: 780, height: 706 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      normalizeArtboardPoint(
        { x: 20, y: 900 },
        { left: 100, top: 37, width: 780, height: 706 },
      ),
    ).toEqual({ x: 0, y: 1 });
  });

  it("uses the released point for a point placement", () => {
    expect(
      resolveNotePlacement("point", { x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }),
    ).toEqual({ x: 0.7, y: 0.8 });
  });

  it("canonicalizes a reverse-dragged region", () => {
    expect(
      resolveNotePlacement("region", { x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 }),
    ).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.6 });
  });

  it("rejects accidental region clicks", () => {
    expect(
      resolveNotePlacement("region", { x: 0.2, y: 0.2 }, { x: 0.205, y: 0.6 }),
    ).toBeUndefined();
  });
});

describe("placed note updates", () => {
  it("records current live inspection signals instead of carrying stale evidence", () => {
    const update = createPlacedNoteUpdate(
      screen,
      { x: 0.35, y: 0.45 },
      "2026-08-01T13:00:00.000Z",
      {
        role: "link",
        accessibleName: "Read the guide",
        testLocator: '[data-testid="hero-guide"]',
        domFingerprint: "new-element-fingerprint",
      },
    );

    expect(update).toMatchObject({
      targetKind: "screen",
      targetId: screen.id,
      targetRoute: screen.routePath,
      anchor: {
        status: "attached",
        source: screen.source,
        role: "link",
        accessibleName: "Read the guide",
        testLocator: '[data-testid="hero-guide"]',
        domFingerprint: "new-element-fingerprint",
        coordinates: { x: 0.35, y: 0.45 },
        verifiedAt: "2026-08-01T13:00:00.000Z",
      },
    });
    expect(update.anchor).not.toHaveProperty("driftPixels");
    expect(() => NoteAnchorSchema.parse(update.anchor)).not.toThrow();
  });

  it("keeps coordinate-only placement explicit when no live bridge responds", () => {
    const nextScreen = fixtureGraph.screens.find(
      (candidate) => candidate.id !== screen.id,
    )!;
    const update = createPlacedNoteUpdate(
      nextScreen,
      { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
      "2026-08-01T13:00:00.000Z",
    );

    expect(update.anchor).toEqual({
      status: "attached",
      source: nextScreen.source,
      coordinates: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
      verifiedAt: "2026-08-01T13:00:00.000Z",
    });
  });
});
