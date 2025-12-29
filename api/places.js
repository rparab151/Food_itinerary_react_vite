// Vercel serverless function to fetch nearby places from Google Places API.
// Requires env var GOOGLE_MAPS_API_KEY (server key). Do NOT use referer-restricted browser keys here.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  }

  try {
    const {
      lat,
      lng,
      radiusKm = "5",
      maxResults = "12",
      keyword = "",
      opennow = "",
    } = req.query || {};

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "lat and lng query params are required" });
    }

    const radius = Math.min(Math.max(parseFloat(radiusKm) || 5, 1), 20);
    const max = Math.min(parseInt(maxResults || "12", 10), 20);
    const radiusMeters = Math.round(radius * 1000);

    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${latitude},${longitude}`);
    url.searchParams.set("radius", String(radiusMeters));
    url.searchParams.set("type", "restaurant");
    if (keyword) url.searchParams.set("keyword", String(keyword).slice(0, 120));
    if (String(opennow).toLowerCase() === "true") url.searchParams.set("opennow", "true");
    url.searchParams.set("key", GOOGLE_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Places API error", details: text });
    }

    const data = await response.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(502).json({
        error: "Places API status error",
        status: data.status,
        details: data.error_message,
      });
    }

    const results = (data.results || []).slice(0, max).map((r) => ({
      id: r.place_id,
      placeId: r.place_id,
      name: r.name,
      area: r.vicinity || "",
      coords: r.geometry?.location ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      types: r.types || [],
      businessStatus: r.business_status,
      openingHours: r.opening_hours ? { openNow: r.opening_hours.open_now } : null,
    }));

    return res.status(200).json({ places: results });
  } catch (err) {
    console.error("[api/places] handler failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
