import { getServerAccess } from "@/lib/server/access";

export async function GET(): Promise<Response> {
  const access = await getServerAccess();
  return Response.json({ authenticated: access.authenticated }, { headers: { "Cache-Control": "private, no-store" } });
}
