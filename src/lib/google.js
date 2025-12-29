let loadingPromise = null;

export function loadGoogleMaps(){
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) return Promise.reject(new Error("Missing VITE_GOOGLE_MAPS_BROWSER_KEY"));
  if (window.google && window.google.maps && window.google.maps.places) return Promise.resolve();

  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject)=>{
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
    script.onload = ()=> resolve();
    script.onerror = ()=> reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  });

  return loadingPromise;
}
