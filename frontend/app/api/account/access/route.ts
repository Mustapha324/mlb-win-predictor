import { getServerAccess } from "@/lib/server/access";

export async function GET(): Promise<Response> {
  const access = await getServerAccess();
  return Response.json(access, { headers: { "Cache-Control": "private, no-store" } });
}
