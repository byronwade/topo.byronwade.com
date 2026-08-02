export default {
  preview: {
    baseUrl: "http://localhost:3010",
    server: { mode: "auto" },
    routes: {
      "/jobs/:jobId": "/jobs/rf-1042",
    },
    components: {
      "src/components/StatusCard.tsx": {
        source: "src/previews/StatusCard.preview.tsx",
        exportName: "ConfiguredStatusCard",
        title: "Configured status card",
      },
    },
  },
};
