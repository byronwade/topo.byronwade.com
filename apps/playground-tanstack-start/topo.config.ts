export default {
  preview: {
    baseUrl: "http://localhost:3030",
    server: { mode: "auto" },
    routes: {
      "/work-orders/:workOrderId": "/work-orders/wo-2041",
    },
  },
  profiles: [
    { name: "Anonymous" },
    {
      name: "Dispatcher",
      headers: { "x-topo-fixture-role": "dispatcher" },
    },
  ],
};
