import type { MetadataRoute } from "next";

import { getAllDocs } from "../lib/docs";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://topo.byronwade.com";
  const updated = new Date("2026-07-31");
  const routes = ["", "/docs", "/demo", "/pricing", "/download"];
  const docs = await getAllDocs();
  return [
    ...routes.map((route) => ({
      url: `${base}${route}`,
      lastModified: updated,
    })),
    ...docs.map((doc) => ({
      url: `${base}/docs/${doc.slug}`,
      lastModified: new Date(doc.updated),
    })),
  ];
}
