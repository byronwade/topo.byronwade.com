export default {
  preview: {
    baseUrl: "http://localhost:3000",
    server: { mode: "auto" },
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
    {
      name: "Customer",
      headers: { "x-topo-preview-role": "customer" },
      cookies: [{ name: "topo_fixture_role", value: "customer", path: "/" }],
      localStorage: { "topo:preview-role": "customer" },
    },
  ],
};
