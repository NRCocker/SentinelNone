import * as THREE from 'three';

// ====================================================================
//  Constants
// ====================================================================
const N = 28;                // tiles per side
const STEP = 0.5;            // world height of one terrain level
const EYE = 0.8;             // eye height above a vessel's base
const COST = { shard:1, stone:2, vessel:3, warden:4, sentry:3 };
const STACK_H = { stone:0.5, plinth:1.0 };   // only these can carry things on top
const HALF = THREE.MathUtils.degToRad(20);   // half-width of a watcher's gaze
const TURN = Math.PI * 2 / 10;               // one rotation step
const WARN = 0.9;                            // seconds of warning before a watcher turns
const V3 = THREE.Vector3;
// Touch devices get on-screen buttons; every piece of help text names the control the player actually has.
const TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const KEY = TOUCH
  ? { absorb:'ABSORB', stone:'STONE', vessel:'VESSEL', transfer:'TRANSFER', leap:'LEAP', turn:'TURN', hints:'TIPS', look:'drag on the screen' }
  : { absorb:'A', stone:'Q', vessel:'E', transfer:'F', leap:'Space', turn:'R', hints:'H', look:'move the mouse' };
if(TOUCH) document.body.classList.add('touch');

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const smooth = t => t*t*(3-2*t);

// ====================================================================
//  Renderer / scene
// ====================================================================
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0x3a2b45;
scene.fog = new THREE.Fog(FOG, 16, 62);
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';

// sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite:false, fog:false,
  uniforms: { top:{value:new THREE.Color(0x090b20)}, mid:{value:new THREE.Color(0x35295a)},
              hor:{value:new THREE.Color(0xd9876a)}, bot:{value:new THREE.Color(FOG)} },
  vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform vec3 top,mid,hor,bot; varying vec3 vP;
    void main(){ float h=normalize(vP).y; vec3 c;
      if(h<0.0) c=mix(hor,bot,smoothstep(0.0,0.06,-h));
      else if(h<0.22) c=mix(hor,mid,smoothstep(0.0,0.22,h));
      else c=mix(mid,top,smoothstep(0.22,0.85,h));
      gl_FragColor=vec4(c,1.0);} `
}));
scene.add(sky);
{ // stars
  const p=[]; for(let i=0;i<700;i++){ const u=Math.random()*Math.PI*2, v=0.15+Math.random()*0.85;
    const r=240, cy=v, s=Math.sqrt(1-cy*cy); p.push(Math.cos(u)*s*r, cy*r, Math.sin(u)*s*r); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color:0xfff4e0, size:1.4, sizeAttenuation:false, fog:false })));
}
scene.add(new THREE.HemisphereLight(0x8c9fd8, 0x2a1f2e, 0.85));
const sun = new THREE.DirectionalLight(0xffd2a0, 1.25);
sun.position.set(-20, 18, -6); sun.target.position.set(N/2, 0, N/2);
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshLambertMaterial({ color:0x1d1628 }));
ground.rotation.x = -Math.PI/2; ground.position.set(N/2, -2.2, N/2); scene.add(ground);

const world = new THREE.Group(); scene.add(world);     // terrain meshes
const objGroup = new THREE.Group(); scene.add(objGroup); // live, pickable objects
const fxGroup = new THREE.Group(); scene.add(fxGroup);   // dying meshes (not pickable)

// target marker
const marker = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([new V3(-.46,0,-.46),new V3(.46,0,-.46),new V3(.46,0,.46),new V3(-.46,0,.46)]),
  new THREE.LineBasicMaterial({ color:0x9fffd0, transparent:true, depthTest:false }));
marker.renderOrder = 10; scene.add(marker);

// ====================================================================
//  Shared geometry / materials
// ====================================================================
const GEO = {
  stone: new THREE.CylinderGeometry(0.34, 0.4, 0.5, 6).translate(0, 0.25, 0),
  shard: new THREE.OctahedronGeometry(0.17).scale(1, 2.0, 1),
  shardBase: new THREE.CylinderGeometry(0.12, 0.16, 0.06, 5).translate(0, 0.03, 0),
  vBase: new THREE.CylinderGeometry(0.24, 0.28, 0.1, 6),
  vBody: new THREE.CylinderGeometry(0.11, 0.19, 0.56, 5),
  vHead: new THREE.BoxGeometry(0.24, 0.16, 0.2),
  vVisor: new THREE.BoxGeometry(0.18, 0.04, 0.01),
  vHalo: new THREE.TorusGeometry(0.16, 0.02, 6, 18),
  plinth: new THREE.BoxGeometry(0.84, 1.0, 0.84).translate(0, 0.5, 0),
  plinthBand: new THREE.BoxGeometry(0.88, 0.05, 0.88),
  wBase: new THREE.CylinderGeometry(0.22, 0.28, 0.12, 8).translate(0, 0.06, 0),
  wMast: new THREE.CylinderGeometry(0.04, 0.09, 0.95, 6).translate(0, 0.47, 0),
  wRing: new THREE.TorusGeometry(0.3, 0.045, 8, 28),
  wEye: new THREE.SphereGeometry(0.15, 16, 12),
};
const MAT = {
  stone: new THREE.MeshLambertMaterial({ color:0x8d8579, flatShading:true }),
  shard: new THREE.MeshLambertMaterial({ color:0x7ff0d4, emissive:0x1f7a68, flatShading:true }),
  vessel: new THREE.MeshLambertMaterial({ color:0xebe3cf, flatShading:true }),
  vesselDark: new THREE.MeshLambertMaterial({ color:0x3b3552, flatShading:true }),
  glow: new THREE.MeshBasicMaterial({ color:0x9ff5ff }),
  plinth: new THREE.MeshLambertMaterial({ color:0x2e2a40, flatShading:true }),
  band: new THREE.MeshBasicMaterial({ color:0xffc36b }),
  warden: new THREE.MeshLambertMaterial({ color:0x262035, flatShading:true }),
};

// ====================================================================
//  Game state
// ====================================================================
const G = {
  state:'title', level:1, energy:10, startEnergy:10,
  tiles:[], objects:[], wardens:[], player:null, mainWarden:null, wardenGone:false,
  yaw:0, pitch:0, tgt:null, seen:0, params:null, terrain:null, faceTile:null,
};

const tileCenter = t => ({ x:(t%N)+0.5, z:Math.floor(t/N)+0.5 });
const tileY = t => G.tiles[t].level * STEP;
function supportY(t, idx){ let y=tileY(t); const s=G.tiles[t].stack; for(let i=0;i<idx;i++) y+=STACK_H[s[i].type]||0; return y; }
const topY = t => supportY(t, G.tiles[t].stack.length);
function canPlaceOn(t){ const T=G.tiles[t]; if(!T.flat) return false; const s=T.stack;
  return s.length===0 || (STACK_H[s[s.length-1].type]||0) > 0; }
const stackIdx = o => G.tiles[o.tile].stack.indexOf(o);
function playerEye(){ const p=G.player, c=tileCenter(p.tile); return new V3(c.x, supportY(p.tile, stackIdx(p))+EYE, c.z); }

// ====================================================================
//  Terrain generation
// ====================================================================
function genHeights(rng, level){
  const V=N+1;
  const oct=[{cells:3,amp:1},{cells:6,amp:0.45},{cells:12,amp:0.18}];
  for(const o of oct){ o.g=[]; for(let i=0;i<(o.cells+1)**2;i++) o.g.push(rng()); }
  const sample=(o,u,v)=>{ const x=u*o.cells, y=v*o.cells;
    const x0=Math.min(Math.floor(x),o.cells-1), y0=Math.min(Math.floor(y),o.cells-1);
    const fx=smooth(x-x0), fy=smooth(y-y0), c=o.cells+1;
    const a=o.g[y0*c+x0], b=o.g[y0*c+x0+1], d=o.g[(y0+1)*c+x0], e=o.g[(y0+1)*c+x0+1];
    return (a*(1-fx)+b*fx)*(1-fy)+(d*(1-fx)+e*fx)*fy; };
  const raw=new Float32Array(V*V); let mn=1e9, mx=-1e9;
  for(let z=0;z<V;z++) for(let x=0;x<V;x++){
    let s=0,t=0; for(const o of oct){ s+=sample(o,x/N,z/N)*o.amp; t+=o.amp; }
    raw[z*V+x]=s/t; mn=Math.min(mn,s/t); mx=Math.max(mx,s/t); }
  const maxLv=Math.min(14, 9+Math.floor(level/2));
  let hv=new Int32Array(V*V);
  for(let z=0;z<V;z++) for(let x=0;x<V;x++){
    let n=(raw[z*V+x]-mn)/(mx-mn);
    const e=Math.min(x,z,N-x,N-z)/(N*0.22);           // island falloff
    n*=0.45+0.55*smooth(Math.min(1,e));
    hv[z*V+x]=Math.floor(Math.pow(n,1.25)*(maxLv+0.999));
  }
  for(let pass=0;pass<2;pass++){                       // median filter → plateaus
    const out=new Int32Array(V*V);
    for(let z=0;z<V;z++) for(let x=0;x<V;x++){ const a=[];
      for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){
        const xx=Math.max(0,Math.min(N,x+dx)), zz=Math.max(0,Math.min(N,z+dz)); a.push(hv[zz*V+xx]); }
      a.sort((p,q)=>p-q); out[z*V+x]=a[4]; }
    hv=out;
  }
  for(let it=0;it<10;it++) for(let z=0;z<V;z++) for(let x=0;x<V;x++){   // limit steepness
    const a=z*V+x;
    for(const b of [x<N?a+1:-1, z<N?a+V:-1]) if(b>=0){
      if(hv[a]>hv[b]+2) hv[a]=hv[b]+2; else if(hv[b]>hv[a]+2) hv[b]=hv[a]+2; }
  }
  return { hv, maxLv };
}

const PAL=[[0,0x24474f],[0.3,0x3f6e5f],[0.55,0x7f9a6a],[0.8,0xc8b98a],[1,0xf1ead6]].map(([k,c])=>[k,new THREE.Color(c)]);
function palette(n){ for(let i=1;i<PAL.length;i++) if(n<=PAL[i][0]){
  const k=(n-PAL[i-1][0])/(PAL[i][0]-PAL[i-1][0]); return PAL[i-1][1].clone().lerp(PAL[i][1],k); }
  return PAL[PAL.length-1][1].clone(); }

function buildTerrain(hv, maxLv){
  const V=N+1, pos=[], col=[], faceTile=[];
  const slopeLo=new THREE.Color(0x3a2f44), slopeHi=new THREE.Color(0x76655f);
  const P=(x,z)=>[x, hv[z*V+x]*STEP, z];
  for(let z=0;z<N;z++) for(let x=0;x<N;x++){
    const t=z*N+x, T=G.tiles[t];
    const a=P(x,z), b=P(x,z+1), c=P(x+1,z), d=P(x+1,z+1);
    let colr;
    if(T.flat){ colr=palette(T.level/maxLv); if((x+z)&1) colr.multiplyScalar(0.9); }
    else { const avg=(a[1]+b[1]+c[1]+d[1])/4/(maxLv*STEP); colr=slopeLo.clone().lerp(slopeHi,avg); }
    for(const v of [a,b,c, c,b,d]){ pos.push(...v); col.push(colr.r,colr.g,colr.b); }
    faceTile.push(t,t);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
  g.computeVertexNormals();
  const mesh=new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors:true, flatShading:true }));
  // skirts around the island edge
  const sp=[], B=-2.2;
  const edge=(x0,z0,x1,z1)=>{ const y0=hv[z0*V+x0]*STEP, y1=hv[z1*V+x1]*STEP;
    sp.push(x0,y0,z0, x1,y1,z1, x0,B,z0,  x1,y1,z1, x1,B,z1, x0,B,z0); };
  for(let i=0;i<N;i++){ edge(i,0,i+1,0); edge(i,N,i+1,N); edge(0,i,0,i+1); edge(N,i,N,i+1); }
  const sg=new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp,3));
  sg.computeVertexNormals();
  const skirt=new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color:0x2a2034, side:THREE.DoubleSide }));
  return { mesh, skirt, faceTile, baseCol: Float32Array.from(col) };
}

// Tint every square a watcher can currently see — computed with exactly the same rule used for draining,
// so lit ground is a truthful map of danger. Recomputed only when something changes (turns, objects).
const LIT_MAIN=new THREE.Color(0xffb35c), LIT_SENTRY=new THREE.Color(0xff5a4a);
function updateLit(){
  G.litDirty=false;
  scene.updateMatrixWorld();          // objects placed this frame haven't been rendered yet
  const lit=new Uint8Array(N*N);
  for(const w of G.wardens){
    if(w.turnT<1 || (G.tut && !G.tut.awake)) continue;   // mid-turn or asleep: show nothing
    const eye=wardenEye(w), kind=w.type==='sentry'?2:1;
    for(let t=0;t<N*N;t++){
      if(!G.tiles[t].flat || t===w.tile || lit[t]===1) continue;
      const c=tileCenter(t); if(!inCone(w,c.x,c.z)) continue;
      if(seesSurface(eye, t, topY(t), [w.tile])) lit[t]=kind;
    }
  }
  const attr=G.terrain.geometry.attributes.color, a=attr.array, b=G.baseCol, tmp=new THREE.Color();
  for(let t=0;t<N*N;t++) for(let v=t*18; v<t*18+18; v+=3){
    if(lit[t]){ tmp.setRGB(b[v],b[v+1],b[v+2]).lerp(lit[t]===1?LIT_MAIN:LIT_SENTRY, 0.42);
      a[v]=tmp.r; a[v+1]=tmp.g; a[v+2]=tmp.b; }
    else { a[v]=b[v]; a[v+1]=b[v+1]; a[v+2]=b[v+2]; }
  }
  attr.needsUpdate=true;
}

// ====================================================================
//  Objects
// ====================================================================
function makeVesselMesh(){
  const g=new THREE.Group();
  const base=new THREE.Mesh(GEO.vBase, MAT.vesselDark); base.position.y=0.05;
  const body=new THREE.Mesh(GEO.vBody, MAT.vessel); body.position.y=0.38;
  const head=new THREE.Mesh(GEO.vHead, MAT.vessel); head.position.y=0.76;
  const visor=new THREE.Mesh(GEO.vVisor, MAT.glow); visor.position.set(0,0.77,0.105);
  const halo=new THREE.Mesh(GEO.vHalo, MAT.glow); halo.rotation.x=Math.PI/2; halo.position.y=0.93;
  g.add(base,body,head,visor,halo); return g;
}
function makeWardenMesh(small){
  const g=new THREE.Group(), s=small?0.72:1;
  const eyeMat=new THREE.MeshBasicMaterial({ color: small?0xff7a6b:0xffc36b });
  // The gaze is a horizontal fan (sight has no vertical limit), so draw it as a flat sector at eye height
  // whose brightness fades with distance. The ground it can actually see is tinted separately (updateLit).
  const coneMat=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
    uniforms:{ col:{ value:new THREE.Color(small?0xff6a5a:0xffc070) }, op:{ value:0.09 } },
    vertexShader:`varying float vD; void main(){ vD=length(position.xy)/${(40/s).toFixed(1)}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform vec3 col; uniform float op; varying float vD; void main(){ gl_FragColor=vec4(col*op*pow(1.0-vD,2.4),1.0);}`,
  });
  const cone=new THREE.Mesh(new THREE.CircleGeometry(40/s, 24, -Math.PI/2-HALF, HALF*2).rotateX(-Math.PI/2), coneMat);
  cone.position.y=1.05; cone.raycast=()=>{};
  const eye=new THREE.Mesh(GEO.wEye, eyeMat); eye.position.y=1.05;
  const ring=new THREE.Mesh(GEO.wRing, MAT.warden); ring.position.y=1.05; ring.name='ring';
  g.add(new THREE.Mesh(GEO.wBase, MAT.warden), new THREE.Mesh(GEO.wMast, MAT.warden), ring, eye, cone);
  g.scale.setScalar(s);
  return { g, eye, cone, eyeH:1.05*s };
}
function makeObj(type){
  const o={ type, tile:-1, mesh:null };
  let m;
  if(type==='stone'){ m=new THREE.Mesh(GEO.stone, MAT.stone); m.rotation.y=Math.random()*Math.PI; }
  else if(type==='shard'){ m=new THREE.Group(); const c=new THREE.Mesh(GEO.shard, MAT.shard); c.position.y=0.4; c.name='spin';
    c.rotation.y=Math.random()*3; m.add(c, new THREE.Mesh(GEO.shardBase, MAT.stone)); }
  else if(type==='vessel') m=makeVesselMesh();
  else if(type==='plinth'){ m=new THREE.Group(); const band=new THREE.Mesh(GEO.plinthBand, MAT.band); band.position.y=0.8;
    m.add(new THREE.Mesh(GEO.plinth, MAT.plinth), band); }
  else { const w=makeWardenMesh(type==='sentry'); m=w.g; Object.assign(o, { eye:w.eye, cone:w.cone, eyeH:w.eyeH }); }
  m.userData.obj=o; o.mesh=m; return o;
}
const anims=[];
function addObj(type, t, animate=false){
  const o=makeObj(type), y=topY(t), c=tileCenter(t);
  o.tile=t; G.tiles[t].stack.push(o); G.objects.push(o);
  o.mesh.position.set(c.x, y, c.z); objGroup.add(o.mesh);
  if(animate){ o.mesh.scale.multiplyScalar(0.01); anims.push({ mesh:o.mesh, t:0, dur:0.3, kind:'in', s:type==='sentry'?0.72:1 }); }
  G.litDirty=true;
  return o;
}
function killObj(o){
  const s=G.tiles[o.tile].stack; s.splice(s.indexOf(o),1);
  G.objects.splice(G.objects.indexOf(o),1);
  objGroup.remove(o.mesh); fxGroup.add(o.mesh); o.mesh.visible=true;
  anims.push({ mesh:o.mesh, t:0, dur:0.35, kind:'out', s:o.mesh.scale.x });
  const wi=G.wardens.indexOf(o); if(wi>=0){ G.wardens.splice(wi,1); buildCompass(); }
  G.litDirty=true;
}
const ownerObj = m => { while(m){ if(m.userData.obj) return m.userData.obj; m=m.parent; } return null; };

// ====================================================================
//  Line of sight
// ====================================================================
const losRay=new THREE.Raycaster(), _d=new V3();
function los(from, to, ignore){
  _d.subVectors(to, from); const dist=_d.length(); if(dist<1e-4) return true;
  losRay.set(from, _d.normalize()); losRay.far=dist-0.03;
  const occ=[G.terrain];
  for(const o of G.objects) if(STACK_H[o.type] && !ignore.includes(o.tile)) occ.push(o.mesh);
  for(const h of losRay.intersectObjects(occ, true)){
    if(h.object===G.terrain){ if(ignore.includes(G.faceTile[h.faceIndex])) continue; return false; }
    return false;
  }
  return true;
}
const SAMPLES=[[0,0],[0.3,0.3],[-0.3,0.3],[0.3,-0.3],[-0.3,-0.3]];
function seesSurface(eye, t, y, ignore){
  if(eye.y <= y+0.01) return false;
  const c=tileCenter(t), p=new V3();
  for(const [sx,sz] of SAMPLES){ p.set(c.x+sx, y+0.02, c.z+sz); if(los(eye, p, [t, ...ignore])) return true; }
  return false;
}

// ====================================================================
//  Level setup
// ====================================================================
function loadLevel(level, energy){
  for(const g of [world, objGroup, fxGroup, wispGroup]) g.clear();
  document.querySelectorAll('#compass .m').forEach(m=>m.remove());
  anims.length=0;
  Object.assign(G, { level, energy, startEnergy:energy, objects:[], wardens:[], wisps:[], wardenGone:false, tgt:null, seen:0,
    tut: level===0 ? { step:0, awake:false } : null, hintsShown:new Set(), idleT:0, hiddenFails:0,
    stats:{ time:0, absorbed:0, built:0, transfers:0, leaps:0, drained:0, wispsSent:0, wispsEscaped:0, wispHits:0 } });
  G.params = level===0 ? {          // training: slow and forgiving once the Warden wakes
    rotInterval:8, firstDrain:2.5, drainInterval:3.5, objInterval:12, glimpse:5, wispSpeed:0.9,
  } : {
    rotInterval: Math.max(2.4, 6.5 - level*0.4),
    firstDrain:  Math.max(0.9, 1.8 - level*0.08),
    drainInterval: Math.max(1.4, 3.0 - level*0.12),
    objInterval: Math.max(3, 7 - level*0.3),
    glimpse: Math.max(2, 3.6 - level*0.15),
    wispSpeed: Math.min(2.6, 1.3 + level*0.08),
  };
  const rng=mulberry32(level*9973+17);
  const { hv, maxLv } = genHeights(rng, level);
  G.hv=hv;
  const V=N+1; G.tiles=[];
  for(let z=0;z<N;z++) for(let x=0;x<N;x++){
    const a=hv[z*V+x], b=hv[z*V+x+1], c=hv[(z+1)*V+x], d=hv[(z+1)*V+x+1];
    const flat=a===b&&a===c&&a===d;
    G.tiles.push({ flat, level: flat?a:Math.min(a,b,c,d), stack:[] });
  }
  const tm=buildTerrain(hv, maxLv);
  G.terrain=tm.mesh; G.faceTile=tm.faceTile; G.baseCol=tm.baseCol; world.add(tm.mesh, tm.skirt);

  const flats=[]; G.tiles.forEach((T,i)=>{ if(T.flat) flats.push(i); });
  const pick=a=>a[Math.floor(rng()*a.length)];
  const dist=(a,b)=>{ const p=tileCenter(a), q=tileCenter(b); return Math.hypot(p.x-q.x, p.z-q.z); };
  const topLv=Math.max(...flats.map(t=>G.tiles[t].level));
  const wt=pick(flats.filter(t=>G.tiles[t].level===topLv));

  addObj('plinth', wt);
  const w=addObj('warden', wt); G.mainWarden=w; G.wardens.push(w);

  const byLv=[...flats].sort((a,b)=>G.tiles[a].level-G.tiles[b].level);
  let low=byLv.slice(0, Math.max(6, Math.floor(byLv.length*0.35))).filter(t=>dist(t,wt)>N*0.35);
  if(!low.length) low=byLv.slice(0,10);
  const pt=pick(low);
  G.player=addObj('vessel', pt); G.player.mesh.visible=false;

  const empty=f=>flats.filter(t=>G.tiles[t].stack.length===0 && (!f||f(t)));
  const sentries=Math.min(3, Math.floor(level/2));
  for(let i=0;i<sentries;i++){
    const c=empty(t=>G.tiles[t].level>=topLv*0.45 && dist(t,pt)>7);
    if(!c.length) break;
    const s=addObj('sentry', pick(c)); G.wardens.push(s);
  }
  const shards=Math.max(10, 20 - level);
  for(let i=0;i<shards;i++){ const c=empty(); if(c.length) addObj('shard', pick(c)); }

  for(const wd of G.wardens){
    const main = wd===w;
    wd.heading = main ? Math.atan2(tileCenter(pt).x-tileCenter(wt).x, tileCenter(pt).z-tileCenter(wt).z)+Math.PI
                      : rng()*Math.PI*2;
    wd.mesh.rotation.y=wd.heading; wd.turnT=1; wd.dir= main?1:-1;
    wd.rotInterval = G.params.rotInterval*(main?1:0.8);
    wd.timer = wd.rotInterval*(0.5+rng()); wd.drainT=G.params.firstDrain; wd.holdT=0; wd.objT=G.params.objInterval; wd.sees=0; wd.glimpseT=0;
  }
  faceToward(wt);
  G.spin=0; G.swoop=null; G.litDirty=true;
  renderer.domElement.style.filter='';
  buildCompass(); renderTut();
  updateHUD(true);
  toast(level===0 ? 'Training ground' :
    `Level ${level}` + (sentries?` — ${G.wardens.length-1} sentr${G.wardens.length-1===1?'y':'ies'} on watch`:'')
    + `  ·  code ${levelCode(level)}`, 3200);
}
function faceToward(t, liftTo){
  const e=playerEye(), c=tileCenter(t);
  G.yaw=Math.atan2(-(c.x-e.x), -(c.z-e.z));
  const ty = liftTo ?? topY(t)+0.6;
  G.pitch=Math.max(-1.2, Math.min(1.0, Math.atan2(ty-e.y, Math.hypot(c.x-e.x, c.z-e.z))));
}

// ====================================================================
//  Targeting
// ====================================================================
const pickRay=new THREE.Raycaster(), CENTER=new THREE.Vector2(0,0);
function pick(){
  pickRay.setFromCamera(CENTER, camera);
  for(const h of pickRay.intersectObjects([G.terrain, objGroup, wispGroup], true)){
    let m=h.object; while(m && !m.userData.wisp) m=m.parent;
    if(m) return { wisp:m.userData.wisp };
    if(h.object===G.terrain){ const t=G.faceTile[h.faceIndex];
      return G.tiles[t].flat ? { tile:t, direct:true } : { tile:t, slope:true }; }
    const o=ownerObj(h.object); if(!o || o===G.player) continue;
    return { tile:o.tile, obj:o };
  }
  return null;
}
const NAMES={ shard:'Shard', stone:'Stone', vessel:'Vessel', warden:'The Warden', sentry:'Sentry', plinth:"Warden's plinth" };
function evaluate(){
  const hit=pick(), T={ hit };
  G.tgt=T; marker.visible=false;
  if(!hit) return setInfo('');
  if(hit.wisp) return setInfo('Wisp · dispel [A]');
  if(hit.slope) return setInfo('<span class="no">Sloped ground — nothing can stand here</span>');
  const t=hit.tile; T.t=t;
  if(t===G.player.tile) return setInfo('<span class="no">Your own square</span>');
  const eye=playerEye(), s=G.tiles[t].stack, top=s[s.length-1];
  const see=y=> (hit.direct && Math.abs(y-tileY(t))<1e-4) || seesSurface(eye, t, y, [G.player.tile]);
  if(top && top.type!=='plinth'){ T.canAbsorb=see(supportY(t, s.length-1)); T.canTransfer=T.canAbsorb && top.type==='vessel'; }
  if(canPlaceOn(t)) T.canPlace=see(topY(t));
  const ok=T.canAbsorb||T.canPlace;
  const c=tileCenter(t); marker.position.set(c.x, topY(t)+0.02, c.z); marker.visible=true;
  marker.material.color.set(ok?0x9fffd0:0xff7a7a); marker.material.opacity=ok?0.95:0.5;

  let txt;
  const hidden=' <span class="no">— surface hidden from here</span>';
  if(!top) txt = 'Open ground' + (T.canPlace?' · build here':hidden);
  else if(top.type==='plinth') txt = "The Warden's plinth" + (T.canPlace?' · place a vessel, transfer, then ascend':hidden);
  else {
    const n=s.filter(o=>o.type==='stone').length;
    txt = NAMES[top.type] + (top.type==='stone'&&n>1?` stack ×${n}`:'');
    if(T.canAbsorb && top.type==='warden') showHint('reach');
    if(T.canAbsorb){ txt+=` · absorb +${COST[top.type]}`;
      if(top.type==='vessel') txt+=' · transfer'; if(T.canPlace) txt+=' · build on top'; }
    else txt += top.type==='warden' ? ' <span class="no">— climb above its plinth to reach it</span>' : hidden;
  }
  setInfo(txt);
}

// ====================================================================
//  Actions
// ====================================================================
function fail(msg){ toast(msg, 1400); SFX.tone(160,140,0.12,'square',0.06);
  if(/can't see/.test(msg) && ++G.hiddenFails>=2) showHint('hidden'); }
function needTarget(){ const T=G.tgt; if(!T||T.t==null){ fail(T&&T.hit&&T.hit.slope?'Nothing can stand on a slope':'No target'); return null; }
  if(T.t===G.player.tile){ fail("You can't act on your own square"); return null; } return T; }

function doAbsorb(){
  if(G.tgt && G.tgt.hit && G.tgt.hit.wisp){ dissipate(G.tgt.hit.wisp); G.stats.wispsEscaped++; SFX.absorb(); toast('Wisp dispelled', 1400); emit('dispel'); return; }
  const T=needTarget(); if(!T) return;
  const s=G.tiles[T.t].stack, top=s[s.length-1];
  if(!top) return fail('Nothing here to absorb');
  if(top.type==='plinth') return fail("The plinth can't be absorbed");
  if(!T.canAbsorb) return fail("You can't see the surface it stands on");
  G.energy+=COST[top.type]; G.stats.absorbed+=COST[top.type]; killObj(top); SFX.absorb();
  if(top===G.mainWarden){ G.wardenGone=true; G.mainWarden=null; buildCompass();
    toast('The Warden is gone. Put a vessel on its plinth, transfer into it, and ascend.', 4200); SFX.ascendHint();
    showHint('plinth'); }
  else if(top.type==='sentry') toast('Sentry absorbed', 1500);
  updateHUD(); emit('absorb', { type:top.type });
}
function doCreate(type){
  const T=needTarget(); if(!T) return;
  if(!canPlaceOn(T.t)) return fail(G.tiles[T.t].stack.length?'Something is already standing there':'Nothing can stand there');
  if(!T.canPlace) return fail("You can't see that surface");
  if(G.energy<COST[type]) return fail('Not enough energy');
  G.energy-=COST[type]; G.stats.built++;
  const o=addObj(type, T.t, true);
  if(type==='vessel'){ const a=tileCenter(T.t), e=playerEye(); o.mesh.rotation.y=Math.atan2(e.x-a.x, e.z-a.z); }
  SFX.create(type); updateHUD();
  const s=G.tiles[T.t].stack; emit('create', { type, onStone: s.length>1 && s[s.length-2].type==='stone' });
}
function doTransfer(){
  const T=needTarget(); if(!T) return;
  const s=G.tiles[T.t].stack, top=s[s.length-1];
  if(!top || top.type!=='vessel') return fail('You can only transfer into a vessel');
  if(!T.canTransfer) return fail("You can't see the surface it stands on");
  transferTo(top); G.stats.transfers++; emit('transfer');
}
function transferTo(v){
  const old=G.player, from=playerEye(), fromYaw=G.yaw, fromPitch=G.pitch;
  old.mesh.rotation.y=G.yaw+Math.PI; old.mesh.visible=true;
  G.player=v; v.mesh.visible=false; G.spin=0;
  faceToward(old.tile, supportY(old.tile, stackIdx(old))+0.6);
  // Swoop the camera from the old eye to the new one; actions wait until it lands.
  const dist=from.distanceTo(playerEye());
  G.swoop={ from, fromYaw, fromPitch, t:0, dur:Math.min(0.9, 0.3+dist*0.03), arc:Math.min(1.6, 0.25+dist*0.08) };
  pulse('flash', 0.25, 0.35); SFX.transfer();
  for(const w of G.wardens) w.drainT=G.params.firstDrain;
}
function doLeap(){
  const pt=G.player.tile, s=G.tiles[pt].stack;
  if(G.wardenGone && s[0] && s[0].type==='plinth') return ascend();
  if(G.energy<3) return die('You leapt with too little energy and dissolved into the void.');
  G.energy-=3;
  if(!leapRandom()){ G.energy+=3; return fail('Nowhere to leap to'); }
  G.stats.leaps++; toast('Leapt', 1200); updateHUD(); emit('leap');
}
// Move into a fresh vessel on a random empty square no higher than where you stand now.
function leapRandom(){
  const pt=G.player.tile, sy=supportY(pt, stackIdx(G.player));
  let c=[]; G.tiles.forEach((T,i)=>{ if(T.flat && !T.stack.length && i!==pt && T.level*STEP<=sy+1e-6) c.push(i); });
  if(!c.length) G.tiles.forEach((T,i)=>{ if(T.flat && !T.stack.length && i!==pt) c.push(i); });
  if(!c.length) return false;
  transferTo(addObj('vessel', c[Math.floor(Math.random()*c.length)]));
  return true;
}

// ====================================================================
//  Watchers
// ====================================================================
function inCone(w, x, z){
  const dx=x-w.mesh.position.x, dz=z-w.mesh.position.z;
  if(dx*dx+dz*dz<0.01) return false;
  let d=Math.atan2(dx,dz)-w.heading; d=Math.atan2(Math.sin(d),Math.cos(d));
  return Math.abs(d)<HALF;
}
const wardenEye = w => new V3(w.mesh.position.x, w.mesh.position.y+w.eyeH, w.mesh.position.z);

// ====================================================================
//  Wisps — sent after a body that a watcher has glimpsed for too long.
//  A wisp hunts one specific vessel. If you've transferred away, it strikes the empty body instead.
// ====================================================================
const WISP = { core:new THREE.SphereGeometry(0.12, 12, 8), halo:new THREE.SphereGeometry(0.3, 12, 8),
  coreMat:new THREE.MeshBasicMaterial({ color:0xe2c4ff }),
  haloMat:new THREE.MeshBasicMaterial({ color:0x9a5cff, transparent:true, opacity:0.35, blending:THREE.AdditiveBlending, depthWrite:false }) };
const wispGroup=new THREE.Group(); scene.add(wispGroup);
function groundAt(x, z){
  const xi=Math.max(0,Math.min(N-1,Math.floor(x))), zi=Math.max(0,Math.min(N-1,Math.floor(z)));
  const fx=Math.max(0,Math.min(1,x-xi)), fz=Math.max(0,Math.min(1,z-zi)), V=N+1, hv=G.hv;
  const h=(hv[zi*V+xi]*(1-fx)*(1-fz)+hv[zi*V+xi+1]*fx*(1-fz)+hv[(zi+1)*V+xi]*(1-fx)*fz+hv[(zi+1)*V+xi+1]*fx*fz)*STEP;
  const t=zi*N+xi; return Math.max(h, topY(t) + (G.tiles[t].stack.length?1:0));
}
function makeWisp(pos, target){
  const m=new THREE.Group(), halo=new THREE.Mesh(WISP.halo, WISP.haloMat); halo.name='halo';
  m.add(new THREE.Mesh(WISP.core, WISP.coreMat), halo); m.position.copy(pos);
  const wi={ mesh:m, target, chirp:0, t:Math.random()*6 };
  m.userData.wisp=wi; wispGroup.add(m); G.wisps.push(wi);
  wi.marker=document.createElement('div'); wi.marker.className='m wisp'; $('compass').append(wi.marker);
  return wi;
}
function spawnWisp(w){
  makeWisp(wardenEye(w), G.player); G.stats.wispsSent++;
  SFX.wisp(); toast('A wisp has been sent after you', 2200); showHint('wisp'); updateHUD();
}
function dissipate(wi){
  const i=G.wisps.indexOf(wi); if(i<0) return;
  G.wisps.splice(i,1); wispGroup.remove(wi.mesh); fxGroup.add(wi.mesh); wi.marker.remove();
  anims.push({ mesh:wi.mesh, t:0, dur:0.4, kind:'out', s:1 }); updateHUD();
}
function strike(wi){
  const tg=wi.target, t=tg.tile; dissipate(wi); SFX.strike(); pulse('flash', 0.5, 0.4);
  if(tg===G.player){
    G.energy-=2; G.stats.wispHits++; pulse('vig', 1);
    if(G.energy<0){ G.energy=0; updateHUD(); return die('A wisp caught you with nothing left to lose.'); }
    if(!leapRandom()) G.energy=Math.max(0,G.energy);
    toast('The wisp struck you — you were thrown elsewhere (−2)', 2600); updateHUD();
  } else {
    killObj(tg); addObj('stone', t, true); spawnShard(); G.stats.wispsEscaped++;
    toast('The wisp struck your empty body', 2000);
  }
}
function updateWisps(dt){
  const pe=playerEye();
  for(const wi of [...G.wisps]){
    const tg=wi.target;
    if(!G.objects.includes(tg)){ dissipate(wi); continue; }
    const c=tileCenter(tg.tile), ty=supportY(tg.tile, stackIdx(tg))+0.75, p=wi.mesh.position;
    const dx=c.x-p.x, dz=c.z-p.z, d=Math.hypot(dx,dz);
    if(d<0.2 && Math.abs(p.y-ty)<0.35){ strike(wi); if(G.state!=='play') return; continue; }
    const step=Math.min(d, G.params.wispSpeed*dt), ux=d>1e-4?dx/d:0, uz=d>1e-4?dz/d:0;
    p.x+=ux*step; p.z+=uz*step;
    const cruise=Math.max(groundAt(p.x,p.z), groundAt(p.x+ux*0.8, p.z+uz*0.8))+0.9;
    const wantY = d<1.2 ? ty : Math.max(cruise, ty*Math.min(1, 1.5/d));
    p.y+=(wantY-p.y)*Math.min(1, dt*3);
    // keep clear of the ground — except on final approach, where "ground" would include the target itself
    if(d>=1.2) p.y=Math.max(p.y, groundAt(p.x,p.z)+0.25);
    wi.t+=dt; const h=wi.mesh.getObjectByName('halo'); h.scale.setScalar(1+Math.sin(wi.t*9)*0.18);
    wi.chirp-=dt;
    if(wi.chirp<=0){ const dist=p.distanceTo(pe); wi.chirp=Math.max(0.25, Math.min(1.4, dist/8));
      if(tg===G.player) SFX.chirp(dist); }
  }
}

// ====================================================================
//  Hints — short, contextual, each shown once per level (idle repeats). H toggles them.
// ====================================================================
const press = k => `${TOUCH?'tap':'press'} <b>${KEY[k]}</b>`;     // "press A" / "tap ABSORB"
const HINTS = {
  drained: `You're standing on lit ground and being drained. Transfer to a vessel on dark ground, or ${press('leap')} to leap away (costs 3).`,
  glimpsed: "Glimpsed: a watcher can see your body but not your ground. Stay in view and it will send a wisp.",
  wisp: `A wisp is hunting the body you're in. Transfer to another vessel and it will hit the empty one instead — or aim at it and ${press('absorb')} to dispel it.`,
  low: "Energy is low. Absorb shards you can see, and keep out of the lit ground.",
  reach: "You're higher than the Warden's plinth. Aim at the Warden and absorb it.",
  plinth: `Place a vessel on the plinth (${KEY.vessel}), transfer into it (${KEY.transfer}), then ${press('leap')} to ascend.`,
  idle: `Stuck? Aim at flat ground: the marker turns green where you can act. To climb: stone (${KEY.stone}), vessel on top (${KEY.vessel}), transfer (${KEY.transfer}).`,
  hidden: "You can only use squares whose surface you can see. Get higher and you'll see more.",
};
let hintTimer=0;
function showHint(key){
  if(G.tut || !G.hintsOn || G.state!=='play' && G.state!=='title') return;
  if(key!=='idle' && G.hintsShown.has(key)) return;
  G.hintsShown.add(key);
  const el=$('hint'); el.innerHTML=`<span>TIP</span> ${HINTS[key]} <i>${KEY.hints} hides tips</i>`; el.style.opacity=1;
  clearTimeout(hintTimer); hintTimer=setTimeout(()=>el.style.opacity=0, 8000);
}

