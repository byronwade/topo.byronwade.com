import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false });
    return;
  }
  response.status(200).json({ ok: true, router: "pages" });
}
