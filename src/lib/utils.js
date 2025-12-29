export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function parseHHMM(hhmm){
  const [h,m] = String(hhmm || "20:00").split(":").map(Number);
  const hh = Number.isFinite(h) ? clamp(h,0,23) : 20;
  const mm = Number.isFinite(m) ? clamp(m,0,59) : 0;
  return hh*60 + mm;
}
export function fmtTime(mins){
  const total = Math.round(mins);
  const h = Math.floor(total/60);
  const m = total%60;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}
export function fmtDuration(mins){
  const total = Math.round(mins);
  const h = Math.floor(total/60);
  const m = total%60;
  if(h<=0) return `${m}m`;
  if(m===0) return `${h}h`;
  return `${h}h ${m}m`;
}
export function inr(n){
  const x = Math.round(Number(n)||0);
  return "₹"+x.toLocaleString("en-IN");
}
export function deg2rad(d){ return d * Math.PI / 180; }
export function distanceKmBetween(a,b){
  if(!a||!b) return 0;
  const R=6371;
  const dLat=deg2rad(b.lat-a.lat);
  const dLng=deg2rad(b.lng-a.lng);
  const lat1=deg2rad(a.lat), lat2=deg2rad(b.lat);
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const h=s1*s1 + Math.cos(lat1)*Math.cos(lat2)*s2*s2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

export function haptic(ms=10){
  try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){}
}

export function debounce(fn, wait){
  let t;
  return (...args)=>{
    clearTimeout(t);
    t=setTimeout(()=>fn(...args), wait);
  };
}
