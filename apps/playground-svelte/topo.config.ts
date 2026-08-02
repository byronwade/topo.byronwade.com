export default {
  rootDir: ".",
  daemon: { host: "127.0.0.1", port: 4599 },
  preview: {
    baseUrl: "http://localhost:3080",
    server: { mode: "auto" },
    routes: { "/jobs/:jobId": "/jobs/topo-1042" },
  },
  profiles: [{ name: "Anonymous" }],
  extensions: {
    frameworkAdapters: [],
    componentPreviewAdapters: [],
    applicationRuntimeAdapters: [],
  },
};
