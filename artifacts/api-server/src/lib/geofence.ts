// Cálculo de distancia + validación de geocerca para check-in / check-out.
// La obra define su centro (latitude/longitude) y un radio en metros. El
// frontend manda las coordenadas del teléfono y aquí decidimos si entra.
//
// Usamos Haversine porque el radio típico (50-300 m) está muy por debajo
// del límite donde la diferencia con Vincenty empieza a importar (cientos
// de km), y Haversine es mucho más barato. La precisión del GPS del
// teléfono (5-50 m en obra abierta) domina el error de todas formas.

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distancia en metros entre dos puntos. Devuelve NaN si algún input es
 * inválido (NaN o fuera de rango) — el caller decide qué hacer con eso
 * en vez de propagar un cero engañoso.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lon2)
  ) return NaN;

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export type GeofenceCheckInput = {
  projectLatitude: number | null;
  projectLongitude: number | null;
  geofenceRadiusMeters: number;
  geofenceMode: "strict" | "tolerant" | "off";
  userLatitude: number;
  userLongitude: number;
  // Precisión del GPS reportada por el browser (radio en metros donde el
  // teléfono cree que está). La sumamos al radio efectivo para no rebotar
  // a un worker que está pegado a la cerca con GPS débil.
  userAccuracy?: number | null;
};

export type GeofenceCheckResult =
  | {
      // ok: el worker está dentro del radio (o el modo es 'off', o la obra
      // no tiene coordenadas configuradas). Distance puede ser null si no
      // se pudo calcular.
      decision: "ok";
      distanceMeters: number | null;
      reason?: string;
    }
  | {
      // flagged: fuera del radio pero el modo es 'tolerant' — se permite
      // el check-in pero queda marcado en la BD.
      decision: "flagged";
      distanceMeters: number;
      reason: string;
    }
  | {
      // rejected: fuera del radio y modo 'strict' — el endpoint debe
      // responder 422 y no crear el check-in.
      decision: "rejected";
      distanceMeters: number;
      reason: string;
    };

/**
 * Decide si el GPS reportado por el worker pasa la geocerca de la obra.
 * Si la obra no tiene coordenadas o está en modo 'off', siempre 'ok'
 * (con distance=null). El error de precisión del GPS (`userAccuracy`)
 * se suma al radio efectivo para evitar falsos rechazos.
 */
export function checkGeofence(input: GeofenceCheckInput): GeofenceCheckResult {
  const {
    projectLatitude, projectLongitude,
    geofenceRadiusMeters, geofenceMode,
    userLatitude, userLongitude, userAccuracy,
  } = input;

  if (geofenceMode === "off") {
    return { decision: "ok", distanceMeters: null, reason: "geofence_off" };
  }
  if (projectLatitude == null || projectLongitude == null) {
    // La obra no tiene punto configurado — no podemos validar, así que
    // dejamos pasar. El admin debería configurar coordenadas si quiere
    // que la geocerca funcione.
    return { decision: "ok", distanceMeters: null, reason: "project_no_coordinates" };
  }

  const distance = haversineDistance(
    projectLatitude, projectLongitude,
    userLatitude, userLongitude,
  );
  if (!Number.isFinite(distance)) {
    // GPS inválido — en strict bloqueamos, en tolerant marcamos.
    if (geofenceMode === "strict") {
      return { decision: "rejected", distanceMeters: 0, reason: "invalid_coordinates" };
    }
    return { decision: "flagged", distanceMeters: 0, reason: "invalid_coordinates" };
  }

  // Sumamos la precisión del GPS al radio efectivo. Cap a 100 m extra
  // para que un GPS basura (accuracy = 1 km) no nos haga ciegos. Si la
  // app reporta accuracy > 100 nos quedamos con 100 m de margen, que
  // ya es generoso.
  const accuracyBuffer = Math.min(100, Math.max(0, Number(userAccuracy ?? 0)));
  const effectiveRadius = geofenceRadiusMeters + accuracyBuffer;

  if (distance <= effectiveRadius) {
    return { decision: "ok", distanceMeters: distance };
  }
  const reason = `out_of_range:${Math.round(distance)}m_vs_${geofenceRadiusMeters}m`;
  if (geofenceMode === "strict") {
    return { decision: "rejected", distanceMeters: distance, reason };
  }
  return { decision: "flagged", distanceMeters: distance, reason };
}