// ====================================================================
//  Training — a guided first level. Steps advance when you actually do the thing.
// ====================================================================
const TUT = [
  { text:`Look around: ${KEY.look}. Find a glowing green <b>shard</b>, put the crosshair on it and ${press('absorb')}${TOUCH?'':' (or left-click)'} to absorb it.`,
    done:(e,d)=>e==='absorb' && d.type==='shard' },
  { text:`Energy lets you build. Aim at flat ground where the square marker turns <b>green</b>, and ${press('stone')} to place a <b>stone</b> (costs 2).`,
    done:(e,d)=>e==='create' && d.type==='stone' },
  { text:`Aim at the <b>top of a stone</b> and ${press('vessel')} to place a <b>vessel</b> on it (costs 3). Vessels are bodies you can move into.`,
    done:(e,d)=>e==='create' && d.type==='vessel' && d.onStone },
  { text:`Aim at that vessel and ${press('transfer')}${TOUCH?'':' (or right-click)'} to <b>transfer</b> into it. You are higher now, so you can see more ground.`,
    done:e=>e==='transfer' },
  { text:`Your old body is still standing there. ${TOUCH?'Tap':'Press'} <b>${KEY.turn}</b> to turn around if you need to, then <b>absorb</b> it (${KEY.absorb}) to get its energy back (+3).`,
    done:(e,d)=>e==='absorb' && d.type==='vessel' },
  { text:'The <b>Warden</b> is awake. Ground it can see glows <b>amber</b>, and standing on it drains you. The compass at the top shows where it is; a blinking marker means it is about to turn. Keep climbing (stone, vessel, transfer) until you are <b>above its plinth</b>, then absorb it.',
    done:(e,d)=>e==='absorb' && d.type==='warden',
    enter(){ G.tut.awake=true; G.litDirty=true; for(const w of G.wardens) w.timer=2; toast('The Warden stirs…', 2500); } },
  { text:`Last step: place a vessel on the empty <b>plinth</b> (${KEY.vessel}), transfer into it (${KEY.transfer}), then ${press('leap')} to ascend.`,
    done:e=>e==='ascend' },
];
function renderTut(){
  const el=$('tut');
  if(!G.tut || G.tut.step>=TUT.length){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML=`<div class="h">TRAINING · STEP ${G.tut.step+1} OF ${TUT.length}</div>${TUT[G.tut.step].text}`;
}
function emit(e, d={}){
  G.idleT=0;
  if(!G.tut || G.tut.step>=TUT.length) return;
  if(TUT[G.tut.step].done(e, d)){
    G.tut.step++; SFX.ascendHint();
    const s=TUT[G.tut.step]; if(s && s.enter) s.enter();
    renderTut();
  }
}
function spawnShard(){
  for(let i=0;i<300;i++){ const t=Math.floor(Math.random()*N*N), T=G.tiles[t];
    if(T.flat && !T.stack.length && t!==G.player.tile){ addObj('shard', t, true); return; } }
}
function drainPlayer(){
  G.energy-=1; G.stats.drained++; SFX.drain(); pulse('vig', 0.9);
  if(G.energy<0){ G.energy=0; updateHUD(); return die('The Warden drained the last of your energy.'); }
  spawnShard(); updateHUD();
  showHint(G.energy<=3 && G.hintsShown.has('drained') ? 'low' : 'drained');
}
function degradeInView(w, eye){
  const cand=G.objects.filter(o=>{
    if(o===G.player || (o.type!=='vessel' && o.type!=='stone')) return false;
    const s=G.tiles[o.tile].stack; if(s[s.length-1]!==o) return false;
    const c=tileCenter(o.tile); if(!inCone(w,c.x,c.z)) return false;
    return seesSurface(eye, o.tile, supportY(o.tile, s.length-1), [w.tile]);
  });
  if(!cand.length) return;
  const o=cand[Math.floor(Math.random()*cand.length)], t=o.tile;
  killObj(o); addObj(o.type==='vessel'?'stone':'shard', t, true); spawnShard();
}
function updateWardens(dt){
  const pt=G.player.tile, pc=tileCenter(pt), psy=supportY(pt, stackIdx(G.player));
  let worst=0;
  for(const w of [...G.wardens]){
    if(G.tut && !G.tut.awake){ w.sees=0; w.soon=false; continue; }   // asleep during early training
    if(w.turnT<1){ w.turnT=Math.min(1, w.turnT+dt/0.9);
      w.heading=w.turnFrom+(w.turnTo-w.turnFrom)*smooth(w.turnT); w.mesh.rotation.y=w.heading;
      if(w.turnT>=1) G.litDirty=true; }
    const eye=wardenEye(w);
    let sees=0;
    if(inCone(w, pc.x, pc.z)){
      if(seesSurface(eye, pt, psy, [w.tile])) sees=2;
      else if(los(eye, new V3(pc.x, psy+0.5, pc.z), [w.tile, pt])) sees=1;
    }
    w.sees=sees;
    if(sees===2){ w.drainT-=dt; if(w.drainT<=0){ w.drainT=G.params.drainInterval; drainPlayer(); if(G.state!=='play') return; } }
    else w.drainT=G.params.firstDrain;
    w.holdT = sees===1 ? w.holdT+dt : 0;
    if(sees===1){
      w.glimpseT+=dt;
      if(w.glimpseT>=G.params.glimpse && G.wisps.length<2 && !G.wisps.some(x=>x.target===G.player)){ spawnWisp(w); w.glimpseT=-6; }
    } else if(w.glimpseT>0) w.glimpseT=0;
    else w.glimpseT=Math.min(0, w.glimpseT+dt);
    w.soon=false;
    if(sees===0 || (sees===1 && w.holdT>4)){
      const before=w.timer; w.timer-=dt;
      if(w.turnT>=1 && w.timer<=WARN){ w.soon=true; if(before>WARN) SFX.warn(w.type==='warden'); }
      if(w.timer<=0 && w.turnT>=1){ w.turnFrom=w.heading; w.turnTo=w.heading+w.dir*TURN; w.turnT=0;
        w.timer=w.rotInterval; SFX.turn(w.type==='warden'); G.litDirty=true; }
    }
    w.objT-=dt; if(w.objT<=0){ w.objT=G.params.objInterval; degradeInView(w, eye); }
    worst=Math.max(worst, sees);
    const base = w.type==='sentry' ? 0xff7a6b : 0xffc36b;
    w.eye.material.color.set(sees===2?0xff3030: sees===1?0xffe080: base);
    w.cone.material.uniforms.op.value = sees===2?0.2: sees===1?0.14:0.09;
  }
  if(worst!==G.seen){ G.seen=worst; updateGaze(); if(worst===1) showHint('glimpsed'); }
}

// ====================================================================
//  Game flow
// ====================================================================
const BEST_KEY='highground.best';
const best=()=>+localStorage.getItem(BEST_KEY)||1;
const HINT_KEY='highground.hints', TRAINED_KEY='highground.trained';
G.hintsOn = localStorage.getItem(HINT_KEY)!=='0';

// ---- Level codes: every level has a fixed 6-character code, so any level can be revisited or shared.
const CODE_CHARS='BCDFGHJKLMNPQRSTVWXZ23456789', MAX_LEVEL=999;
function levelCode(lv){ const r=mulberry32(lv*7919+0x5eed); let s='';
  for(let i=0;i<6;i++) s+=CODE_CHARS[Math.floor(r()*CODE_CHARS.length)]; return s; }
function levelFromCode(c){ c=(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(c.length!==6) return 0;
  for(let lv=1;lv<=MAX_LEVEL;lv++) if(levelCode(lv)===c) return lv; return 0; }

// ---- Leaping ahead: spare energy buys skipped levels, but you never start a level below 10.
const SKIP_COST=6, START_MIN=10, MAX_SKIP=3;
const fmtTime=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const timeKey=lv=>'highground.time.'+lv;
// ---- Mid-level saves. The terrain regenerates from the level's seed, so a save only needs what sits on it.
const SAVE_KEY='highground.save', SAVE_VERSION=1;
function snapshot(){
  return { v:SAVE_VERSION, level:G.level, energy:G.energy, startEnergy:G.startEnergy, yaw:G.yaw, pitch:G.pitch,
    wardenGone:G.wardenGone, tut:G.tut, stats:G.stats, hints:[...G.hintsShown], savedAt:Date.now(),
    stacks: G.tiles.map((T,i)=>T.stack.length ? [i, T.stack.map(o=>o.type)] : null).filter(Boolean),
    player: [G.player.tile, stackIdx(G.player)],
    wardens: G.wardens.map(w=>({ tile:w.tile, heading:w.turnT<1?w.turnTo:w.heading, timer:w.timer, dir:w.dir,
      rot:w.rotInterval, objT:w.objT })),
    wisps: G.wisps.map(wi=>({ p:wi.mesh.position.toArray(), target:[wi.target.tile, stackIdx(wi.target)] })) };
}
function saveGame(){
  if((G.state!=='play' && G.state!=='paused') || !G.player) return;
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){}
}
function clearSave(){ localStorage.removeItem(SAVE_KEY); }
function readSave(){ try{ const s=JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v===SAVE_VERSION ? s : null; }catch(e){ return null; } }
function restore(s){
  loadLevel(s.level, s.energy);
  for(const o of G.objects) objGroup.remove(o.mesh);              // drop the freshly generated objects…
  G.objects=[]; G.wardens=[]; G.tiles.forEach(T=>T.stack=[]); anims.length=0;
  for(const [t, types] of s.stacks) for(const ty of types) addObj(ty, t);   // …and rebuild the saved ones
  G.player=G.tiles[s.player[0]].stack[s.player[1]]; G.player.mesh.visible=false;
  G.mainWarden=null;
  for(const d of s.wardens){
    const w=G.tiles[d.tile].stack.find(o=>o.type==='warden'||o.type==='sentry'); if(!w) continue;
    Object.assign(w, { heading:d.heading, timer:d.timer, dir:d.dir, rotInterval:d.rot, objT:d.objT,
      turnT:1, drainT:G.params.firstDrain, holdT:0, glimpseT:0, sees:0 });
    w.mesh.rotation.y=w.heading; G.wardens.push(w); if(w.type==='warden') G.mainWarden=w;
  }
  Object.assign(G, { energy:s.energy, startEnergy:s.startEnergy, yaw:s.yaw, pitch:s.pitch, wardenGone:s.wardenGone,
    tut:s.tut, stats:s.stats, hintsShown:new Set(s.hints) });
  for(const d of s.wisps){ const tg=G.tiles[d.target[0]].stack[d.target[1]];
    if(tg && tg.type==='vessel') makeWisp(new V3().fromArray(d.p), tg); }
  buildCompass(); renderTut(); G.litDirty=true; updateHUD(true);
  toast(`Resumed ${G.level===0?'training':'level '+G.level}`, 2000);
}
setInterval(saveGame, 3000);
addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ if(G.state==='play' && TOUCH) pauseGame(); saveGame(); } });

