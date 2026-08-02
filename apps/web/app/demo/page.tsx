import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { buildStudioDemoUrl } from "../../lib/studio-demo";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Open the real Topo Studio with a deterministic demo project and explore every designed product view.",
};

export default function DemoPage() {
  redirect(buildStudioDemoUrl(process.env.TOPO_DEMO_STUDIO_URL));
}
