import { NextResponse } from "next/server";
import { addEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const ev = await addEvent(params.id, body);
  if (!ev) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(ev, { status: 201 });
}
