// API 라우트에서 X-Actor 헤더를 읽어 actorContext 안에서 핸들러를 실행하는 헬퍼.
//   - 'owner' 또는 'guest' 이외 값은 'unknown'으로 정리
//   - 핸들러 시그니처는 Next.js App Router의 (request, ctx) 그대로
import { actorContext } from "@/lib/store/util";

function normalize(v) {
  return v === "owner" ? "owner" : v === "guest" ? "guest" : "unknown";
}
export function withActor(handler) {
  return async function (request, ctx) {
    const actor = normalize(request.headers.get("x-actor"));
    return actorContext.run(actor, () => handler(request, ctx));
  };
}
