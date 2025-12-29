import React, { useEffect, useMemo, useRef, useState } from "react";
import CuisineDropdown from "./components/CuisineDropdown.jsx";
import { clamp, distanceKmBetween, fmtDuration, fmtTime, inr, parseHHMM, debounce, haptic } from "./lib/utils.js";
import { loadGoogleMaps } from "./lib/google.js";
import { placeFromBackendResult, googleMapsSearchUrl, directionsUrl } from "./lib/places.js";

const BACKEND_BASE = "/api";

const outingTemplates = [
  { key:"breakfast", label:"Breakfast", defaultStart:"09:30" },
  { key:"lunch", label:"Lunch", defaultStart:"13:00" },
  { key:"snack", label:"Evening Snacks", defaultStart:"17:30" },
  { key:"dinner", label:"Dinner", defaultStart:"20:00" }
];

function travelMode(travelStyle){
  return travelStyle === "comfortable" ? "cab" : "local";
}

function getTravelStats(home, place, mode){
  if (home && place.coords){
    const dKm = distanceKmBetween(home, place.coords);
    const baseKm = Math.max(dKm, 0.5);
    let timeMins;
    let cost;
    if (mode === "cab"){
      const speedKmph = 15;
      timeMins = (baseKm / speedKmph) * 60;
      cost = 70 + 22 * baseKm;
    } else {
      const speedKmph = 10;
      timeMins = (baseKm / speedKmph) * 60 + 10;
      cost = 20 + 4 * baseKm;
    }
    return { time: Math.max(5, timeMins), cost: Math.max(0, cost) };
  }
  return { time: 60, cost: 0 };
}

function timeLimitMinutes(maxHours){
  const hrs = clamp(Number(maxHours ?? 0), 0, 10);
  return Math.round(hrs * 60);
}
function hasTimeLimit(maxHours){
  return timeLimitMinutes(maxHours) > 0;
}

function totalMinutesFor(state, place){
  const mode = travelMode(state.travelStyle);
  const oneWay = getTravelStats(state.homeLocation, place, mode).time ?? 60;
  return oneWay*2 + (place.avgMealMins ?? 75) + state.bufferMins;
}

function scorePlace(state, place){
  let s = 0;
  if (place.bestFor?.includes(state.outingKey)) s += 6;

  const total = totalMinutesFor(state, place);
  const limit = timeLimitMinutes(state.maxHours);
  if (limit > 0){
    if (total > limit) s -= 100; else s += 12;
  } else s += 6;

  const oneWay = getTravelStats(state.homeLocation, place, travelMode(state.travelStyle)).time ?? 60;
  s += Math.max(0, 18 - Math.round(oneWay/5));

  const types = (place.types || []).map(t=>String(t).toLowerCase());
  const isBar = types.some(t=>t.includes("bar")||t.includes("night_club"));
  const isCafe = types.some(t=>t.includes("cafe"));
  const isStreet = types.some(t=>t.includes("meal_takeaway")||t.includes("street"));
  const r = Number(place.rating||0);

  if (state.outingKey === "breakfast" && isBar) s -= 12;
  if (state.outingKey === "snack" && (isCafe || isStreet)) s += 6;
  if (state.outingKey === "dinner") s += Math.min(6, r);
  return s;
}

function buildItinerary(state, place){
  const mode = travelMode(state.travelStyle);
  const stats = getTravelStats(state.homeLocation, place, mode);
  const oneWay = stats.time ?? 60;
  const costOW = stats.cost ?? 0;
  const startMins = parseHHMM(state.startTime);

  const leave = startMins;
  const arrive = leave + oneWay;
  const mealStart = arrive;
  const mealEnd = mealStart + (place.avgMealMins ?? 75);
  const departBack = mealEnd + state.bufferMins;
  const home = departBack + oneWay;

  return {
    place,
    mode,
    oneWayMins: oneWay,
    totalOutMins: home - leave,
    travelCostTotal: costOW*2,
    timeline: [
      { t: fmtTime(leave), label: `Leave ${state.homeLabel || "home"}` },
      { t: fmtTime(arrive), label: `Arrive: ${place.area}` },
      { t: fmtTime(mealStart), label: `Eat: ${place.name}` },
      { t: fmtTime(mealEnd), label: "Finish meal" },
      { t: fmtTime(departBack), label: "Head back (buffer / settle)" },
      { t: fmtTime(home), label: `Back to ${state.homeLabel || "home"}` }
    ]
  };
}

