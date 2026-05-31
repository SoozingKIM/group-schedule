// 클라이언트용 fetch 헬퍼 (브라우저에서만 사용)

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
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