function statsHTML(){
  const s=G.stats;
  return `<table class="stats">
    <tr><td>Energy</td><td>${G.startEnergy} → <b>${G.energy}</b></td><td>Absorbed</td><td>+${s.absorbed}</td></tr>
    <tr><td>Built</td><td>${s.built}</td><td>Transfers</td><td>${s.transfers}${s.leaps?` · ${s.leaps} leap${s.leaps>1?'s':''}`:''}</td></tr>
    <tr><td>Drained</td><td>${s.drained?'−'+s.drained:'never'}</td><td>Wisps</td><td>${s.wispsSent?`${s.wispsEscaped} escaped · ${s.wispHits} hit`:'none'}</td></tr>
  </table>`;
}
function ascend(){
  emit('ascend');
  G.state='ascend'; SFX.ascend(); SFX.setTension(0); document.exitPointerLock?.(); renderTut(); clearSave();
  if(G.level===0){
    localStorage.setItem(TRAINED_KEY, '1');
    return showPanel(`<h1>TRAINED</h1><p class="tag">TRAINING COMPLETE</p>
      <p>That's the whole loop: absorb, build, transfer, climb, and keep off the lit ground.
      From level 2, red <b>sentries</b> watch too. Stay glimpsed too long and a <b>wisp</b> comes for you:
      transfer away or dispel it (A).</p><button data-act="go" data-lv="1" data-en="10">BEGIN LEVEL 1</button>`);
  }
  const lv=G.level, t=G.stats.time, prev=+localStorage.getItem(timeKey(lv))||0, record=!prev||t<prev;
  if(record) localStorage.setItem(timeKey(lv), t.toFixed(1));
  const E=Math.max(START_MIN, G.energy);
  const opts=[`<button data-act="go" data-lv="${lv+1}" data-en="${E}">LEVEL ${lv+1} · ${E} ENERGY</button>`];
  for(let k=1;k<=MAX_SKIP && lv+1+k<=MAX_LEVEL;k++){
    const left=G.energy-SKIP_COST*k; if(left<START_MIN) break;
    opts.push(`<button class="alt" data-act="go" data-lv="${lv+1+k}" data-en="${left}">LEAP TO ${lv+1+k} · ${left} ENERGY</button>`);
  }
  if(lv+1>best()) localStorage.setItem(BEST_KEY, lv+1);
  showPanel(`<h1>ASCENDED</h1><p class="tag">LEVEL ${lv} CLEARED</p>
    <p class="time">${fmtTime(t)} ${record ? (prev?`<span class="rec">NEW BEST</span> <small>was ${fmtTime(prev)}</small>`:'<span class="rec">FIRST CLEAR</span>')
      : `<small>best ${fmtTime(prev)}</small>`}</p>
    ${statsHTML()}
    <p class="small">${opts.length>1 ? `Spare energy can carry you past levels: ${SKIP_COST} energy per level skipped.`
      : `With ${SKIP_COST*1+START_MIN}+ energy left you could leap past levels.`}</p>
    ${opts.join('')}
    <p class="code">LEVEL CODES · ${lv+1}: <b>${levelCode(lv+1)}</b>${opts.length>1?` · ${lv+1+opts.length-1}: <b>${levelCode(lv+opts.length)}</b>`:''}</p>`);
}
// Death plays out first: colour drains, the view sinks into the ground, then the panel appears.
function die(reason){
  if(G.state==='dying' || G.state==='dead') return;
  G.state='dying'; G.dieT=0; G.dieReason=reason; G.swoop=null;
  SFX.death(); SFX.setTension(0); document.exitPointerLock?.(); pulse('vig', 1, 2.2); clearSave();
}
function deathPanel(){
  G.state='dead'; const reason=G.dieReason;
  const tr=G.level===0;
  showPanel(`<h1>ABSORBED</h1><p class="tag">${tr?'TRAINING':'LEVEL '+G.level} · ${fmtTime(G.stats.time)}</p><p>${reason}</p>
    ${tr?'':statsHTML()}
    <button data-act="retry">RETRY ${tr?'TRAINING':'LEVEL'}</button><button class="alt" data-act="restart">START OVER</button>
    ${tr?'':`<p class="code">LEVEL CODE · ${G.level}: <b>${levelCode(G.level)}</b></p>`}`);
}
function titlePanel(){
  const b=best(), trained=localStorage.getItem(TRAINED_KEY)==='1', save=readSave();
  const rules=`<ul>
    <li>From the highest peak, a <b>Warden</b> sweeps its beam across the land. If it can see the
        <i>ground you stand on</i>, it drains your energy. Ground it can see glows amber (red for sentries).</li>
    <li>The compass at the top shows every watcher around you. A filled marker means you're in its gaze;
        a blinking one is about to turn — listen for the chime.</li>
    <li>You can't walk. You only act on squares whose surface you can see — so height is everything.</li>
    <li><b>Absorb</b> shards (+1), stones (+2) and vessels (+3). <b>Spend</b> energy to place stones (2) and vessels (3).
        Stack stones, put a vessel on top, <b>transfer</b> into it, then absorb the body you left behind.</li>
    <li>Get above the Warden's plinth, absorb it (+4), place a vessel on the plinth, transfer, and ${press('leap')}
        to ascend. Anywhere else, ${KEY.leap} is a desperate random leap (costs 3).</li>
    <li>A watcher that sees your body but not your ground has only <b>glimpsed</b> you — but linger and it sends a
        <b>wisp</b> after you. Transfer to another body so it strikes the empty one, or aim at it and dispel it (${KEY.absorb}).</li>
  </ul>`;
  const keysLine=`<p class="keys">${TOUCH
    ? 'Drag anywhere to look · the buttons on the right act on whatever is under the crosshair · ❚❚ pauses · best played in landscape'
    : 'Mouse: look (click to capture) · LMB/A absorb · RMB/F transfer · Q stone · E vessel · Space leap/ascend · R turn around · H tips · Esc pause'}</p>`;
  const actions=`${save ? `<button data-act="load">RESUME ${save.level===0?'TRAINING':'LEVEL '+save.level} · ${save.energy} ENERGY</button>` : ''}
  ${trained
    ? `<button ${save?'class="alt"':''} data-act="start">BEGIN AT LEVEL 1</button>${b>1?`<button class="alt" data-act="continue">CONTINUE AT LEVEL ${b}</button>`:''}<button class="alt" data-act="train">TRAINING</button>`
    : `<button ${save?'class="alt"':''} data-act="train">START TRAINING</button><button class="alt" data-act="start">SKIP TO LEVEL 1</button>`}
  <div class="codein"><input id="codeIn" maxlength="8" placeholder="LEVEL CODE" autocomplete="off" spellcheck="false">
    <button class="alt" data-act="code">GO</button><span id="codeMsg"></span></div>`;
  // On small screens the buttons come first, so nobody has to scroll past the rules to start.
  const small=innerHeight<560 || innerWidth<700;
  showPanel(`<h1>HIGHGROUND</h1><p class="tag">ABSORB · BUILD · CLIMB · STAY UNSEEN</p>` +
    (small ? `<div class="actions">${actions}</div>${rules}${keysLine}` : rules+keysLine+actions));
  $('codeIn').addEventListener('keydown', e=>{ if(e.key==='Enter') $('panel').querySelector('[data-act=code]').click(); });
}
function showPanel(html){ document.getElementById('panel').innerHTML=html; document.getElementById('overlay').classList.add('show'); }
function hidePanel(){ document.getElementById('overlay').classList.remove('show'); }
function play(){ hidePanel(); G.state='play'; if(!TOUCH) lockPointer(); }
function pauseGame(){
  if(G.state!=='play') return;
  G.state='paused'; SFX.setTension(0); saveGame();
  showPanel(`<h1>PAUSED</h1><p class="tag">${G.tut?'TRAINING':'LEVEL '+G.level}</p><button data-act="resume">RESUME</button>
    <button class="alt" data-act="retry">RESTART ${G.tut?'TRAINING':'LEVEL'}</button>${G.tut
      ? '<button class="alt" data-act="start">SKIP TO LEVEL 1</button>'
      : '<button class="alt" data-act="restart">START OVER</button>'}
    <button class="alt" data-act="title">TITLE SCREEN</button>
    ${G.tut?'':`<p class="code">${fmtTime(G.stats.time)} on this level · LEVEL CODE: <b>${levelCode(G.level)}</b></p>`}
    <p class="small">Your progress on this level is saved automatically.</p>`);
}
document.getElementById('overlay').addEventListener('click', e=>{
  const ds=e.target.dataset||{}, act=ds.act; if(!act) return;
  SFX.init();
  if(act==='title'){ saveGame(); G.state='title'; titlePanel(); return; }
  if(act==='load'){ const s=readSave(); if(s){ restore(s); play(); } else titlePanel(); return; }
  if(act!=='resume') clearSave();        // starting anything new replaces the old save
  if(act==='code'){
    const lv=levelFromCode($('codeIn').value);
    if(!lv){ $('codeMsg').textContent='Unknown code'; return; }
    loadLevel(lv, START_MIN);
  }
  else if(act==='start') loadLevel(1,10);
  else if(act==='train') loadLevel(0,20);
  else if(act==='continue') loadLevel(best(),10);
  else if(act==='go'){ if(+ds.lv>best()) localStorage.setItem(BEST_KEY, ds.lv); loadLevel(+ds.lv, +ds.en); }
  else if(act==='retry') loadLevel(G.level, G.startEnergy);
  else if(act==='restart') loadLevel(1,10);
  play();
});

