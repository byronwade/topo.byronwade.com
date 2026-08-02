# `@topo/gateway`

The loopback-only profile gateway has a deliberately small lifecycle: configure it, call `listen()`, and later call `close()`.

```ts
import { createPreviewGateway } from "@topo/gateway";

const gateway = createPreviewGateway({
  targetBaseUrl: "http://127.0.0.1:3000",
  profiles: [
    { name: "Anonymous" },
    {
      name: "Owner",
      headers: { "x-preview-role": "owner" },
      cookies: [{ name: "preview_auth", value: "local-owner" }],
      localStorage: { "app:preview-role": "owner" },
    },
  ],
});

const sessions = await gateway.listen();
// sessions[0].baseUrl   -> clean, profile-isolated origin
// sessions[0].launchUrl -> opaque first-navigation capability

await gateway.close();
```

Each profile receives a distinct loopback host, so application and Topo cookies cannot cross profile boundaries. The launch capability is opaque and expiring; its bootstrap establishes an HTTP-only partitioned session, initializes configured local storage, and redirects to a clean URL. HTTP, redirects, request bodies, CORS origins, response cookies, and WebSocket/HMR traffic are forwarded to the application's real development server.

Framing restrictions are adapted only inside this signed local boundary. After session validation, eligible successful UTF-8 HTML may also receive the credential-free `@topo/runtime-bridge` bootstrap. The gateway buffers at most 10 MiB, adds only the bridge's exact SHA-256 source hash when the existing script policy requires it, and leaves compressed, non-HTML, unsupported-charset, remote, unsigned, or already-instrumented responses alone. Other CSP directives remain intact, production authentication is never changed, configured credentials stay server-side, and remote targets or binds fail closed.
