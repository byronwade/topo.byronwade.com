export async function GET() {
  return Response.json({ customers: [] });
}

export async function POST(request: Request) {
  return Response.json({ customer: await request.json() }, { status: 201 });
}