// ====================================================================
//  Input
// ====================================================================
const canvas=renderer.domElement;
const locked=()=>document.pointerLockElement===canvas;
function lockPointer(){ try{ const p=canvas.requestPointerLock(); if(p&&p.catch) p.catch(()=>{}); }catch(e){} }
document.addEventListener('pointerlockchange', ()=>{ if(!locked()) pauseGame(); });

// Every control (keys, mouse, touch buttons) funnels through here. Nothing acts mid-swoop.
function action(a){
  if(G.state!=='play') return;
  if(a==='pause') return TOUCH ? pauseGame() : document.exitPointerLock?.();
  if(a==='hints'){ G.hintsOn=!G.hintsOn; localStorage.setItem(HINT_KEY, G.hintsOn?'1':'0');
    $('hint').style.opacity=0; return toast(G.hintsOn?'Tips on':'Tips off', 1200); }
  if(G.swoop) return;
  switch(a){
    case 'absorb': doAbsorb(); break;
    case 'stone': doCreate('stone'); break;
    case 'vessel': doCreate('vessel'); break;
    case 'transfer': doTransfer(); break;
    case 'leap': doLeap(); break;
    case 'turn': if(!G.spin) G.spin=Math.PI; break;
  }
}
function look(dx, dy, sens){
  if(G.state!=='play' || G.swoop) return;
  G.yaw-=dx*sens; G.pitch=Math.max(-1.45, Math.min(1.3, G.pitch-dy*sens));
}

