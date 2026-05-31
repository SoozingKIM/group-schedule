import { NextResponse } from "next/server";
import { addLocation } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const loc = await addLocation(params.id, body?.name);
  if (!loc) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(loc, { status: 201 });
}
