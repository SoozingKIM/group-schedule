// 날짜/시간 격자 생성 헬퍼 (클라이언트·서버 공용, 외부 의존성 없음)

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n) {
  return String(n).padStart(2, "0");
}

// "YYYY-MM-DD" -> 날짜 컬럼 배열
export function generateDates(startDate, endDate) {
  const out = [];
  if (!startDate || !endDate) return out;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  let cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  let guard = 0;
  while (cur <= end && guard < 400) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1;
    const d = cur.getDate();
    const dow = cur.getDay();
    out.push({
      key: `${y}-${pad(m)}-${pad(d)}`,
      m,
      d,
      dow,
      dowLabel: DOW[dow],
      label: `${m}/${d}`,
    });
    cur = new Date(y, m - 1, d + 1);
    guard++;
  }
  return out;
}

// "HH:MM" -> 분
function toMinutes(t) {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return h * 60 + m;
}

// 30분 단위 시간 슬롯 배열 (각 슬롯은 시작 시각을 의미)
// 종료시간이 시작시간보다 빠르거나 같으면 "익일"로 간주해 자정을 넘겨 이어서 만든다.
// (예: 18:00 ~ 02:00 → 같은 날 컬럼에 18:00부터 익일 01:30까지 한 줄로)
export function generateSlots(startTime, endTime, slotMinutes = 30) {
  const out = [];
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end += 24 * 60; // 자정 넘김
  for (let t = start; t < end; t += slotMinutes) {
    const nextDay = t >= 24 * 60; // 자정 이후(익일) 슬롯
    const h = Math.floor(t / 60) % 24; // 24시 이상은 익일 00시~로 표시
    const m = t % 60;
    out.push({
      key: `${pad(h)}:${pad(m)}`,
      minutes: t, // 정렬·고유키용 (자정 이후는 1440+)
      label: `${pad(h)}:${pad(m)}`,
      isHour: m === 0, // 정시면 굵은 구분선
      nextDay,
    });
  }
  return out;
}

export function slotKey(dateKey, timeKey) {
  return `${dateKey}|${timeKey}`;
}

// 슬롯을 "시(時)" 단위로 묶음 — 시간 라벨 셀 병합(rowspan)에 사용
// 반환: [{ startIndex, span, hourLabel(0~23), nextDay }]
export function hourGroups(slots) {
  const groups = [];
  for (let i = 0; i < slots.length; i++) {
    const hour = Math.floor(slots[i].minutes / 60);
    const last = groups[groups.length - 1];
    if (last && last.hour === hour) {
      last.span += 1;
    } else {
      groups.push({
        startIndex: i,
        span: 1,
        hour,
        hourLabel: hour % 24, // 24시 이상(익일)은 0,1,2…로
        nextDay: !!slots[i].nextDay,
      });
    }
  }
  return groups;
}