// Browsers refuse to re-capture the mouse for about a second after Esc; say so instead of failing silently.
document.addEventListener('pointerlockerror', ()=>{ if(G.state==='play') toast('Click the view to capture the mouse (or drag to look)', 2500); });
let drag=null;
canvas.addEventListener('contextmenu', e=>e.preventDefault());
canvas.addEventListener('mousedown', e=>{
  if(G.state!=='play' || TOUCH) return;
  if(!locked()){ if(e.button===0) drag={x:e.clientX,y:e.clientY,moved:false}; if(e.button===2) action('transfer'); return; }
  if(e.button===0) action('absorb'); else if(e.button===2) action('transfer');
});
addEventListener('mouseup', e=>{
  if(drag && e.button===0){ if(!drag.moved){ lockPointer(); } drag=null; }
});
addEventListener('mousemove', e=>{
  if(G.state!=='play' || TOUCH) return;
  if(locked()) look(e.movementX, e.movementY, 0.0022);
  else if(drag){ const mx=e.clientX-drag.x, my=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
    if(mx||my) drag.moved=true; look(mx, my, 0.0022); }
});
const KEYMAP={ KeyA:'absorb', KeyQ:'stone', Digit1:'stone', KeyE:'vessel', Digit2:'vessel', KeyF:'transfer', KeyT:'transfer',
  Space:'leap', KeyR:'turn', KeyP:'pause', KeyH:'hints' };
