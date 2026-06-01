import { NextResponse } from "next/server";
import { addLocation } from "@/lib/db";
import { withActor } from "@/lib/route-actor";

export const dynamic = "force-dynamic";

export const POST = withActor(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const loc = await addLocation(params.id, body?.name);
  if (!loc) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(loc, { status: 201 });
});
