import type { NextRequest } from "next/server";
import { ESPN_CODES, normalizeSummary } from "@/components/prototype/espn";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CACHE_SECONDS = 15;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const code = request.nextUrl.searchParams.get("code") ?? "";
  // Both end up in a server-side URL, so only known shapes get through.
  if (!/^\d{1,12}$/.test(id) || !Object.values(ESPN_CODES).includes(code)) {
    return Response.json({ error: "Неверный запрос" }, { status: 400 });
  }
  const response = await fetch(`${BASE}/${code}/summary?event=${id}`, { next: { revalidate: CACHE_SECONDS } });
  if (!response.ok) return Response.json({ error: "Данные матча недоступны" }, { status: 502 });
  return Response.json(normalizeSummary(await response.json()));
}
