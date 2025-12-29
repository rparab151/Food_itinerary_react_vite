import React, { useMemo, useState } from "react";
import { CUISINE_GROUPS } from "../lib/cuisines.js";

export default function CuisineDropdown({ selected, onChange }) {
  const [q, setQ] = useState("");
  const qLower = q.trim().toLowerCase();

  const shownItems = useMemo(()=>{
    const matches = (s)=> !qLower || String(s).toLowerCase().includes(qLower);
    return CUISINE_GROUPS.flatMap(g=>g.items).filter(matches);
  }, [qLower]);

  const count = selected.length;

  const toggle = (item)=>{
    const set = new Set(selected);
    if (set.has(item)) set.delete(item); else set.add(item);
    onChange(Array.from(set));
  };

  const removeChip = (item)=> onChange(selected.filter(x=>x!==item));

  return (
    <details open>
      <summary>
        <span>Cuisines</span>
        <span className="badge">{count ? `${count} selected` : "All"}</span>
      </summary>

      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        <div className="cuiTop">
          <input
            className="cuiSearch"
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            placeholder="Search cuisines… (e.g., South Indian, Malvani)"
          />
          <div className="cuiBtns">
            <button className="btn small ghost" type="button" onClick={()=>{ setQ(""); onChange([]); }}>
              Clear
            </button>
            <button className="btn small ghost" type="button" onClick={()=> onChange(Array.from(new Set([...selected, ...shownItems])))}>
              Select all shown
            </button>
          </div>
        </div>

        <div className="cuiChips">
          {count === 0 ? (
            <span className="small">No cuisine filter applied.</span>
          ) : (
            selected.map((c)=>(
              <span key={c} className="cuiChip" onClick={()=>removeChip(c)} title="Remove">
                {c} <span className="x">×</span>
              </span>
            ))
          )}
        </div>

        <div className="cGroups">
          {CUISINE_GROUPS.map((g)=> {
            const items = g.items.filter(it=> !qLower || it.toLowerCase().includes(qLower));
            if (!items.length) return null;
            const selectedInGroup = g.items.filter(it=>selected.includes(it)).length;

            return (
              <details key={g.group} className="cGroup" open={qLower ? true : (g.group === "Indian")}>
                <summary className="cSum">
                  <span>{g.group}</span>
                  <span className="badge">{selectedInGroup}/{g.items.length}</span>
                </summary>
                <div className="cBody">
                  {items.map((it)=>(
                    <label key={it} className="cItem">
                      <input type="checkbox" checked={selected.includes(it)} onChange={()=>toggle(it)} />
                      <span style={{ fontWeight: 850 }}>{it}</span>
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <div className="small" style={{ marginTop: 8 }}>
          Pick one or more cuisines, or leave empty to include all.
        </div>
      </div>
    </details>
  );
}
