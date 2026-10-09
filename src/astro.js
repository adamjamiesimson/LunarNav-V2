/**
 * LunarNav analytical screening ephemeris.
 * Geocentric Sun/Moon positions: truncated Meeus/NOAA series.
 * IAU Moon orientation: 2015 WGCCRE periodic rotation model.
 * Intentionally NOT SPICE / Horizons / terrain-aware / flight-qualified.
 * Longitude input east-positive; all timestamps UTC.
 */
const R = Math.PI / 180;
const s = d => Math.sin(d*R);
const c = d => Math.cos(d*R);
const wrap = a => ((a % 360) + 360) % 360;
const norm = v => { const q=Math.hypot(...v); return v.map(x=>x/q); };
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const jd = date => date.getTime()/86400000 + 2440587.5;
const radToDeg = a => a/R;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/** Sun direction from the Earth's center, equatorial J2000-like of-date approximation. */
function sunFromEarth(T) {
  const meanLon=wrap(280.46646+36000.76983*T+0.0003032*T*T);
  const M=wrap(357.52911+35999.05029*T-0.0001537*T*T);
  const C=(1.914602-0.004817*T-0.000014*T*T)*s(M)+(0.019993-0.000101*T)*s(2*M)+0.000289*s(3*M);
  const omega=125.04-1934.136*T;
  const lon=meanLon+C-0.00569-0.00478*s(omega);
  const eps=23.439291-0.0130042*T+0.00256*c(omega);
  const rAU=1.00014-0.01671*c(M)-0.00014*c(2*M);
  return [rAU*c(lon),rAU*s(lon)*c(eps),rAU*s(lon)*s(eps)];
}

/** Moon direction from Earth's center, truncated terms within a few arcminutes. */
function moonFromEarth(T) {
  const L=wrap(218.3164477+481267.88123421*T-0.0015786*T*T);
  const D=wrap(297.8501921+445267.1114034*T-0.0018819*T*T);
  const M=wrap(357.5291092+35999.0502909*T-0.0001536*T*T);
  const Mp=wrap(134.9633964+477198.8675055*T+0.0087414*T*T);
  const F=wrap(93.2720950+483202.0175233*T-0.0036539*T*T);
  const lon=L+6.289*s(Mp)+1.274*s(2*D-Mp)+0.658*s(2*D)+0.214*s(2*Mp)-0.186*s(M)-0.114*s(2*F)+0.059*s(2*D-2*Mp)+0.057*s(2*D-M-Mp)+0.053*s(2*D+Mp)+0.046*s(2*D-M)+0.041*s(M-Mp)-0.035*s(D)-0.031*s(M+Mp)-0.015*s(2*F-2*D);
  const lat=5.128*s(F)+0.280*s(Mp+F)+0.277*s(Mp-F)+0.173*s(2*D-F)+0.055*s(2*D+F-Mp)+0.046*s(2*D-F-Mp)+0.033*s(2*D+F)+0.017*s(2*Mp+F)+0.009*s(2*D+Mp-F);
  const eps=23.439291-0.0130042*T;
  const rAU=(385001-20905*c(Mp)-3699*c(2*D-Mp)-2956*c(2*D)-570*c(2*Mp)) / 149597870.7;
  const eclip=[rAU*c(lat)*c(lon),rAU*c(lat)*s(lon),rAU*s(lat)];
  return [eclip[0],eclip[1]*c(eps)-eclip[2]*s(eps),eclip[1]*s(eps)+eclip[2]*c(eps)];
}

