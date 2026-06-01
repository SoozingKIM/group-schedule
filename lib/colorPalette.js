// 사이트 전역 색 팔레트 — 10가지 기본 색
// 각 항목: key(직렬화용), name(한글 라벨), hex, accent(테두리·선택 셀용 진한 색)
export const COLOR_PALETTE = [
  { key: "red",     name: "빨강", hex: "#e5484d", accent: "#c5363a" },
  { key: "orange",  name: "주황", hex: "#f76707", accent: "#c4520a" },
  { key: "amber",   name: "호박", hex: "#d97706", accent: "#a55a04" },
  { key: "green",   name: "초록", hex: "#22c55e", accent: "#16a34a" },
  { key: "teal",    name: "청록", hex: "#14b8a6", accent: "#0d9488" },
  { key: "blue",    name: "파랑", hex: "#4f6ef7", accent: "#3a59e8" },
  { key: "indigo",  name: "남색", hex: "#6366f1", accent: "#4f52d4" },
  { key: "purple",  name: "보라", hex: "#a855f7", accent: "#8a36da" },
  { key: "pink",    name: "핑크", hex: "#ec4899", accent: "#d63685" },
  { key: "gray",    name: "회색", hex: "#6b7280", accent: "#4b5263" },
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
export const DEFAULT_PALETTE_KEY = "blue";