function useLocalStorage(key, initial){
  const [v, setV] = useState(()=>{
    try{
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    }catch(_){}
    return initial;
  });
  useEffect(()=>{
    try{ localStorage.setItem(key, JSON.stringify(v)); }catch(_){}
  }, [key, v]);
  return [v, setV];
}

function cacheKeyFor(lat,lng,radiusKm, keyword, openNow){
  return `places:${lat.toFixed(4)}:${lng.toFixed(4)}:r${radiusKm}:k=${keyword||""}:o=${openNow?"1":"0"}`;
}

export default function App(){
  const [theme, setTheme] = useLocalStorage("fi:theme", "dark");

  const [state, setState] = useState(()=>({
    homeLabel: "Parsik Nagar, Kalwa",
    homeLocation: null,
    outingKey: "dinner",
    startTime: "20:00",
    bufferMins: 12,
    maxHours: 3,
    travelStyle: "comfortable",
    selectedCuisines: [],
    openNow: false,
    radiusKm: 5,
  }));

  const [hasSearched, setHasSearched] = useState(false);
  const [backendPlaces, setBackendPlaces] = useState([]);
  const [status, setStatus] = useState("");

  const [favorites, setFavorites] = useLocalStorage("fi:favorites", []);
  const [clientCache, setClientCache] = useLocalStorage("fi:cache", {});

  const homeInputRef = useRef(null);

  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(()=>{
    loadGoogleMaps()
      .then(()=>{
        if (!homeInputRef.current) return;
        const autocomplete = new window.google.maps.places.Autocomplete(homeInputRef.current, { types: ["geocode"] });
        autocomplete.addListener("place_changed", ()=>{
          const p = autocomplete.getPlace();
          const label = (p && p.formatted_address) || homeInputRef.current.value || "Home";
          const loc = p?.geometry?.location;
          setState(s=>({
            ...s,
            homeLabel: label,
            homeLocation: loc ? { lat: loc.lat(), lng: loc.lng() } : s.homeLocation
          }));
          setHasSearched(false);
        });
      })
      .catch((e)=>{
        console.error(e);
        setStatus("Google Maps couldn’t load. Check API key, billing, and allowed websites.");
      });
  }, []);

  const ranked = (budget)=> {
    const limit = timeLimitMinutes(state.maxHours);
    let pool = backendPlaces.filter(p=>p.foodBudget === budget);
    if (state.selectedCuisines.length){
      pool = pool.filter(p => state.selectedCuisines.includes(p.cuisine));
    }
    if (hasTimeLimit(state.maxHours)){
      pool = pool.filter(p => totalMinutesFor(state, p) <= limit);
    }
    return pool
      .map(p=>({ p, s: scorePlace(state,p) }))
      .sort((a,b)=>b.s-a.s)
      .map(x=>x.p);
  };

  const A = useMemo(()=>{
    const p = ranked("comfortable")[0];
    return p ? buildItinerary(state, p) : null;
  }, [state, backendPlaces]);

  const B = useMemo(()=>{
    const p = ranked("cheap")[0];
    return p ? buildItinerary(state, p) : null;
  }, [state, backendPlaces]);

  const fetchPlaces = async ()=>{
    if (!state.homeLocation){
      setStatus("Pick a home address or use current location.");
      setBackendPlaces([]);
      return;
    }

    const keyword = state.selectedCuisines.length ? state.selectedCuisines.join(" ") : "";
    const ck = cacheKeyFor(state.homeLocation.lat, state.homeLocation.lng, state.radiusKm, keyword, state.openNow);
    const cached = clientCache[ck];
    if (cached && (Date.now() - cached.ts) < 6*60*60*1000){
      setBackendPlaces(cached.places);
      setStatus("Loaded from cache.");
      return;
    }

    setStatus("Searching…");
    const params = new URLSearchParams({
      lat: String(state.homeLocation.lat),
      lng: String(state.homeLocation.lng),
      radiusKm: String(state.radiusKm),
      maxResults: "18",
      keyword,
      opennow: state.openNow ? "true" : "false",
    });

    const resp = await fetch(`${BACKEND_BASE}/places?${params.toString()}`);
    const data = await resp.json();
    if (!resp.ok){
      setStatus(data?.details || data?.error || "Search failed.");
      setBackendPlaces([]);
      return;
    }

    const places = Array.isArray(data.places) ? data.places.map(placeFromBackendResult) : [];
    setBackendPlaces(places);
    setClientCache(cc=>({ ...cc, [ck]: { ts: Date.now(), places } }));
    setStatus(places.length ? `Found ${places.length} places.` : "No places found.");
  };

  const debouncedSearch = useMemo(()=> debounce(()=>{ fetchPlaces(); }, 500), [state, clientCache]);

  const onSearch = ()=>{
    haptic(12);
    setHasSearched(true);
    debouncedSearch();
  };

  const useCurrentLocation = ()=>{
    if (!navigator.geolocation){
      setStatus("Geolocation not supported.");
      return;
    }
    setStatus("Detecting location…");
    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        const { latitude, longitude } = pos.coords;
        setState(s=>({ ...s, homeLocation:{ lat: latitude, lng: longitude }, homeLabel: "Current location" }));
        setHasSearched(false);
        setStatus("Using current location.");
      },
      ()=> setStatus("Could not get location (permission denied or unavailable).")
    );
  };

  const toggleFav = (place)=>{
    if (!place?.id) return;
    haptic(10);
    setFavorites(f=>{
      const set = new Set(f);
      if (set.has(place.id)) set.delete(place.id); else set.add(place.id);
      return Array.from(set);
    });
  };

  const shareItinerary = async (label, itin)=>{
    if(!itin) return;
    haptic(10);
    const text = `${label}: ${itin.place.name} (${itin.place.area}) • Total time: ${fmtDuration(itin.totalOutMins)} • Google: ${googleMapsSearchUrl(itin.place)}`;
    try{
      if (navigator.share){
        await navigator.share({ title: "Food Itinerary", text, url: googleMapsSearchUrl(itin.place) });
      } else {
        await navigator.clipboard.writeText(text);
        setStatus("Copied share text to clipboard.");
      }
    }catch(_){}
  };

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">
          <h1>Food Itinerary Builder</h1>
          <div className="subtitle">
            <span className="chip"><span className="dot"></span>Home: <b>{state.homeLabel || "Home"}</b></span>
            <span className="chip"><span className="dot"></span><b>{state.maxHours === 0 ? "No time limit" : `≤ ${state.maxHours} hours outside`}</b></span>
            <span className="chip"><span className="dot"></span>Cab/Local • Upscale/Cheap</span>
          </div>
        </div>
        <div className="row" style={{ justifyContent:"flex-end" }}>
          <button className="btn" onClick={()=>{ haptic(8); setTheme(theme === "dark" ? "light" : "dark"); }}>
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
          </button>
          <button className="btn primary" onClick={()=>{ haptic(10); setState(s=>({ ...s, outingKey:"dinner", startTime:"20:00", bufferMins:12, maxHours:3, travelStyle:"comfortable", selectedCuisines:[], openNow:false, radiusKm:5 })); setHasSearched(false); setStatus(""); }}>
            Reset
          </button>
        </div>
      </header>

      <div className="grid">
        <div className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Settings</div>
              <div className="cardSub">Set your home address, outing type, cuisines, and travel style.</div>
            </div>
          </div>

          <div className="controls">
            <details open>
              <summary><span>Location</span><span className="badge">Home</span></summary>
              <div style={{ padding:"10px 12px", borderTop:"1px solid var(--border)" }}>
                <label>Home address</label>
                <input ref={homeInputRef} placeholder="Start typing your address..." />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn small ghost" type="button" onClick={useCurrentLocation}>Use my current location</button>
                  <span className="small">{status}</span>
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <div style={{ flex:1, minWidth: 160 }}>
                    <label>Search radius (km)</label>
                    <input type="number" min="1" max="20" value={state.radiusKm}
                      onChange={(e)=>{ setState(s=>({ ...s, radiusKm: clamp(Number(e.target.value||5),1,20) })); setHasSearched(false); }}
                    />
                  </div>
                  <div style={{ flex:1, minWidth: 160 }}>
                    <label>Open now</label>
                    <select value={state.openNow ? "yes":"no"} onChange={(e)=>{ setState(s=>({ ...s, openNow: e.target.value === "yes" })); setHasSearched(false); }}>
                      <option value="no">Any</option>
                      <option value="yes">Open now</option>
                    </select>
                  </div>
                </div>
              </div>
            </details>

            <details open>
              <summary><span>Plan</span><span className="badge">Meal + cuisines</span></summary>
              <div style={{ padding:"10px 12px", borderTop:"1px solid var(--border)", display:"grid", gap:12 }}>
                <div>
                  <label>Outing type</label>
                  <select value={state.outingKey} onChange={(e)=>{
                    const key = e.target.value;
                    const t = outingTemplates.find(x=>x.key===key);
                    setState(s=>({ ...s, outingKey:key, startTime: t ? t.defaultStart : s.startTime }));
                    setHasSearched(false);
                  }}>
                    {outingTemplates.map(t=> <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>

                <CuisineDropdown
                  selected={state.selectedCuisines}
                  onChange={(arr)=>{ setState(s=>({ ...s, selectedCuisines: arr })); setHasSearched(false); }}
                />
              </div>
            </details>

            <details>
              <summary><span>Timing</span><span className="badge">{state.maxHours === 0 ? "No limit" : `≤ ${state.maxHours}h`}</span></summary>
              <div style={{ padding:"10px 12px", borderTop:"1px solid var(--border)", display:"grid", gap:12 }}>
                <div className="row" style={{ gap:12 }}>
                  <div style={{ flex:1, minWidth: 170 }}>
                    <label>Start time</label>
                    <input value={state.startTime} onChange={(e)=>{ setState(s=>({ ...s, startTime: e.target.value })); setHasSearched(false); }} />
                  </div>
                  <div style={{ width: 140 }}>
                    <label>Buffer</label>
                    <input type="number" min="0" max="30" value={state.bufferMins} onChange={(e)=>{ setState(s=>({ ...s, bufferMins: clamp(Number(e.target.value||0),0,30) })); setHasSearched(false); }} />
                  </div>
                </div>

                <div>
                  <label>Max outing length (hours)</label>
                  <input type="range" min="0" max="10" step="0.5" value={state.maxHours} onChange={(e)=>{ setState(s=>({ ...s, maxHours: Number(e.target.value||0) })); setHasSearched(false); }} />
                  <div className="small">{state.maxHours} hours (0 = no limit)</div>
                </div>
              </div>
            </details>

            <details>
              <summary><span>Travel & results</span><span className="badge">{state.travelStyle === "comfortable" ? "Cab" : "Local"}</span></summary>
              <div style={{ padding:"10px 12px", borderTop:"1px solid var(--border)", display:"grid", gap:12 }}>
                <div>
                  <label>Travel style</label>
                  <div className="segmented" role="group" aria-label="Travel style">
                    <button className={"seg "+(state.travelStyle==="comfortable"?"on":"")} type="button"
                      onClick={()=>{ haptic(8); setState(s=>({ ...s, travelStyle:"comfortable" })); setHasSearched(false); }}>
                      Cab
                    </button>
                    <button className={"seg "+(state.travelStyle==="cheap"?"on":"")} type="button"
                      onClick={()=>{ haptic(8); setState(s=>({ ...s, travelStyle:"cheap" })); setHasSearched(false); }}>
                      Local
                    </button>
                  </div>
                </div>
              </div>
            </details>

            <button className="btn primary" type="button" style={{ width:"100%", justifyContent:"center" }} onClick={onSearch}>
              Search
            </button>

            <div className="row">
              <span className="chip good"><span className="dot"></span> Max time out: <b>{state.maxHours === 0 ? "No limit" : `${state.maxHours}h`}</b></span>
              <span className="chip"><span className="dot"></span> Door-to-door estimate</span>
            </div>
          </div>
        </div>

        <div className="stack">
          <ItineraryCard label="A) Upscale" itin={hasSearched ? A : null} state={state} favorites={favorites} toggleFav={toggleFav} shareItinerary={shareItinerary} />
          <ItineraryCard label="B) Cheap" itin={hasSearched ? B : null} state={state} favorites={favorites} toggleFav={toggleFav} shareItinerary={shareItinerary} />

          <div className="card">
            <div className="cardHead">
              <div>
                <div className="cardTitle">Included places</div>
                <div className="cardSub">{backendPlaces.length ? "Used for recommendations (near your home/search settings)." : "No places loaded yet. Hit Search."}</div>
              </div>
            </div>

            <div style={{ display:"grid", gap:10, marginTop:12 }}>
              {backendPlaces.slice(0, 18).map(p=>(
                <div key={p.id} className="card" style={{ padding:12, borderRadius:18, boxShadow:"none" }}>
                  <div className="row" style={{ justifyContent:"space-between" }}>
                    <div>
                      <div style={{ fontWeight:950, letterSpacing:"-.25px" }}>{p.name}</div>
                      <div className="small">{p.area} • {p.cuisine}</div>
                    </div>
                    <div className="row" style={{ justifyContent:"flex-end" }}>
                      <span className="chip">{p.foodBudget === "comfortable" ? "Upscale" : "Cheap"}</span>
                      <span className="chip">{p.priceTag}</span>
                      <a className="btn small ghost" href={googleMapsSearchUrl(p)} target="_blank" rel="noreferrer">Google</a>
                    </div>
                  </div>
                </div>
              ))}
              {!backendPlaces.length && <div className="small">No places yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItineraryCard({ label, itin, state, favorites, toggleFav, shareItinerary }){
  if (!itin){
    return (
      <div className="card">
        <div className="cardHead">
          <div>
            <div className="cardTitle">{label}</div>
            <div className="cardSub">Set your preferences, then hit <b>Search</b>.</div>
          </div>
        </div>
      </div>
    );
  }

  const limit = timeLimitMinutes(state.maxHours);
  const within = !hasTimeLimit(state.maxHours) || itin.totalOutMins <= limit;
  const progressPct = hasTimeLimit(state.maxHours) ? Math.min(100, Math.round((itin.totalOutMins/limit)*100)) : 0;

  const fav = favorites.includes(itin.place.id);

  return (
    <div className="card">
      <div className="cardHead">
        <div>
          <div className="cardTitle">{label}</div>
          <div className="cardSub">{itin.place.name} • {itin.place.area}</div>
          <div className="row" style={{ marginTop:10 }}>
            <span className="chip">{label.startsWith("A") ? "Upscale" : "Cheap"}</span>
            <span className="chip">Travel: {itin.mode === "cab" ? "Cab" : "Local"}</span>
            <span className={"chip "+(within ? "good":"bad")}>{within ? "Within limit" : "Above limit"}</span>
            {typeof itin.place.rating === "number" && <span className="chip">⭐ {itin.place.rating.toFixed(1)}</span>}
            {itin.place.openNow === true && <span className="chip good">Open now</span>}
          </div>
        </div>

        <div className="row" style={{ justifyContent:"flex-end" }}>
          <button className="btn small ghost" onClick={()=>toggleFav(itin.place)}>{fav ? "★ Saved" : "☆ Save"}</button>
          <button className="btn small ghost" onClick={()=>shareItinerary(label, itin)}>Share</button>
          <a className="btn small ghost" href={googleMapsSearchUrl(itin.place)} target="_blank" rel="noreferrer">Google</a>
        </div>
      </div>

      <div className="split">
        <div className="kpi">
          <div className="k">Travel mode</div>
          <div className="v">{itin.mode === "cab" ? "Cab" : "Local"}</div>
          <div className="s">One-way: {fmtDuration(itin.oneWayMins)}</div>
        </div>
        <div className="kpi">
          <div className="k">Total time out</div>
          <div className="v">{fmtDuration(itin.totalOutMins)}</div>
          <div className="s">Buffer: {state.bufferMins}m</div>
        </div>
        <div className="kpi">
          <div className="k">Travel cost (est.)</div>
          <div className="v">{inr(itin.travelCostTotal)}</div>
          <div className="s">Round trip</div>
        </div>
      </div>

      <div className="progress" aria-label="Time budget">
        <div className="bar" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="small" style={{ marginTop:6 }}>
        {hasTimeLimit(state.maxHours) ? `${progressPct}% of your ${state.maxHours}h limit` : "No time limit set"}
      </div>

      <div className="sectionTitle">Timeline</div>
      <div className="timeline">
        {itin.timeline.map((x)=>(
          <div key={x.t+x.label} className="trow">
            <div className="tt">{x.t}</div>
            <div className="dot" />
            <div className="tl">{x.label}</div>
          </div>
        ))}
      </div>

      <div className="sectionTitle">Links</div>
      <div className="row" style={{ marginTop:8 }}>
        <a className="btn ghost" href={directionsUrl(state.homeLocation, itin.place)} target="_blank" rel="noreferrer">Directions</a>
        <a className="btn ghost" href={googleMapsSearchUrl(itin.place)} target="_blank" rel="noreferrer">Ratings & reviews</a>
      </div>
    </div>
  );
}
