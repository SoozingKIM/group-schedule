// 간단한 토스트 메시지 (화면 하단 알림)
let timer = null;

export function toast(message) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("show"), 1800);
}