const keys=new Set();
addEventListener('keydown', e=>{
  keys.add(e.code);
  if(G.state!=='play' || e.repeat || !KEYMAP[e.code]) return;
  if(e.code==='Space') e.preventDefault();
  action(KEYMAP[e.code]);
});

// ---- Touch: one finger drags the view; the on-screen buttons act on whatever is under the crosshair.
let lookTouch=null;
canvas.addEventListener('touchstart', e=>e.preventDefault(), { passive:false });   // no scroll/zoom/compat mouse
canvas.addEventListener('pointerdown', e=>{
  if(e.pointerType!=='touch' || lookTouch) return;
  lookTouch={ id:e.pointerId, x:e.clientX, y:e.clientY };
});
addEventListener('pointermove', e=>{
  if(!lookTouch || e.pointerId!==lookTouch.id) return;
  look(e.clientX-lookTouch.x, e.clientY-lookTouch.y, 0.0048);
  lookTouch.x=e.clientX; lookTouch.y=e.clientY;
});
const endTouch=e=>{ if(lookTouch && e.pointerId===lookTouch.id) lookTouch=null; };
addEventListener('pointerup', endTouch); addEventListener('pointercancel', endTouch);
document.querySelectorAll('#touch [data-a]').forEach(b=>{
  b.addEventListener('pointerdown', e=>{ e.preventDefault(); e.stopPropagation(); b.classList.add('on'); action(b.dataset.a); });
  for(const ev of ['pointerup','pointercancel','pointerleave']) b.addEventListener(ev, ()=>b.classList.remove('on'));
  b.addEventListener('contextmenu', e=>e.preventDefault());
});
addEventListener('keyup', e=>keys.delete(e.code));
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ====================================================================
//  HUD
// ====================================================================
const $=id=>document.getElementById(id);
let lastE=-1;
function updateHUD(force){
  $('lvl').textContent=G.level===0 ? 'TRAINING' : `LEVEL ${G.level}`;
  if(G.energy!==lastE || force){ lastE=G.energy;
    $('energy').innerHTML=`${G.energy}<small>ENERGY</small>`;
    $('pips').innerHTML='<i></i>'.repeat(Math.min(G.energy, 60)); }
  $('wstat').textContent = G.wardenGone ? 'Warden absorbed — claim its plinth and ascend'
    : `Warden on watch${G.wardens.length>1?` · ${G.wardens.length-1} sentr${G.wardens.length===2?'y':'ies'}`:''}`;
  $('wstat').style.color = G.wardenGone ? 'var(--ok)' : '';
  if(G.tut && !G.tut.awake) $('wstat').textContent='The Warden sleeps — for now';
  const hunting=(G.wisps||[]).filter(w=>w.target===G.player).length;
  $('wisps').textContent = hunting ? 'A WISP IS HUNTING YOU' : (G.wisps||[]).length ? 'A wisp is chasing an empty body' : '';
  updateGaze();
}
function updateGaze(){ const g=$('gaze'); g.className='s'+G.seen;
  g.querySelector('.lbl').textContent=['UNSEEN','GLIMPSED','DRAINING'][G.seen]; }
// Compass strip: the whole 360° around you, forward at the centre, behind you at both edges.
// One marker per watcher; it glows when you're inside its gaze and blinks just before it turns.
function buildCompass(){
  const el=$('compass'); el.querySelectorAll('.m:not(.wisp)').forEach(m=>m.remove());
  for(const w of G.wardens){ const m=document.createElement('div'); m.className='m '+w.type; el.append(m); w.marker=m; }
  if(G.wardenGone || !G.wardens.some(w=>w.type==='warden')){
    const m=document.createElement('div'); m.className='m plinth'; el.append(m); G.plinthMarker=m;
  } else G.plinthMarker=null;
}
function bearingX(x, z){
  const e=playerEye(), fwd=Math.atan2(-Math.sin(G.yaw), -Math.cos(G.yaw));
  let rel=Math.atan2(x-e.x, z-e.z)-fwd; rel=Math.atan2(Math.sin(rel),Math.cos(rel));
  return 50 - rel/Math.PI*50;                     // +rel is to your left
}
function updateCompass(){
  const pc=tileCenter(G.player.tile);
  for(const w of G.wardens){ if(!w.marker) continue;
    w.marker.style.left=bearingX(w.mesh.position.x, w.mesh.position.z)+'%';
    w.marker.classList.toggle('gaze', inCone(w, pc.x, pc.z));
    w.marker.classList.toggle('seen', w.sees>0);
    w.marker.classList.toggle('soon', !!w.soon); }
  for(const wi of G.wisps){ wi.marker.style.left=bearingX(wi.mesh.position.x, wi.mesh.position.z)+'%';
    wi.marker.classList.toggle('hunt', wi.target===G.player); }
  if(G.plinthMarker){ const p=G.tiles.findIndex(T=>T.stack[0]&&T.stack[0].type==='plinth');
    if(p>=0){ const c=tileCenter(p); G.plinthMarker.style.left=bearingX(c.x,c.z)+'%'; } }
}
let lastInfo='';
function setInfo(h){ if(h!==lastInfo){ lastInfo=h; $('info').innerHTML=h; } }
let toastTimer=0;
function toast(msg, ms=2000){ const el=$('toast'); el.textContent=msg; el.style.opacity=1;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.style.opacity=0, ms); }
const pulses={};
function pulse(id, amt, dur=0.6){ pulses[id]={ v:amt, dur }; }
function flash(){ pulse('flash', 0.85, 0.5); }

