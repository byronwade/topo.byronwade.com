---
title: "Hosted product direction"
description: "The possible GitHub-connected collaboration model and the decisions that remain open."
public: true
order: 80
updated: 2026-08-02
---

# Hosted product direction

Topo’s current product is local-first and does not require an account. The hosted product described here is being considered; it is not available and pricing has not been set.

## Hosted workspaces

The likely commercial boundary is shared coordination rather than local understanding. A hosted workspace could retain project baselines, review history, approvals, reports, and organization policy while the local daemon continues to scan and capture source applications.

## GitHub connection

A GitHub application could connect repositories to Topo projects, run governed review jobs for pull requests, and keep team-visible history. The design must preserve least-privilege repository access, explicit installation scope, auditable jobs, and clear retention controls.

## Organization MCP

A hosted MCP server could let authorized agents query shared project context, retained reviews, baselines, and organization decisions. Local source context should remain separable from hosted history, and every response must preserve project and organization authorization.

## Pricing boundary

The working principle is:

> Local understanding stays free. Shared coordination and retained history may be paid.

Community is currently free. Hosted and Enterprise pricing remain deliberately unset until the collaboration model, operating cost, and user value are validated.

## Distribution roadmap

The current MVP is a source preview with a verified package artifact. `@topo/cli` bundles the internal implementation and compiled Studio into a tarball with no private `@topo/*` runtime dependencies. The package gate installs that tarball into an isolated project, exercises help and a no-write initialization plan, applies a Next.js setup, and verifies manifest-backed uninstall. It also validates and reports the Studio build contract's schema-version-3 six-check evidence, including deferred Pixi, review rendering, and strict validation. Its release contract requires public package metadata, provenance, build/version agreement, exact release-tag identity, and a retained consumer-tested artifact. GitHub CI now names and runs the complete browser/native verification matrix, while a published release can hand that exact tarball to npm through OIDC without a long-lived write token.

The npm package is still unpublished. npm-scope/package ownership, the npm trusted-publisher relationship, GitHub environment and tag protections, one successful provenance-bearing registry release, update behavior against the registry, and public installation evidence remain release work and must not be described as available yet.

## Open decisions

- Whether the first hosted wedge is private reports, pull-request reviews, or full project workspaces.
- How long hosted snapshots and review context should be retained.
- Whether self-hosting belongs only in Enterprise.
- How an organization MCP server scopes repositories, projects, and people.
- Whether pricing should be per person, per organization, or usage-aware.
