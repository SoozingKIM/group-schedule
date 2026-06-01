// 클라이언트용 fetch 헬퍼 (브라우저에서만 사용)

// 현재 권한(owner/guest)을 X-Actor 헤더로 보내, 백엔드 활동 로그에 기록되게 함.
// 페이지에서 setActor("owner" | "guest")로 갱신.
let currentActor = "guest";
export function setActor(a) {
  if (a === "owner" || a === "guest") currentActor = a;
}

async function req(method, url, body) {
  const headers = { "X-Actor": currentActor };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "요청 실패";
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (url) => req("GET", url),
  post: (url, body) => req("POST", url, body),
  patch: (url, body) => req("PATCH", url, body),
  del: (url) => req("DELETE", url),
};
