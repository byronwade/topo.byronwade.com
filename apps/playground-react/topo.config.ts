export default {
  rootDir: ".",
  daemon: { host: "127.0.0.1", port: 4599 },
  preview: {
    baseUrl: "http://localhost:3050",
    server: { mode: "auto" },
    routes: { "/customers/:customerId": "/customers/acme-plumbing" },
  },
  profiles: [{ name: "Anonymous" }],
  extensions: {
    frameworkAdapters: [],
    componentPreviewAdapters: [],
    applicationRuntimeAdapters: [],
  },
};
