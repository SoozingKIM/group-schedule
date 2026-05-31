import { NextResponse } from "next/server";
import { updateTeam, deleteTeam } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const team = await updateTeam(params.id, params.tid, body);
  if (!team) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(team);
}

export async function DELETE(request, { params }) {
  const ok = await deleteTeam(params.id, params.tid);
  if (!ok) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
