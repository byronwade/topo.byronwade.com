export default {
  rootDir: ".",
  daemon: { host: "127.0.0.1", port: 4599 },
  preview: {
    baseUrl: "http://localhost:3060",
    server: { mode: "auto" },
    routes: { "/projects/:projectId": "/projects/atlas" },
  },
  profiles: [{ name: "Anonymous" }],
  extensions: {
    frameworkAdapters: [],
    componentPreviewAdapters: [],
    applicationRuntimeAdapters: [],
  },
};
