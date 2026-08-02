import { json } from "@sveltejs/kit";

export function GET() {
  return json({ jobs: [] });
}

export async function POST({ request }: { request: Request }) {
  return json({ job: await request.json() }, { status: 201 });
}
