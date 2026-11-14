export function toolSummary(name, value, args){
  switch (name){
    case 'calculate_celestial_conditions':
      return `Sun ${value.sun.elevation_deg.toFixed(2)}°, Earth ${value.earth.elevation_deg.toFixed(2)}° at ${value.utc}`;
    case 'analyze_mission_window':
      return `Dual ${value.simultaneousVisibilityPct.toFixed(1)}%: Sun ${value.solarAvailabilityPct.toFixed(1)}%: Earth ${value.earthVisibilityPct.toFixed(1)}%`;
    case 'compare_locations':
      return `Ranked ${value.ranked.length} locations: top ${value.ranked[0]?.name}`;
    case 'find_optimal_windows':
      return `${value.top.length} windows found: best ${value.top[0]?.siteName} ${value.top[0]?.startDate}`;
    case 'simulate_engineering':
      return `Min SOC ${value.minimumSocPct.toFixed(1)}%: unmet ${value.unmetHours.toFixed(1)} h: generated ${(value.generatedWh / 1000).toFixed(1)} kWh`;
    case 'inspect_operations':
      return `${value.combinedOutlook}: Sun ${value.sun.marginDeg.toFixed(2)}°: Earth ${value.earth.marginDeg.toFixed(2)}°`;
    case 'find_next_horizon_event':
      return value.result || `Next ${value.eventType} crossing ${value.eventUTC}`;
    case 'estimate_surface_traverse':
      return `${value.distanceKm.toFixed(1)} km: ${value.totalHours.toFixed(1)} h traverse`;
    case 'estimate_earth_moon_transit':
      return `${value.totalTransitLabel}: depart ${value.departureUTC.slice(0, 16).replace('T', ' ')} UTC → land ${value.arrivalUTC.slice(0, 16).replace('T', ' ')} UTC`;
    case 'get_mission_context':
      return `${value.selectedSite.name} ${value.mission.startUTC}`;
    default:
      return 'Tool executed';
  }
}