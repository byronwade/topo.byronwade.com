# `@topo/diagnostics`

Combines static candidates and optional isolated runtime observations into the graph's review findings. Runtime runs are explicit and route-scoped, continue after one route fails, retain every observation as a durable probe artifact, and reconcile generated findings without deleting adapter findings or evidence from routes outside the rerun. Callers can inject the probe implementation for adapter/testing boundaries.
