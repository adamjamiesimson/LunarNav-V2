// Transfer durations come from reference profiles. Destination coordinates identify the landing site.

export const TRANSIT_PROFILES = Object.freeze({
  direct: {
    id: 'direct',
    label: 'Direct transfer',
    referenceHours: 84,
    rangeHours: [72, 96],
    description: 'Short, higher-energy direct Earth–Moon transfer. Nominal planning estimate ~3–4 days.',
    assumptions: 'Reference duration only. A real direct transfer trajectory requires a patched-conic or full ephemeris propagator with launch windows, dV budget and insertion geometry.'
  },
  extended: {
    id: 'extended',
    label: 'Extended / fuel-efficient transfer',
    referenceHours: 180,
    rangeHours: [96, 240],
    description: 'Longer, lower-energy transfer (for example lunar transfer via weak stability boundaries or a higher phasing orbit). Fuel-efficient but slower.',
    assumptions: 'Longer reference duration deliberately chosen to represent fuel-optimal families. No trajectory solver is run; treat as a scheduling band.'
  },
  custom: {
    id: 'custom',
    label: 'Custom transit duration',
    referenceHours: null,
    rangeHours: [48, 720],
    description: 'Operator-specified total transit duration. Use when a reference design supplies a fixed transfer time.'
  }
});

export function formatHours(hours){
  if (!Number.isFinite(hours) || hours < 0) return 'N/A';
  const h = Math.round(hours);
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (d > 0 && rem > 0) return `${d} d ${rem} h`;
  if (d > 0) return `${d} days`;
  return `${rem} h`;
}

export function transitPhases(totalHours){
  const total = Number(totalHours);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Invalid transit duration');
  const approachHours = total * 0.16;   // terminal approach to lunar arrival / LOI window
  const detach = Math.min(2, total * 0.02);
  const insertionHours = Math.max(0.5, total * 0.03);
  const descentHours = Math.max(0.6, Math.min(1.9, total * 0.024));
  const touchdownHours = 0.25;
  const remaining = total - (approachHours + detach + insertionHours + descentHours + touchdownHours);
  return [
    {phase: 'Earth departure & escape burn', startHours: 0, endHours: remaining, kind: 'transfer'},
    {phase: 'Lunar transfer (cruise)', startHours: remaining, endHours: remaining + approachHours, kind: 'transfer'},
    {phase: 'Lunar arrival / LOI burn', startHours: remaining + approachHours, endHours: remaining + approachHours + detach + insertionHours, kind: 'insertion'},
    {phase: 'Descent to the surface', startHours: total - descentHours - touchdownHours, endHours: total - touchdownHours, kind: 'descent'},
    {phase: 'Surface touchdown at site', startHours: total - touchdownHours, endHours: total, kind: 'touchdown'}
  ];
}

export function estimateEarthMoonTransit({
  destination = null,
  profile = 'direct',
  referenceHours = null,
  departUTC = null,
  landingUTC = null,
  scheduleMode = 'depart'
} = {}){
  const dest = destination
    ? {id: String(destination.id ?? 'custom'), name: String(destination.name ?? 'Selected site'),
       lat: Number(destination.lat), lon: Number(destination.lon)}
    : null;
  if (dest && (!Number.isFinite(dest.lat) || Math.abs(dest.lat) > 90 || !Number.isFinite(dest.lon))) {
    throw new Error('Invalid lunar destination coordinates for transit estimate');
  }
  const spec = TRANSIT_PROFILES[profile] || TRANSIT_PROFILES.direct;
  const totalHours = profile === 'custom'
    ? (Number.isFinite(Number(referenceHours)) ? Number(referenceHours) : 84)
    : spec.referenceHours;
  if (!Number.isFinite(totalHours) || totalHours <= 0) throw new Error('Invalid transit duration');

  const mode = scheduleMode === 'land' ? 'land' : 'depart';
  const depart = new Date(departUTC ? String(departUTC) : '');
  const land = new Date(landingUTC ? String(landingUTC) : '');
  if (Number.isNaN(depart.getTime()) && Number.isNaN(land.getTime())){
    throw new Error('Provide either a departure or a landing UTC timestamp');
  }

  let departureUTC, arrivalUTC;
  if (mode === 'land'){
    if (Number.isNaN(land.getTime())) throw new Error('Invalid landing UTC timestamp');
    arrivalUTC = land.toISOString();
    departureUTC = new Date(land.getTime() - totalHours * 3600000).toISOString();
  } else {
    if (Number.isNaN(depart.getTime())) throw new Error('Invalid departure UTC timestamp');
    departureUTC = depart.toISOString();
    arrivalUTC = new Date(depart.getTime() + totalHours * 3600000).toISOString();
  }

  const departMs = new Date(departureUTC).getTime();
  const phaseEvents = transitPhases(totalHours).map(p => ({
    phase: p.phase,
    kind: p.kind,
    startUTC: new Date(departMs + p.startHours * 3600000).toISOString(),
    endUTC: new Date(departMs + p.endHours * 3600000).toISOString(),
    durationHours: +(p.endHours - p.startHours).toFixed(3)
  }));

  return {
    model: 'earth-moon-transit-reference-durations-v1',
    profile: spec.id,
    profileLabel: spec.label,
    totalTransitHours: +totalHours.toFixed(3),
    totalTransitLabel: formatHours(totalHours),
    departureUTC,
    arrivalUTC,
    destination: dest,
    scheduleMode: mode,
    phases: phaseEvents,
    assumptions: spec.assumptions,
    limitation: 'Profile-based planning estimate using reference transfer durations, NOT a trajectory solver. No dV budget, launch-window analysis or patched-conic propagation is performed. Lunar arrival, LOI, descent and surface touchdown are distinct events approximated here only. The destination coordinates identify the landing site and frame approach planning; they do not alter the Earth–Moon transit time.'
  };
}