export default {
  preview: {
    baseUrl: "http://localhost:3020",
    server: { mode: "auto" },
    routes: {
      "/customers/[customerId]": "/customers/acme-plumbing",
    },
  },
  profiles: [
    {
      name: "Anonymous",
      headers: { "x-topo-preview-role": "anonymous" },
      localStorage: { "topo:preview-role": "anonymous" },
    },
    {
      name: "Owner",
      headers: { "x-topo-preview-role": "owner" },
      cookies: [{ name: "topo_fixture_role", value: "owner", path: "/" }],
      localStorage: { "topo:preview-role": "owner" },
    },
  ],
};
