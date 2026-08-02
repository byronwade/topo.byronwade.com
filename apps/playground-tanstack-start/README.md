# TanStack Start compatibility playground

This permanent fixture proves Topo against a real TanStack React Start application. It is intentionally small, deterministic, and independent from the Studio demo.

The contract includes:

- the current `@tanstack/react-start` package plus the official Nitro/Vite server integration;
- generated-tree routes for `/`, `/work-orders`, `/work-orders/$workOrderId`, and `/settings/team`;
- one server function invoked by the index route loader;
- one constructible zero-prop component and one required-prop coverage gap;
- the checked-in `review-start-work-order` flow;
- stable `data-topo-screen` browser identities.

Run it directly with `pnpm --filter @topo/playground-tanstack-start dev`, or exercise it through the repository compatibility gate with `pnpm verify:framework-fixtures`.
