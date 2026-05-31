import { NextResponse } from "next/server";
import { getRev } from "@/lib/db";

export const dynamic = "force-dynamic";

// 변경 감지용 가벼운 폴링 엔드포인트
export async function GET(request, { params }) {
  const rev = await getRev(params.id);
  if (rev === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ rev });
}
