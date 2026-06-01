import { NextResponse } from "next/server";
import { getProject, updateProject, deleteProject } from "@/lib/db";
import { withActor } from "@/lib/route-actor";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(p);
}

export const PATCH = withActor(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const p = await updateProject(params.id, body);
  if (!p) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(p);
});

export const DELETE = withActor(async (request, { params }) => {
  const ok = await deleteProject(params.id);
  if (!ok) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
