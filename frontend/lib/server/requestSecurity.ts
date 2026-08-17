import "server-only";
import { timingSafeEqual } from "node:crypto";

export function hasValidBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const receivedBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}