// ====================================================================
//  Audio (synthesised)
// ====================================================================
const SFX={ ctx:null, out:null,
  init(){ if(this.ctx) return; const C=window.AudioContext||window.webkitAudioContext; if(!C) return;
    this.ctx=new C(); this.out=this.ctx.createGain(); this.out.gain.value=0.5; this.out.connect(this.ctx.destination);
    const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=240;
    const g=this.ctx.createGain(); g.gain.value=0.05; lp.connect(g); g.connect(this.out);
    for(const f of [55, 55.6, 82.5]){ const o=this.ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.connect(lp); o.start(); }
    // Tension layer, silent until you're watched: a pulsing low throb plus a close, uneasy high interval.
    const c=this.ctx; this.tens=c.createGain(); this.tens.gain.value=0; this.tens.connect(this.out);
    const throb=c.createOscillator(); throb.type='sawtooth'; throb.frequency.value=73.4;
    const tlp=c.createBiquadFilter(); tlp.type='lowpass'; tlp.frequency.value=380;
    const pulseG=c.createGain(); pulseG.gain.value=0.5;
    this.lfo=c.createOscillator(); this.lfo.frequency.value=2; const lfoG=c.createGain(); lfoG.gain.value=0.5;
    this.lfo.connect(lfoG); lfoG.connect(pulseG.gain);
    throb.connect(tlp); tlp.connect(pulseG); pulseG.connect(this.tens);
    const hiG=c.createGain(); hiG.gain.value=0.07; hiG.connect(this.tens);
    for(const f of [987.8, 1046.5]){ const o=c.createOscillator(); o.frequency.value=f; o.connect(hiG); o.start(); }
    throb.start(); this.lfo.start(); this.tensLevel=0; },
  setTension(x){
    if(!this.ctx || Math.abs(x-this.tensLevel)<0.02) return; this.tensLevel=x;
    const t=this.ctx.currentTime; this.tens.gain.setTargetAtTime(x*0.3, t, x>0.1?0.25:0.8);
    this.lfo.frequency.setTargetAtTime(1.6+x*4.5, t, 0.5); },
  tone(f0,f1,dur,type='sine',vol=0.2,delay=0){ if(!this.ctx) return; const c=this.ctx, t=c.currentTime+delay;
    const o=c.createOscillator(), g=c.createGain(); o.type=type;
    o.frequency.setValueAtTime(f0,t); o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.015); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t+dur+0.05); },
  noise(dur,vol,f0,f1){ if(!this.ctx) return; const c=this.ctx, t=c.currentTime;
    const b=c.createBuffer(1, c.sampleRate*dur, c.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const s=c.createBufferSource(); s.buffer=b; const f=c.createBiquadFilter(); f.type='bandpass'; f.Q.value=3;
    f.frequency.setValueAtTime(f0,t); f.frequency.exponentialRampToValueAtTime(f1,t+dur);
    const g=c.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); },
  absorb(){ this.tone(720,160,0.35,'triangle',0.22); },
  create(type){ this.tone(type==='vessel'?260:180, type==='vessel'?780:420, 0.25,'triangle',0.2); },
  transfer(){ this.noise(0.5,0.35,300,3000); this.tone(300,1200,0.4,'sine',0.15); },
  drain(){ this.tone(120,60,0.55,'sawtooth',0.18); },
  turn(main){ this.tone(main?90:140, main?70:110, 0.18,'square', main?0.035:0.02); },
  wisp(){ this.tone(900,1500,0.5,'sine',0.12); this.tone(1350,2100,0.5,'sine',0.06,0.08); },
  chirp(dist){ const f=Math.max(500, 1700-dist*70); this.tone(f, f*1.15, 0.06,'sine', Math.max(0.03, 0.12-dist*0.006)); },
  strike(){ this.noise(0.6,0.4,2500,200); this.tone(600,90,0.5,'triangle',0.2); },
  warn(main){ [0,0.18].forEach(d=>this.tone(main?1320:1760, main?1240:1660, 0.07,'sine', main?0.07:0.05, d)); },
  death(){ this.tone(300,30,1.6,'sawtooth',0.25); },
  ascend(){ [0,4,7,12].forEach((n,i)=>this.tone(330*2**(n/12),330*2**(n/12),0.5,'triangle',0.18,i*0.12)); },
  ascendHint(){ [0,7].forEach((n,i)=>this.tone(440*2**(n/12),440*2**(n/12),0.4,'sine',0.15,i*0.15)); },
};

// ====================================================================
//  Main loop
// ====================================================================
// Dust motes drifting through a box that follows the camera (wrapped, so there are always some nearby).
const DUST_N=420, DUST_BOX=14;
const dustOff=new Float32Array(DUST_N*3).map(()=>Math.random()*DUST_BOX);
const dustGeo=new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N*3),3));
const dust=new THREE.Points(dustGeo, new THREE.PointsMaterial({ color:0xffe2c4, size:0.045, transparent:true, opacity:0.55, depthWrite:false }));
dust.frustumCulled=false; scene.add(dust);
function updateDust(t){
  const p=dustGeo.attributes.position.array, c=camera.position, h=DUST_BOX/2;
  const wrap=v=>((v%DUST_BOX)+DUST_BOX)%DUST_BOX - h;
  for(let i=0;i<DUST_N;i++){ const o=i*3, ph=i*1.7;
    p[o]  =c.x+wrap(dustOff[o]  -c.x + t*0.25 + Math.sin(t*0.3+ph)*0.4);
    p[o+1]=c.y+wrap(dustOff[o+1]-c.y + Math.sin(t*0.2+ph)*0.6 - t*0.04);
    p[o+2]=c.z+wrap(dustOff[o+2]-c.z + t*0.1 + Math.cos(t*0.25+ph)*0.4); }
  dustGeo.attributes.position.needsUpdate=true;
}
const lerpAngle=(a,b,k)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*k;
const easeInOut=k=>k<0.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
function tension(){
  if(G.state!=='play') return 0;
  const hunted=G.wisps.some(w=>w.target===G.player);
  return Math.max(G.seen===2?1:G.seen===1?0.5:0, hunted?0.8:0);
}

let last=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(G.player){
    if(G.state==='play'){
      const k=1.6*dt;
      if(keys.has('ArrowLeft')) G.yaw+=k; if(keys.has('ArrowRight')) G.yaw-=k;
      if(keys.has('ArrowUp')) G.pitch=Math.min(1.3,G.pitch+k); if(keys.has('ArrowDown')) G.pitch=Math.max(-1.45,G.pitch-k);
      if(G.spin){ const s=Math.min(G.spin, dt*Math.PI/0.28); G.yaw+=s; G.spin-=s; }   // quick 180°
    }
    if(G.litDirty) updateLit();
    const eye=playerEye();
    if(G.swoop){                                   // transfer: fly from the old eye to the new one
      const s=G.swoop; s.t=Math.min(1, s.t+dt/s.dur); const k=easeInOut(s.t);
      camera.position.lerpVectors(s.from, eye, k); camera.position.y+=Math.sin(Math.PI*k)*s.arc;
      camera.rotation.set(s.fromPitch+(G.pitch-s.fromPitch)*k, lerpAngle(s.fromYaw, G.yaw, k), 0);
      if(s.t>=1) G.swoop=null;
    } else { camera.position.copy(eye); camera.rotation.set(G.pitch, G.yaw, 0); }
    if(G.state==='dying'){                          // colour drains, the view sinks and tips forward
      G.dieT+=dt; const k=Math.min(1, G.dieT/1.8);
      canvas.style.filter=`grayscale(${k}) brightness(${1-0.6*k})`;
      camera.position.y-=k*k*0.9; camera.rotation.x=G.pitch-k*k*0.6; camera.rotation.z=k*0.25;
      if(G.dieT>=2.0) deathPanel();
    }
    sky.position.copy(camera.position);
    updateDust(now/1000);
    SFX.setTension(tension());
    if(G.state==='play'){
      scene.updateMatrixWorld();        // sight checks must see objects placed since the last render
      G.stats.time+=dt;
      updateWardens(dt);
      if(G.state==='play') updateWisps(dt);
      if(G.state==='play'){ if(!G.swoop) evaluate(); updateCompass();
        G.idleT+=dt; if(G.idleT>35){ G.idleT=0; showHint('idle'); } }
    }
    for(const wi of G.wisps) if(G.state!=='play') wi.mesh.getObjectByName('halo').scale.setScalar(1);
    for(const o of G.objects){
      if(o.type==='shard'){ const c=o.mesh.getObjectByName('spin'); c.rotation.y+=dt*0.8; c.position.y=0.4+Math.sin(now/600+o.tile)*0.03; }
      else if(o.type==='warden'||o.type==='sentry'){ const r=o.mesh.getObjectByName('ring'); r.rotation.z+=dt*0.6; }
    }
  } else { camera.position.set(N/2, 12, N+14); camera.lookAt(N/2, 2, N/2); }
  for(let i=anims.length-1;i>=0;i--){ const a=anims[i]; a.t=Math.min(1,a.t+dt/a.dur);
    if(a.kind==='in'){ const k=a.t, b=1+2.2*(k-1)**3+1.2*(k-1)**2; a.mesh.scale.setScalar(Math.max(0.01,b)*a.s); }
    else { a.mesh.scale.setScalar(Math.max(0.001,(1-a.t))*a.s); a.mesh.position.y+=dt*0.8; if(a.t>=1) fxGroup.remove(a.mesh); }
    if(a.t>=1) anims.splice(i,1); }
  for(const id in pulses){ const p=pulses[id]; p.v=Math.max(0,p.v-dt/p.dur); $(id).style.opacity=p.v; if(!p.v) delete pulses[id]; }
  renderer.render(scene, camera);
}
// show a preview landscape behind the title screen
loadLevel(best(), 10); $('toast').style.opacity=0;
G.state='title'; titlePanel();
requestAnimationFrame(frame);
