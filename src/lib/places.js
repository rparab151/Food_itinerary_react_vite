export function cuisineFromGoogleTypes(types=[]){
  const t = types.map(x=>String(x).toLowerCase());
  const has = (k)=>t.some(x=>x.includes(k));
  if (has("bar") || has("night_club")) return "Bar / Pub";
  if (has("cafe")) return "Cafe";
  if (has("bakery") || has("dessert")) return "Bakery / Desserts";
  if (has("pizza")) return "Pizza";
  if (has("chinese")) return "Chinese";
  if (has("seafood")) return "Seafood";
  if (has("fast_food")) return "Fast food";
  if (has("meal_takeaway") || has("street")) return "Street food";
  if (has("indian") || has("south_indian") || has("north_indian")) return "Indian";
  return "Restaurant";
}

export function priceLevelToTag(level){
  if(level === 0 || level === 1) return "₹";
  if(level === 2) return "₹₹";
  if(level >= 3) return "₹₹₹";
  return "₹₹";
}
export function priceLevelToBudget(level){
  if(level === 0 || level === 1) return "cheap";
  return "comfortable";
}

export function placeFromBackendResult(r){
  const level = typeof r.priceLevel === "number" ? r.priceLevel : 2;
  return {
    id: r.placeId || r.id || r.name,
    placeId: r.placeId || r.id,
    name: r.name || "Nearby restaurant",
    area: r.area || "Nearby",
    city: r.city || "Nearby",
    coords: r.coords || null,
    rating: r.rating,
    userRatingsTotal: r.userRatingsTotal,
    priceLevel: r.priceLevel,
    priceTag: priceLevelToTag(level),
    foodBudget: priceLevelToBudget(level),
    cuisine: cuisineFromGoogleTypes(r.types || []),
    types: r.types || [],
    openNow: r.openingHours?.openNow,
    avgMealMins: 75,
    bestFor: ["breakfast","lunch","snack","dinner"],
    tip: ""
  };
}

export function googleMapsSearchUrl(place){
  if (!place) return "#";
  if (place.placeId) return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.placeId)}&query=${encodeURIComponent(place.name||"restaurant")}`;
  const q = `${place.name||""} ${place.area||""} ${place.city||""}`.trim() || "restaurant";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function directionsUrl(home, place){
  if (!place?.coords) return "#";
  const dest = `${place.coords.lat},${place.coords.lng}`;
  if (home?.lat && home?.lng){
    const origin = `${home.lat},${home.lng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
