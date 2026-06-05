// 사이트 전역 색 팔레트 — 기본 + 쨍한 비비드 컬러
// 각 항목: key(직렬화용), name(한글 라벨), hex, accent(테두리·선택 셀용 진한 색)
export const COLOR_PALETTE = [
  // 기본 색
  { key: "red",     name: "빨강",   hex: "#e5484d", accent: "#c5363a" },
  { key: "orange",  name: "주황",   hex: "#f76707", accent: "#c4520a" },
  { key: "amber",   name: "호박",   hex: "#d97706", accent: "#a55a04" },
  { key: "green",   name: "초록",   hex: "#22c55e", accent: "#16a34a" },
  { key: "teal",    name: "청록",   hex: "#14b8a6", accent: "#0d9488" },
  { key: "blue",    name: "파랑",   hex: "#4f6ef7", accent: "#3a59e8" },
  { key: "indigo",  name: "남색",   hex: "#6366f1", accent: "#4f52d4" },
  { key: "purple",  name: "보라",   hex: "#a855f7", accent: "#8a36da" },
  { key: "pink",    name: "핑크",   hex: "#ec4899", accent: "#d63685" },
  { key: "gray",    name: "회색",   hex: "#6b7280", accent: "#4b5263" },
  // 비비드 — 눈에 잘 띄는 쨍한 색
  { key: "yellow",  name: "노랑",   hex: "#facc15", accent: "#ca9c0a" },
  { key: "lime",    name: "라임",   hex: "#84cc16", accent: "#65a30d" },
  { key: "cyan",    name: "시안",   hex: "#06b6d4", accent: "#0891b2" },
  { key: "magenta", name: "마젠타", hex: "#d946ef", accent: "#a821c1" },
  { key: "coral",   name: "코랄",   hex: "#fb7185", accent: "#e11d48" },
  { key: "mint",    name: "민트",   hex: "#34d399", accent: "#10b981" },
  // 형광 — 하이라이터처럼 가장 눈에 띄는 톤
  { key: "neon-yellow", name: "형광 노랑", hex: "#fff700", accent: "#cccc00" },
  { key: "neon-green",  name: "형광 초록", hex: "#39ff14", accent: "#22cc00" },
  { key: "neon-orange", name: "형광 주황", hex: "#ff7f00", accent: "#cc6600" },
  { key: "neon-pink",   name: "형광 핑크", hex: "#ff36ab", accent: "#d6188a" },
  { key: "neon-cyan",   name: "형광 하늘", hex: "#00f3ff", accent: "#00c0cc" },
  { key: "neon-violet", name: "형광 보라", hex: "#bf00ff", accent: "#9900cc" },
];

const BY_KEY = Object.fromEntries(COLOR_PALETTE.map((p) => [p.key, p]));
export function paletteEntry(key) {
  return BY_KEY[key] || null;
}
export function paletteRgba(key, alpha) {
  const e = BY_KEY[key];
  if (!e) return null;
  const hex = e.hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
// 글자 가독성용 어두운 톤 — 광휘도가 높은(형광·노랑 등) 색은 검정과 섞어 충분히 진하게 만듦
export function paletteDarkText(key) {
  const e = BY_KEY[key];
  if (!e) return "#1f2330";
  const hex = e.hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // 단순 광휘도 (0~1)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.45) return hex; // 이미 충분히 어두움
  // 검정과 섞어 진하게 — 광휘도가 높을수록 더 많이 어둡게
  const t = lum < 0.65 ? 0.55 : lum < 0.8 ? 0.4 : 0.32;
  const mix = (c) => Math.round(c * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
export const DEFAULT_PALETTE_KEY = "blue";
