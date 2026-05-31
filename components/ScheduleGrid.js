"use client";

import { useEffect, useMemo, useRef } from "react";
import { generateDates, generateSlots, slotKey, hourGroups } from "@/lib/schedule";
import { formatDuration } from "./OverviewGrid";

export default function ScheduleGrid({ config, person, editing = false, onCommitSlots, onMemoChange }) {
  const dates = useMemo(() => generateDates(config.startDate, config.endDate), [config.startDate, config.endDate]);
  const slots = useMemo(
    () => generateSlots(config.startTime, config.endTime, config.slotMinutes || 30),
    [config.startTime, config.endTime, config.slotMinutes]
  );

  // 시간 라벨 셀 병합 정보 (각 시간 그룹의 시작 행에만 라벨 td 렌더)
  const rowInfo = useMemo(() => {
    const info = new Array(slots.length).fill(null);
    for (const g of hourGroups(slots)) info[g.startIndex] = g;
    return info;
  }, [slots]);

  // 렌더용 선택 집합
  const selectedSet = useMemo(() => new Set(person.slots), [person.slots]);

  // 드래그 중 빠른 처리를 위한 ref들
  const selectedRef = useRef(new Set(person.slots));
  const cellElsRef = useRef(new Map()); // "r_c" -> <td>
  const dragRef = useRef(null);

  useEffect(() => {
    selectedRef.current = new Set(person.slots);
  }, [person.slots, person.id]);

  function elAt(r, c) {
    return cellElsRef.current.get(`${r}_${c}`);
  }

  function clearPreview() {
    const d = dragRef.current;
    if (!d) return;
    for (const el of d.previewed) {
      el.classList.remove("preview-add", "preview-del");
    }
    d.previewed = [];
  }

  function applyPreview() {
    const d = dragRef.current;
    if (!d) return;
    clearPreview();
    const r0 = Math.min(d.anchor.r, d.cur.r);
    const r1 = Math.max(d.anchor.r, d.cur.r);
    const c0 = Math.min(d.anchor.c, d.cur.c);
    const c1 = Math.max(d.anchor.c, d.cur.c);
    const cls = d.mode === "add" ? "preview-add" : "preview-del";
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const el = elAt(r, c);
        if (el) {
          el.classList.add(cls);
          d.previewed.push(el);
        }
      }
    }
  }

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el && el.dataset && el.dataset.r !== undefined && el.dataset.key) {
      return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
    }
    return null;
  }

  function onMove(e) {
    const d = dragRef.current;
    if (!d || !d.active) return;
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    const hit = cellFromPoint(p.clientX, p.clientY);
    if (hit && (hit.r !== d.cur.r || hit.c !== d.cur.c)) {
      d.cur = hit;
      applyPreview();
    }
  }

  function onUp() {
    const d = dragRef.current;
    if (!d || !d.active) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);

    const r0 = Math.min(d.anchor.r, d.cur.r);
    const r1 = Math.max(d.anchor.r, d.cur.r);
    const c0 = Math.min(d.anchor.c, d.cur.c);
    const c1 = Math.max(d.anchor.c, d.cur.c);
    const set = selectedRef.current;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = slotKey(dates[c].key, slots[r].key);
        if (d.mode === "add") set.add(key);
        else set.delete(key);
      }
    }
    clearPreview();
    dragRef.current = null;
    onCommitSlots([...set]);
  }

  function onDown(e) {
    if (!editing) return; // 보기 모드에서는 클릭/드래그로 편집 안 함
    const td = e.target.closest("td.slot");
    if (!td) return;
    e.preventDefault();
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    const key = slotKey(dates[c].key, slots[r].key);
    const mode = selectedRef.current.has(key) ? "del" : "add";
    dragRef.current = { active: true, mode, anchor: { r, c }, cur: { r, c }, previewed: [] };
    applyPreview();
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dates.length === 0 || slots.length === 0) {
    return (
      <div className="empty-hint">
        설정의 날짜/시간 범위가 올바르지 않습니다.
        <br />위 설정에서 종료일이 시작일 이후, 종료시간이 시작시간 이후인지 확인하세요.
      </div>
    );
  }

  // 강조 날짜 범위 — 6월 23~29일 통째로 옅은 붉은 테두리
  function isInMarkedRange(dt) {
    const md = String(dt.m).padStart(2, "0") + "-" + String(dt.d).padStart(2, "0");
    return md >= "06-23" && md <= "06-29";
  }
  const markedFirstC = dates.findIndex(isInMarkedRange);
  const markedLastC = (() => {
    for (let i = dates.length - 1; i >= 0; i--) if (isInMarkedRange(dates[i])) return i;
    return -1;
  })();
  function colClass(c, dt) {
    if (!isInMarkedRange(dt)) return "";
    let s = " marked-col";
    if (c === markedFirstC) s += " marked-col-first";
    if (c === markedLastC) s += " marked-col-last";
    return s;
  }

  // 가로/세로 보조선 — JS로 같은 행/열의 셀들과 시간 라벨/날짜 헤더에 hover-axis 클래스 부여
  const tableRef = useRef(null);
  const axisHoverRef = useRef({ elements: [], lastR: null, lastC: null });
  function clearAxisHover() {
    for (const el of axisHoverRef.current.elements) el.classList.remove("hover-row", "hover-col");
    axisHoverRef.current = { elements: [], lastR: null, lastC: null };
  }
  function onTableHover(e) {
    const td = e.target.closest("td.slot");
    if (!td || !tableRef.current) return;
    const r = td.dataset.r;
    const c = td.dataset.c;
    if (r === undefined || c === undefined) return;
    const state = axisHoverRef.current;
    if (state.lastR === r && state.lastC === c) return;
    // clear & re-apply
    for (const el of state.elements) el.classList.remove("hover-row", "hover-col");
    const els = [];
    tableRef.current.querySelectorAll(`td.slot[data-r="${r}"]`).forEach((el) => { el.classList.add("hover-row"); els.push(el); });
    tableRef.current.querySelectorAll(`td.slot[data-c="${c}"]`).forEach((el) => { el.classList.add("hover-col"); els.push(el); });
    const dh = tableRef.current.querySelector(`th.date-h[data-c="${c}"]`);
    if (dh) { dh.classList.add("hover-col"); els.push(dh); }
    // 시간 라벨 — 호버 행이 속한 시간 그룹의 시작 인덱스로 찾기
    let groupStart = +r;
    for (let i = +r; i >= 0; i--) if (rowInfo[i]) { groupStart = i; break; }
    const tl = tableRef.current.querySelector(`td.time-label[data-r="${groupStart}"]`);
    if (tl) { tl.classList.add("hover-row"); els.push(tl); }
    axisHoverRef.current = { elements: els, lastR: r, lastC: c };
  }

  return (
    <div className={"grid-wrap" + (!editing ? " read-only" : "")}>
      <table className="grid" ref={tableRef} onPointerDown={onDown} onMouseOver={onTableHover} onMouseLeave={clearAxisHover}>
        <thead>
          <tr>
            <th className="corner col-time">시간</th>
            {dates.map((dt, c) => (
              <th
                key={dt.key}
                className={"date-h" + (dt.dow === 6 ? " sat" : dt.dow === 0 ? " sun" : "") + colClass(c, dt)}
                data-c={c}
              >
                {dt.label}
                <span className="dow">({dt.dowLabel})</span>
              </th>
            ))}
          </tr>
          <tr className="memo-row">
            <td className="time-label col-time">메모</td>
            {dates.map((dt, c) => (
              <td key={dt.key} className={colClass(c, dt).trim()}>
                <textarea
                  className="memo-input"
                  rows={1}
                  placeholder={editing ? "메모" : ""}
                  defaultValue={person.memos?.[dt.key] || ""}
                  readOnly={!editing}
                  onBlur={(e) => editing && onMemoChange(dt.key, e.target.value.trim())}
                  key={`${person.id}:${dt.key}:${editing ? "e" : "v"}`}
                />
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s, r) => {
            const g = rowInfo[r]; // 시간 그룹 시작이면 병합 라벨 셀 렌더
            const dayStart = s.nextDay && (r === 0 || !slots[r - 1].nextDay);
            return (
            <tr key={s.minutes} className={(s.isHour && r > 0 ? "hourline" : "") + (dayStart ? " dayline" : "") + (!s.isHour ? " halfhour" : "")}>
              {g && (
                <td className={"time-label col-time" + (g.nextDay ? " next-day" : "")} rowSpan={g.span} data-r={g.startIndex}>
                  {g.hourLabel}
                </td>
              )}
              {dates.map((dt, c) => {
                const key = slotKey(dt.key, s.key);
                return (
                  <td
                    key={dt.key}
                    className={"slot" + (selectedSet.has(key) ? " selected" : "") + colClass(c, dt)}
                    data-key={key}
                    data-r={r}
                    data-c={c}
                    ref={(el) => {
                      const m = cellElsRef.current;
                      if (el) m.set(`${r}_${c}`, el);
                      else m.delete(`${r}_${c}`);
                    }}
                  />
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
      <div className="duration-summary">
        총 가능 시간: <strong>{formatDuration(person.slots.length * 30)}</strong>
        <span className="hint" style={{ marginLeft: 8 }}>· 체크한 30분 칸 {person.slots.length}개</span>
      </div>
    </div>
  );
}