/** IAU Moon principal-axis directions, expressed in the equatorial inertial frame. */
function moonAxes(julianDay) {
  const d=julianDay-2451545, T=d/36525;
  const E=[125.045-0.0529921*d,250.089-0.1059842*d,260.008+13.0120009*d,176.625+13.3407154*d,357.529+0.9856003*d,311.589+26.4057084*d,134.963+13.0649930*d,276.617+0.3287146*d,34.226+1.7484877*d,15.134-0.1589763*d,119.743+0.0036096*d,239.961+0.1643573*d,25.053+12.9590088*d];
  const [e1,e2,e3,e4,e5,e6,e7,e8,e9,e10,e11,e12,e13]=E;
  const a=269.9949+0.0031*T-3.8787*s(e1)-0.1204*s(e2)+0.0700*s(e3)-0.0172*s(e4)+0.0072*s(e6)-0.0052*s(e10)+0.0043*s(e13);
  const dec=66.5392+0.0130*T+1.5419*c(e1)+0.0239*c(e2)-0.0278*c(e3)+0.0068*c(e4)-0.0029*c(e6)+0.0009*c(e7)+0.0008*c(e10)-0.0009*c(e13);
  const w=38.3213+13.17635815*d-1.4e-12*d*d+3.5610*s(e1)+0.1208*s(e2)-0.0642*s(e3)+0.0158*s(e4)+0.0252*s(e5)-0.0066*s(e6)-0.0047*s(e7)-0.0046*s(e8)+0.0028*s(e9)+0.0052*s(e10)+0.0040*s(e11)+0.0019*s(e12)-0.0044*s(e13);
  const east=[-s(a),c(a),0];
  const north=[-s(dec)*c(a),-s(dec)*s(a),c(dec)];
  const z=[c(dec)*c(a),c(dec)*s(a),s(dec)];
  const x=east.map((v,i)=>c(w)*v+s(w)*north[i]);
  const y=east.map((v,i)=>-s(w)*v+c(w)*north[i]);
  return [x,y,z];
}

/** Returns source azimuth clockwise from north and elevation over a spherical flat horizon. */
function horizontal(dir,lat,lon) {
  const east=[-s(lon),c(lon),0];
  const north=[-s(lat)*c(lon),-s(lat)*s(lon),c(lat)];
  const up=[c(lat)*c(lon),c(lat)*s(lon),s(lat)];
  const el=radToDeg(Math.asin(clamp(dot(dir,up),-1,1)));
  const az=wrap(radToDeg(Math.atan2(dot(dir,east),dot(dir,north))));
  return {azimuth:az,elevation:el,visible:el>0};
}

export function ephemeris(dateLike,lat,lon) {
  const date=new Date(dateLike);
  if(Number.isNaN(date.getTime())) throw new Error('Invalid UTC date');
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>360) throw new Error('Invalid lunar coordinates');
  const J=jd(date), T=(J-2451545)/36525;
  const moon=moonFromEarth(T), sun=sunFromEarth(T);
  const earthMoon=norm(moon.map(x=>-x));
  const sunMoon=norm(sub(sun,moon));
  const axes=moonAxes(J);
  const fixed=v=>norm(axes.map(axis=>dot(axis,v)));
  return {time:date.toISOString(), sun:horizontal(fixed(sunMoon),lat,lon), earth:horizontal(fixed(earthMoon),lat,lon), model:'analytical-screening-v1'};
}

export function sampleWindow({start,days=7,stepHours=2,lat,lon}) {
  const base=new Date(start).getTime();
  if(!Number.isFinite(base)||days<1||days>31||stepHours<1||stepHours>24) throw new Error('Invalid sampling window');
  const result=[];
  for(let n=0;n<=Math.round(days*24/stepHours);n++) {
    const r=ephemeris(new Date(base+n*stepHours*3600000),lat,lon);
    result.push({...r,dual:r.sun.visible&&r.earth.visible});
  }
  return result;
}

export function summarize(samples) {
  if(!samples.length) return {sun:0,earth:0,dual:0,longestBlackoutHours:0};
  const n=samples.length-1;
  const avg=key=>n>0 ? 100*samples.slice(0,-1).filter(x=>key(x)).length/n : 0;
  const step=n>0 ? (Date.parse(samples[1].time)-Date.parse(samples[0].time))/3600000 : 0;
  let cur=0,max=0;
  samples.slice(0,-1).forEach(x=>{cur=x.earth.visible?0:cur+step;max=Math.max(max,cur);});
  return {sun:avg(x=>x.sun.visible),earth:avg(x=>x.earth.visible),dual:avg(x=>x.dual),longestBlackoutHours:max};
}

export function rankedSites(sites,start,days) {
  return sites.map(site=>({site,stats:summarize(sampleWindow({start,days,stepHours:4,lat:site.lat,lon:site.lon}))}))
    .sort((a,b)=>b.stats.dual-a.stats.dual || b.stats.sun-a.stats.sun);
}

export const D2R=R;
