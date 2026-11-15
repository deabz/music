// Static SVGs: geometry comes from the title seed; the page salt chooses a fresh palette/design.
function demoCover(title, pageSalt = 0) {
  const hash = text => { let n=2166136261; const value=String(text);for(let i=0;i<value.length;i++) {n^=value.charCodeAt(i);n=Math.imul(n,16777619);}return n>>>0; };
  const id=hash(String(title).toLowerCase().trim());
  let state=(id^Number(pageSalt))>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const palettes=[['#211833','#b29cde','#edb9bb','#f5ce99'],['#173d43','#6fa8a4','#cbb8d9','#e8d6ac'],['#422534','#d494ad','#efc09a','#9c8bc4'],['#292842','#898fc5','#bb9fcf','#e5be9e'],['#3a3032','#cfaa77','#d7b9c6','#8db9b4']];
  const style=(id+Number(pageSalt))>>>0;
  const palette=palettes[Math.floor(style/4)%palettes.length];
  const design=style%4,angle=Math.floor(random()*140)-70;
  const cx=170+id%240,cy=160+(id>>>9)%240,r=100+(id>>>16)%100;
  const label=Array.from(String(title)).slice(0,60).map(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff?'�':c).join('').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let shapes='';
  if(design===0) shapes=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#radial)"/><path d="M-80 500Q180 140 700 220L700 700H-80Z" fill="${palette[2]}" opacity=".65"/><path d="M-50 600Q200 200 680 370" fill="none" stroke="${palette[3]}" stroke-width="48"/>`;
  if(design===1) shapes=`<g transform="rotate(${angle} 300 300)">${Array.from({length:8},(_,i)=>`<rect x="${40+i*78}" y="-200" width="30" height="1000" rx="15" fill="${palette[2]}" opacity="${.3+i*.065}"/>`).join('')}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette[3]}" opacity=".85"/><circle cx="${cx}" cy="${cy}" r="${r*.55}" fill="${palette[0]}" opacity=".75"/>`;
  if(design===2) shapes=`<circle cx="70" cy="120" r="280" fill="url(#radial)"/><circle cx="560" cy="520" r="310" fill="${palette[2]}" opacity=".5"/><g transform="rotate(${angle} 300 300)"><rect x="140" y="90" width="320" height="420" rx="155" fill="none" stroke="${palette[3]}" stroke-width="36"/><path d="M300 70V530M160 300H440" stroke="${palette[0]}" stroke-width="16"/></g>`;
  if(design===3) shapes=`<path d="M-20 50Q300 320 640 50V640H-20Z" fill="${palette[2]}" opacity=".8"/>${Array.from({length:5},(_,i)=>`<path d="M-20 ${200+i*68}Q300 ${40+i*68} 640 ${240+i*68}" fill="none" stroke="${i%2?palette[0]:palette[3]}" stroke-width="${15+i*2}" opacity=".75"/>`).join('')}<circle cx="${cx}" cy="${cy}" r="65" fill="${palette[1]}"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><defs><linearGradient id="base" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient><radialGradient id="radial"><stop stop-color="${palette[3]}"/><stop offset="1" stop-color="${palette[1]}" stop-opacity=".2"/></radialGradient><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="${id%199}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="600" height="600" fill="url(#base)"/>${shapes}<rect width="600" height="600" filter="url(#grain)" opacity=".055"/><rect x="25" y="25" width="550" height="550" rx="3" fill="none" stroke="${palette[3]}" stroke-opacity=".4"/><rect x="36" y="452" width="528" height="112" rx="4" fill="${palette[0]}" opacity=".88"/><text x="54" y="480" fill="${palette[3]}" font-family="sans-serif" font-size="11" letter-spacing="4">NYX / FICTIONAL SESSIONS</text><text x="54" y="520" fill="#fff6ee" font-family="sans-serif" font-size="25" font-weight="600" textLength="480" lengthAdjust="spacingAndGlyphs">${label}</text><text x="54" y="546" fill="${palette[2]}" font-family="sans-serif" font-size="10" letter-spacing="3">VOL. ${String(id%99+1).padStart(2,'0')} — BROWSER EDITION</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
module.exports = { demoCover };
