"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateDates, generateSlots, slotKey, hourGroups } from "@/lib/schedule";
import { paletteEntry, paletteRgba, DEFAULT_PALETTE_KEY } from "@/lib/colorPalette";

export function formatDuration(totalMin) {
  if (!totalMin) return "0분";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function slotEndTime(s) {
  const m = s.minutes + 30;
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

export default function OverviewGrid({ config, people, locationName, events = [], eventMode = false, onCreateEvent, onDeleteEvent, dateColors = {} }) {
  const dates = useMemo(() => generateDates(config.startDate, config.endDate), [config.startDate, config.endDate]);
  const slots = useMemo(
    () => generateSlots(config.startTime, config.endTime, config.slotMinutes || 30),
    [config.startTime, config.endTime, config.slotMinutes]
  );

  // 슬롯별로 가능한 사람 목록 계산
  const counts = useMemo(() => {
    const map = new Map(); // key -> [name, ...]
    for (const person of people) {
      for (const k of person.slots) {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(person.name);
      }
    }
    return map;
  }, [people]);

  const total = people.length;

  // 시간 라벨 셀 병합 정보
  const rowInfo = useMemo(() => {
    const info = new Array(slots.length).fill(null);
    for (const g of hourGroups(slots)) info[g.startIndex] = g;
    return info;
  }, [slots]);

  // 툴팁 상태 — 호버는 임시 표시, 클릭은 고정(pin)
  const [hover, setHover] = useState(null); // { key, dateLabel, timeLabel, x, y }
  const [pinned, setPinned] = useState(null);

  // 사람이 바뀌거나 핀된 칸이 없어지면 정리
  useEffect(() => {
    setPinned(null);
    setHover(null);
  }, [config.startDate, config.endDate, config.startTime, config.endTime, people.length]);

  // 핀이 있을 땐 핀이 우선, 없으면 호버
  const active = pinned || hover;

  // 문서 클릭 시 핀 해제 — 단, 다른 OverviewGrid의 셀 클릭은 무시 (각 grid가 독립적으로 핀 유지)
  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e) => {
      if (e.target.closest("td.heat")) return; // 셀 클릭은 그 셀의 onClick이 처리
      setPinned(null);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [pinned]);

  // ─── 일정 잡기 모드 ──────────────────────────────────────────────
  // eventDrag: 드래그 중 임시 상태 / eventInput: 드래그 종료 후 제목 입력 팝업
  const [eventDrag, setEventDrag] = useState(null); // { cIdx, startR, endR }
  const [eventInput, setEventInput] = useState(null); // { date, dt, startR, endR, x, y }
  const [hoverEvent, setHoverEvent] = useState(null); // { event, x, y }

  // 모드 종료 시 상태 정리
  useEffect(() => {
    if (!eventMode) {
      setEventDrag(null);
      setEventInput(null);
      setHoverEvent(null);
    } else {
      // 일정 모드에서는 일반 호버/핀 툴팁 끔
      setHover(null);
      setPinned(null);
    }
  }, [eventMode]);

  // 드래그 중 document 단위 pointermove/up 처리
  useEffect(() => {
    if (!eventDrag || !eventMode) return;
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el && el.closest && el.closest("td.heat");
      if (!td) return;
      const r = +td.dataset.r;
      const c = +td.dataset.c;
      if (c !== eventDrag.cIdx) return; // 같은 날짜 안에서만
      if (r === eventDrag.endR) return;
      setEventDrag((d) => (d ? { ...d, endR: r } : d));
    };
    const onUp = (e) => {
      const cur = eventDrag;
      if (!cur) return;
      const startR = Math.min(cur.startR, cur.endR);
      const endR = Math.max(cur.startR, cur.endR);
      const dt = dates[cur.cIdx];
      if (dt) {
        setEventInput({
          date: dt.key,
          dt,
          startR,
          endR,
          x: e.clientX,
          y: e.clientY,
        });
      }
      setEventDrag(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [eventDrag, eventMode, dates]);

  // 슬롯 라벨 → 인덱스 매핑으로 events를 셀 단위로 풀어둠
  const eventCells = useMemo(() => {
    const map = new Map(); // `${dateKey}:${r}` -> [{ event, isFirst, isLast }]
    for (const ev of events) {
      if (!ev || !ev.date || !ev.startTime || !ev.endTime) continue;
      const dateIdx = dates.findIndex((d) => d.key === ev.date);
      if (dateIdx === -1) continue;
      let firstR = -1;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].label === ev.startTime) { firstR = i; break; }
      }
      if (firstR === -1) continue;
      let lastR = -1;
      for (let i = firstR; i < slots.length; i++) {
        if (slotEndTime(slots[i]) === ev.endTime) { lastR = i; break; }
      }
      if (lastR === -1) continue;
      for (let i = firstR; i <= lastR; i++) {
        const k = `${ev.date}:${i}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ event: ev, isFirst: i === firstR, isLast: i === lastR });
      }
    }
    return map;
  }, [events, dates, slots]);

  if (dates.length === 0 || slots.length === 0) {
    return <div className="empty-hint">설정의 날짜/시간 범위를 확인하세요.</div>;
  }
  if (total === 0) {
    return <div className="empty-hint">아직 참여자가 없습니다. 사람을 추가해 일정을 입력해 보세요.</div>;
  }

  // 날짜별 색 강조: 해당 날짜에 지정된 팔레트 키(red/orange/...) 또는 null
  function getDateColor(dt) {
    const key = dateColors && dateColors[dt.key];
    return key && paletteEntry(key) ? key : null;
  }
  function bg(count, colorKey) {
    if (count === 0) return "#fff";
    const alpha = 0.18 + (count / total) * 0.82;
    const key = colorKey || DEFAULT_PALETTE_KEY;
    return paletteRgba(key, alpha) || paletteRgba(DEFAULT_PALETTE_KEY, alpha);
  }
  function fg(count) {
    return count / total > 0.55 ? "#fff" : "#1f2330";
  }
  // 인접 셀과 색이 다른 경계에서 좌/우 테두리를 그림
  function colClass(c, dt) {
    const color = getDateColor(dt);
    if (!color) return "";
    let s = " marked-col";
    const prev = c > 0 ? dates[c - 1] : null;
    const next = c < dates.length - 1 ? dates[c + 1] : null;
    if (!prev || getDateColor(prev) !== color) s += " marked-col-first";
    if (!next || getDateColor(next) !== color) s += " marked-col-last";
    return s;
  }
  function markedHex(dt) {
    const k = getDateColor(dt);
    const e = k ? paletteEntry(k) : null;
    return e ? e.hex : null;
  }

  // 가로/세로 보조선 — JS로 같은 행/열에 hover-axis 클래스 부여
  const tableRef = useRef(null);
  const axisHoverRef = useRef({ elements: [], lastR: null, lastC: null });
  function clearAxisHover() {
    for (const el of axisHoverRef.current.elements) el.classList.remove("hover-row", "hover-col");
    axisHoverRef.current = { elements: [], lastR: null, lastC: null };
  }
  function onTableHover(e) {
    const td = e.target.closest("td.heat");
    if (!td || !tableRef.current) return;
    const r = td.dataset.r;
    const c = td.dataset.c;
    if (r === undefined || c === undefined) return;
    const state = axisHoverRef.current;
    if (state.lastR === r && state.lastC === c) return;
    for (const el of state.elements) el.classList.remove("hover-row", "hover-col");
    const els = [];
    tableRef.current.querySelectorAll(`td.heat[data-r="${r}"]`).forEach((el) => { el.classList.add("hover-row"); els.push(el); });
    tableRef.current.querySelectorAll(`td.heat[data-c="${c}"]`).forEach((el) => { el.classList.add("hover-col"); els.push(el); });
    const dh = tableRef.current.querySelector(`th.date-h[data-c="${c}"]`);
    if (dh) { dh.classList.add("hover-col"); els.push(dh); }
    let groupStart = +r;
    for (let i = +r; i >= 0; i--) if (rowInfo[i]) { groupStart = i; break; }
    const tl = tableRef.current.querySelector(`td.time-label[data-r="${groupStart}"]`);
    if (tl) { tl.classList.add("hover-row"); els.push(tl); }
    axisHoverRef.current = { elements: els, lastR: r, lastC: c };
  }

  function buildTooltipData(key) {
    const available = counts.get(key) || [];
    const availableSet = new Set(available);
    const unavailable = people.filter((p) => !availableSet.has(p.name)).map((p) => p.name);
    return { available, unavailable };
  }

  function fmtRange(s) {
    const end = s.minutes + 30;
    const eh = Math.floor(end / 60) % 24;
    const em = end % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${s.label} - ${pad(eh)}:${pad(em)}`;
  }
  function onCellEnter(e, dt, s, key) {
    if (eventMode || pinned) return; // 일정 모드 / 핀 상태에서는 호버 무시
    setHover({ key, dateLabel: `${dt.label}(${dt.dowLabel})`, timeLabel: fmtRange(s), x: e.clientX, y: e.clientY });
  }
  function onCellMove(e) {
    if (eventMode || pinned) return;
    setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
  }
  function onCellLeave() {
    if (eventMode || pinned) return;
    setHover(null);
  }
  function onCellClick(e, dt, s, key) {
    if (eventMode) { e.stopPropagation(); return; } // 일정 모드에서는 일반 클릭 비활성
    e.stopPropagation();
    const next = { key, dateLabel: `${dt.label}(${dt.dowLabel})`, timeLabel: fmtRange(s), x: e.clientX, y: e.clientY };
    setPinned((cur) => (cur && cur.key === key ? null : next));
    setHover(null);
  }

  // 일정 모드: 드래그 시작
  function onCellPointerDown(e, dt, s, key, cIdx, r) {
    if (!eventMode) return;
    if (e.button !== 0) return; // 좌클릭만
    e.preventDefault();
    setEventDrag({ cIdx, startR: r, endR: r });
    setHover(null);
    setHoverEvent(null);
  }

  // 셀이 현재 이벤트 드래그 영역에 포함되는지
  function isInDrag(cIdx, r) {
    if (!eventDrag || eventDrag.cIdx !== cIdx) return false;
    const lo = Math.min(eventDrag.startR, eventDrag.endR);
    const hi = Math.max(eventDrag.startR, eventDrag.endR);
    return r >= lo && r <= hi;
  }

  const td = active ? buildTooltipData(active.key) : null;

  return (
    <>
      <div className={"grid-wrap" + (eventMode ? " event-mode" : "")}>
        <table className={"grid" + (eventMode ? " event-mode" : "")} ref={tableRef} onMouseOver={onTableHover} onMouseLeave={clearAxisHover}>
          <thead>
            <tr>
              <th className="corner col-time">시간</th>
              {dates.map((dt, cIdx) => {
                const hex = markedHex(dt);
                return (
                  <th
                    key={dt.key}
                    className={"date-h" + (dt.dow === 6 ? " sat" : dt.dow === 0 ? " sun" : "") + colClass(cIdx, dt)}
                    data-c={cIdx}
                    style={hex ? { "--marked-color": hex } : undefined}
                  >
                    {dt.label}
                    <span className="dow">({dt.dowLabel})</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slots.map((s, r) => {
              const g = rowInfo[r];
              const dayStart = s.nextDay && (r === 0 || !slots[r - 1].nextDay);
              return (
                <tr key={s.minutes} className={(s.isHour && r > 0 ? "hourline" : "") + (dayStart ? " dayline" : "") + (!s.isHour ? " halfhour" : "")}>
                  {g && (
                    <td className={"time-label col-time" + (g.nextDay ? " next-day" : "")} rowSpan={g.span} data-r={g.startIndex}>
                      {g.hourLabel}
                    </td>
                  )}
                  {dates.map((dt, cIdx) => {
                    const k = slotKey(dt.key, s.key);
                    const names = counts.get(k) || [];
                    const c = names.length;
                    const isActive = active && active.key === k;
                    const isFull = total > 0 && c === total;
                    const colorKey = getDateColor(dt);
                    const hex = markedHex(dt);
                    const evList = eventCells.get(`${dt.key}:${r}`) || [];
                    const hasEvt = evList.length > 0;
                    const firstEvts = evList.filter((x) => x.isFirst);
                    const isEvtFirst = firstEvts.length > 0;
                    const isEvtLast = evList.some((x) => x.isLast);
                    // 드래그 중이거나, 드래그 끝나고 입력 팝업이 떠 있는 동안에도 선택 영역 강조
                    const inDrag = isInDrag(cIdx, r);
                    const inInput = !!(
                      eventInput &&
                      eventInput.date === dt.key &&
                      r >= eventInput.startR &&
                      r <= eventInput.endR
                    );
                    const drag = inDrag || inInput;
                    let dragLo = null, dragHi = null;
                    if (inDrag) {
                      dragLo = Math.min(eventDrag.startR, eventDrag.endR);
                      dragHi = Math.max(eventDrag.startR, eventDrag.endR);
                    } else if (inInput) {
                      dragLo = eventInput.startR;
                      dragHi = eventInput.endR;
                    }
                    return (
                      <td
                        key={dt.key}
                        className={
                          "heat" +
                          (isActive ? " active" : "") +
                          (pinned && pinned.key === k ? " pinned" : "") +
                          (isFull ? " full" : "") +
                          colClass(cIdx, dt) +
                          (hasEvt ? " evt-cell" : "") +
                          (isEvtFirst ? " evt-first" : "") +
                          (isEvtLast ? " evt-last" : "") +
                          (drag ? " evt-drag" : "") +
                          (drag && r === dragLo ? " evt-drag-first" : "") +
                          (drag && r === dragHi ? " evt-drag-last" : "")
                        }
                        data-c={cIdx}
                        data-r={r}
                        style={hex
                          ? { background: bg(c, colorKey), color: fg(c), "--marked-color": hex }
                          : { background: bg(c, colorKey), color: fg(c) }}
                        onMouseEnter={(e) => onCellEnter(e, dt, s, k)}
                        onMouseMove={onCellMove}
                        onMouseLeave={onCellLeave}
                        onClick={(e) => onCellClick(e, dt, s, k)}
                        onPointerDown={(e) => onCellPointerDown(e, dt, s, k, cIdx, r)}
                      >
                        {c > 0 ? c : ""}
                        {isEvtFirst && firstEvts.map(({ event }) => (
                          <span
                            key={event.id}
                            className="evt-badge"
                            onMouseEnter={(e) => {
                              if (eventMode) return; // 일정 모드에선 드래그 우선
                              setHoverEvent({ event, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => {
                              setHoverEvent((h) => (h && h.event.id === event.id ? { ...h, x: e.clientX, y: e.clientY } : h));
                            }}
                            onMouseLeave={() => setHoverEvent(null)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            title={event.title}
                            aria-label={event.title}
                          >
                            📌
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {active && td && !eventMode && (
        <CellTooltip
          x={active.x}
          y={active.y}
          dateLabel={active.dateLabel}
          timeLabel={active.timeLabel}
          available={td.available}
          unavailable={td.unavailable}
          pinned={!!pinned}
        />
      )}

      {eventInput && (
        <EventInputPopup
          info={eventInput}
          slots={slots}
          onCancel={() => setEventInput(null)}
          onSubmit={async (data) => {
            const startTime = slots[eventInput.startR].label;
            const endTime = slotEndTime(slots[eventInput.endR]);
            if (onCreateEvent) {
              await onCreateEvent({
                title: data.title,
                date: eventInput.date,
                startTime,
                endTime,
                description: data.description,
              });
            }
            setEventInput(null);
          }}
        />
      )}

      {hoverEvent && (
        <EventTooltip
          event={hoverEvent.event}
          x={hoverEvent.x}
          y={hoverEvent.y}
          canDelete={!!onDeleteEvent && eventMode}
          onDelete={() => {
            if (onDeleteEvent) onDeleteEvent(hoverEvent.event.id);
            setHoverEvent(null);
          }}
          onMouseEnter={() => { /* 유지 */ }}
          onMouseLeave={() => setHoverEvent(null)}
        />
      )}

      <div className="duration-list">
        <h4>인원별 가능 시간 (체크한 30분 칸 합)</h4>
        <div className="duration-items">
          {[...people].sort((a, b) => b.slots.length - a.slots.length).map((p) => (
            <div key={p.id} className="duration-item">
              <span className="name">{p.name}</span>
              <span className="time">{formatDuration(p.slots.length * 30)}</span>
            </div>
          ))}
        </div>
      </div>

      <RankingList
        people={people}
        dates={dates}
        slots={slots}
        counts={counts}
        locationName={locationName}
        maxItems={15}
      />

      <div className="legend">
        <span>가능 인원:</span>
        <span className="sw" style={{ background: bg(0) }} /> 0명
        <span className="sw" style={{ background: bg(Math.ceil(total / 2)) }} /> {Math.ceil(total / 2)}명
        <span className="sw" style={{ background: bg(total) }} /> {total}명(전원)
        <span style={{ marginLeft: 8 }}>· 칸에 마우스를 올리거나 클릭하면 가능·불가능 인원이 보입니다.</span>
      </div>
    </>
  );
}

// 가능 시간 순위 — 같은 사람들이 연속해서 가능한 구간을 묶어 순위로 보여줌
function RankingList({ people, dates, slots, counts, locationName, maxItems = 15 }) {
  const ranges = useMemo(() => {
    const out = [];
    for (const dt of dates) {
      let curStart = null, curNames = null, curKey = null;
      for (let i = 0; i < slots.length; i++) {
        const k = slotKey(dt.key, slots[i].key);
        const names = counts.get(k) || [];
        const namesKey = [...names].sort().join("|");
        if (names.length === 0) {
          if (curStart !== null) {
            out.push({ date: dt, startIdx: curStart, endIdx: i - 1, names: curNames });
            curStart = null; curNames = null; curKey = null;
          }
          continue;
        }
        if (curStart === null) {
          curStart = i; curNames = [...names]; curKey = namesKey;
        } else if (namesKey !== curKey) {
          out.push({ date: dt, startIdx: curStart, endIdx: i - 1, names: curNames });
          curStart = i; curNames = [...names]; curKey = namesKey;
        }
      }
      if (curStart !== null) {
        out.push({ date: dt, startIdx: curStart, endIdx: slots.length - 1, names: curNames });
      }
    }
    out.sort((a, b) => {
      if (b.names.length !== a.names.length) return b.names.length - a.names.length;
      const da = slots[a.endIdx].minutes + 30 - slots[a.startIdx].minutes;
      const db = slots[b.endIdx].minutes + 30 - slots[b.startIdx].minutes;
      return db - da;
    });
    return out;
  }, [dates, slots, counts]);

  const allNames = useMemo(() => [...new Set(people.map((p) => p.name))], [people]);

  if (ranges.length === 0) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const fmtEnd = (s) => {
    const e = s.minutes + 30;
    return `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`;
  };
  const fmtDur = (r) => formatDuration(slots[r.endIdx].minutes + 30 - slots[r.startIdx].minutes);

  return (
    <div className="ranking-list">
      <h4>
        가능 시간 순위 (같은 사람이 연속해서 가능한 구간)
        {locationName && <span className="rank-loc-head">📍 {locationName}</span>}
      </h4>
      <ol>
        {ranges.slice(0, maxItems).map((r, i) => {
          const available = r.names;
          const unavailable = allNames.filter((n) => !available.includes(n));
          return (
            <li key={i}>
              <div className="rank-head">
                <span className="rank-count">{available.length}명</span>
                <span className="rank-when">
                  {r.date.label}({r.date.dowLabel}) {slots[r.startIdx].label}–{fmtEnd(slots[r.endIdx])}
                </span>
                <span className="rank-dur">{fmtDur(r)}</span>
                {locationName && <span className="rank-loc">📍 {locationName}</span>}
              </div>
              <div className="rank-row rank-yes">
                <span className="rank-tag yes">✓ 가능 {available.length}</span>
                <span className="rank-names">{available.join(", ")}</span>
              </div>
              {unavailable.length > 0 && (
                <div className="rank-row rank-no">
                  <span className="rank-tag no">✗ 불가능 {unavailable.length}</span>
                  <span className="rank-names">{unavailable.join(", ")}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// 일정 입력 팝업 — 드래그가 끝난 위치 근처에 떠서 제목/메모를 받음
function EventInputPopup({ info, slots, onCancel, onSubmit }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, []);
  // ESC로 취소
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const pad = 14;
  const w = 240;
  const h = 200;
  const left = Math.min(info.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - w - pad);
  const top = Math.min(info.y + 14, (typeof window !== "undefined" ? window.innerHeight : 768) - h - pad);
  const startLabel = slots[info.startR].label;
  const endLabel = slotEndTime(slots[info.endR]);
  const dateLabel = `${info.dt.label}(${info.dt.dowLabel})`;

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) {
      inputRef.current && inputRef.current.focus();
      return;
    }
    setSubmitting(true);
    await onSubmit({ title: title.trim(), description: description.trim() });
  }

  return (
    <div
      className="evt-input-popup"
      style={{ left, top, width: w }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <form onSubmit={submit}>
        <div className="evt-input-head">
          📅 {dateLabel} · {startLabel}–{endLabel}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="evt-input-title"
          placeholder="일정 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
        />
        <textarea
          className="evt-input-desc"
          placeholder="설명 (선택)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={300}
        />
        <div className="evt-input-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>취소</button>
          <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
            {submitting ? "추가 중…" : "추가"}
          </button>
        </div>
      </form>
    </div>
  );
}

// 일정 배지에 마우스를 올렸을 때 보이는 툴팁 (+ 삭제 버튼)
function EventTooltip({ event, x, y, canDelete, onDelete, onMouseEnter, onMouseLeave }) {
  const pad = 14;
  const w = 240;
  const left = Math.min(x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - w - pad);
  const top = Math.min(y + 14, (typeof window !== "undefined" ? window.innerHeight : 768) - 160);
  return (
    <div
      className="evt-tooltip"
      style={{ left, top, width: w }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="evt-tt-head">📅 {event.title}</div>
      <div className="evt-tt-when">
        {event.date} · {event.startTime}–{event.endTime}
      </div>
      {event.description && <div className="evt-tt-desc">{event.description}</div>}
      {canDelete && (
        <div className="evt-tt-actions">
          <button
            type="button"
            className="btn-danger-sm"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            🗑 삭제
          </button>
        </div>
      )}
    </div>
  );
}

// 마우스 위치 근처에 떠다니는 가능/불가능 인원 툴팁
function CellTooltip({ x, y, dateLabel, timeLabel, available, unavailable, pinned }) {
  // 화면 오른쪽/아래로 튀어나가지 않게 보정
  const pad = 14;
  const w = 220;
  const left = Math.min(x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - w - pad);
  const top = Math.min(y + 14, (typeof window !== "undefined" ? window.innerHeight : 768) - 160);
  return (
    <div className={"cell-tooltip" + (pinned ? " pinned" : "")} style={{ left, top, width: w }}>
      <div className="tt-head">
        {dateLabel} · {timeLabel}
        {pinned && <span className="tt-pin">📌 고정됨 · 다시 클릭하면 해제</span>}
      </div>
      <div className="tt-row tt-yes">
        <span className="tt-label">✓ 가능</span> <span className="tt-count">{available.length}</span>
        <div className="tt-names">{available.length ? available.join(", ") : "—"}</div>
      </div>
      <div className="tt-row tt-no">
        <span className="tt-label">✗ 불가능</span> <span className="tt-count">{unavailable.length}</span>
        <div className="tt-names">{unavailable.length ? unavailable.join(", ") : "—"}</div>
      </div>
    </div>
  );
}
