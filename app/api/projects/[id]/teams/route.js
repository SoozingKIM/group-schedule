import { NextResponse } from "next/server";
import { addTeam } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const team = await addTeam(params.id, body?.name, body?.memberIds, body?.locationId || null);
  if (!team) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(team, { status: 201 });
}
