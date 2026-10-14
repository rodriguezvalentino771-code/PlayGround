import * as THREE from 'three';

/* ============================================================
   MUÑECO PLAYTIME Ch.1 — Fan port navegador (todo procedural)
   FPS horror-puzzle: lobby -> giftshop (GarraPack) -> seguridad
   -> sala energía -> sala máquinas -> conducto -> persecución
   ============================================================ */
const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas'), hud = $('hud');
const objText = $('objective-text'), objSub = $('objective-sub');
const tip = $('interact-tip'), toast = $('toast'), subtitle = $('subtitle');
const crosshair = $('crosshair');

const QUALITY = { mode: 'high' };
$('quality').addEventListener('change', e => { QUALITY.mode = e.target.value; applyQuality(); });

let renderer, scene, camera, flashlight, flashTarget;
let clock;
const colliders = [];       // {x1,x2,z1,z2}
const grappleTargets = [];  // meshes raycasteables
const interactables = [];   // {pos:Vector3,radius,prompt,enabled,action,hint}
const doors = {};
const state = {
  running:false, paused:false, dead:false, won:false,
  stage:0, hasPack:false, parts:0, partsNeeded:2,
  power:false, powerCharge:0, machineOn:false,
  tapes:0, startTime:0, elapsed:0, muted:false,
  chase:false, chaseStart:0, ventCrawl:false,
  lowPowerFlicker:0, subtitleTimer:0, toastTimer:0,
};
const player = {
  pos:new THREE.Vector3(0,1.7,5), vel:new THREE.Vector3(),
  yaw:0, pitch:0, radius:0.45, height:1.7,
  walk:4.2, sprint:7.0, stamina:1, crouch:false,
  keys:{}, locked:false,
};
const hands = {
  blue:{color:0x29b6ff, state:'idle', mesh:null, line:null, tip:new THREE.Vector3(), target:null, dist:0, side:-1, cooldown:0},
  red:{color:0xff3b5c, state:'idle', mesh:null, line:null, tip:new THREE.Vector3(), target:null, dist:0, side:1, cooldown:0},
};
let monster=null, monsterState='dormant';
let pylons={}, machineLeverMesh, exitLeverMesh, grabPackTable;
let audio=null;

/* ---------------- AUDIO (todo sintetizado) ---------------- */
function initAudio(){
  if(audio) return;
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  audio={ctx, master:ctx.createGain()};
  audio.master.gain.value=0.5; audio.master.connect(ctx.destination);
}
function tone(freq,dur,type='sine',vol=0.25,slide=0){
  if(!audio||state.muted) return;
  const {ctx,master}=audio, t=ctx.currentTime;
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,t);
  if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),t+dur);
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.02);
}
function noiseBurst(dur=0.3,vol=0.3){
  if(!audio||state.muted) return;
  const {ctx,master}=audio, t=ctx.currentTime;
  const buf=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
  const s=ctx.createBufferSource(); s.buffer=buf;
  const g=ctx.createGain(); g.gain.value=vol;
  const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}
const sfx={
  shoot(){tone(700,0.15,'square',0.15,-400);noiseBurst(0.1,0.1);},
  stick(){tone(220,0.12,'square',0.2);},
  retract(){tone(300,0.2,'sawtooth',0.12,300);},
  pickup(){tone(520,0.1,'sine',0.25);setTimeout(()=>tone(780,0.15,'sine',0.25),90);},
  door(){noiseBurst(0.7,0.35);tone(90,0.7,'sawtooth',0.2,-40);},
  denied(){tone(160,0.25,'square',0.2);},
  zap(){tone(1200,0.25,'sawtooth',0.12,-800);},
  lever(){tone(180,0.2,'square',0.25,-80);setTimeout(()=>tone(420,0.25,'square',0.2),150);},
  step(){noiseBurst(0.06,0.05);},
  tape(){tone(880,0.08,'sine',0.2);setTimeout(()=>tone(660,0.08,'sine',0.2),100);setTimeout(()=>tone(990,0.12,'sine',0.2),200);},
  roar(){tone(70,1.4,'sawtooth',0.5,60);noiseBurst(1.2,0.4);setTimeout(()=>tone(55,1.2,'square',0.4),200);},
  sting(){tone(2000,0.5,'sawtooth',0.4,-1800);noiseBurst(0.8,0.5);},
  win(){[523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,0.3,'triangle',0.3),i*160));},
  hum(){tone(50,0.5,'sine',0.08);},
};
setInterval(()=>{ if(state.running&&!state.paused&&state.chase&&!state.muted) { tone(60+Math.random()*30,0.25,'square',0.18); setTimeout(()=>tone(90,0.2,'square',0.15),180);} }, 420);

/* ---------------- THREE SETUP ---------------- */
function applyQuality(){
  if(!renderer) return;
  const low = QUALITY.mode==='low';
  renderer.setPixelRatio(low?Math.min(devicePixelRatio,1):Math.min(devicePixelRatio,2));
}
function initThree(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;
  applyQuality();
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x05060c);
  scene.fog=new THREE.Fog(0x05060c,8,60);
  camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,0.05,200);
  camera.position.copy(player.pos);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0x99a3c8,1.1));
  const hemi=new THREE.HemisphereLight(0x5a6a9a,0x2a2018,0.9); scene.add(hemi);
  flashlight=new THREE.SpotLight(0xfff2d0,60,34,0.6,0.5,1.4);
  const fill=new THREE.PointLight(0xbfd0ff,6,9,1.6); camera.add(fill); fill.position.set(0,0.2,0);
  flashTarget=new THREE.Object3D(); scene.add(flashTarget);
  flashlight.target=flashTarget; camera.add(flashlight);
  flashlight.position.set(0.25,-0.15,0.1);
  clock=new THREE.Clock();
  addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });
}

/* ---------------- MATERIALES ---------------- */
const M=(c,r=0.85,extra={})=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:0.05,...extra});
const ME=(c,e,ei=1)=>new THREE.MeshStandardMaterial({color:c,emissive:e,emissiveIntensity:ei,roughness:0.6});

/* ---------------- CONSTRUCCIÓN ---------------- */
function addCollider(x1,x2,z1,z2){ colliders.push({x1:Math.min(x1,x2),x2:Math.max(x1,x2),z1:Math.min(z1,z2),z2:Math.max(z1,z2)}); }
function wall(x1,z1,x2,z2,h=3.2,mat=null){
  const dx=Math.abs(x2-x1),dz=Math.abs(z2-z1);
  const w=Math.max(dx,0.3),d=Math.max(dz,0.3);
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat||M(0x3a3f55));
  m.position.set((x1+x2)/2,h/2,(z1+z2)/2);
  scene.add(m);
  const t=0.25;
  addCollider(Math.min(x1,x2)- (dx<0.2?t:0),Math.max(x1,x2)+(dx<0.2?t:0),Math.min(z1,z2)-(dz<0.2?t:0),Math.max(z1,z2)+(dz<0.2?t:0));
  return m;
}
function floorRect(x1,x2,z1,z2,color,rough=0.9){
  const g=new THREE.PlaneGeometry(Math.abs(x2-x1),Math.abs(z2-z1));
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:rough}));
  m.rotation.x=-Math.PI/2; m.position.set((x1+x2)/2,0,(z1+z2)/2);
  scene.add(m); return m;
}
function ceilingRect(x1,x2,z1,z2,color=0x14161f){
  const g=new THREE.PlaneGeometry(Math.abs(x2-x1),Math.abs(z2-z1));
  const m=new THREE.Mesh(g,M(color,0.95)); m.rotation.x=Math.PI/2;
  m.position.set((x1+x2)/2,3.2,(z1+z2)/2); scene.add(m);
}
function roomLamp(x,z,color=0xffe6b0,intensity=1.1){
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.12,10,8),ME(0xffffff,color,2));
  bulb.position.set(x,3.0,z); scene.add(bulb);
  const l=new THREE.PointLight(color,intensity*22,18,1.5); l.position.set(x,2.8,z); scene.add(l);
  const fix=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.08,0.5),M(0x22242e)); fix.position.set(x,3.12,z); scene.add(fix);
  return {bulb,light:l};
}
const lamps=[];
function poster(x,y,z,ry,c1,c2,emoji){
  const g=new THREE.Group();
  const bg=new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.9),M(c1,0.8)); g.add(bg);
  const inner=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.9),M(c2,0.8)); inner.position.z=0.01; g.add(inner);
  const trim=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.0,0.04),M(0x101218)); trim.position.z=-0.02; g.add(trim);
  g.position.set(x,y,z); g.rotation.y=ry; scene.add(g);
  if(emoji){
    const cv=document.createElement('canvas');cv.width=128;cv.height=128;
    const cx=cv.getContext('2d');cx.font='84px serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(emoji,64,70);
    const tx=new THREE.CanvasTexture(cv);
    const sp=new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.8),new THREE.MeshBasicMaterial({map:tx,transparent:true}));
    sp.position.z=0.03; g.add(sp);
  }
  return g;
}
function textSprite(text,color='#ffd23e',size=44){
  const cv=document.createElement('canvas');cv.width=512;cv.height=128;
  const cx=cv.getContext('2d');cx.font=`900 ${size}px Arial`;cx.textAlign='center';cx.textBaseline='middle';
  cx.fillStyle=color;cx.strokeStyle='#000';cx.lineWidth=6;cx.strokeText(text,256,64);cx.fillText(text,256,64);
  const tx=new THREE.CanvasTexture(cv);
  const sp=new THREE.Mesh(new THREE.PlaneGeometry(4,1),new THREE.MeshBasicMaterial({map:tx,transparent:true}));
  return sp;
}
function addHitbox(x,y,z,r,grapple){
  const hb=new THREE.Mesh(new THREE.SphereGeometry(r,8,8),
    new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  hb.position.set(x,y,z); hb.userData.grapple=grapple; scene.add(hb);
  grappleTargets.push(hb); return hb;
}

function buildLevel(){
  /* ===== SUELOS / TECHOS ===== */
  floorRect(-10,10,-7,7,0x2e2a26);            // lobby: damero sucio
  floorRect(10,20,-7,7,0x51383f);             // tienda
  floorRect(-5.5,-2.5,-14,-7,0x24262e);       // pasillo
  floorRect(-18,-2,-24,-14,0x23242c);         // energía
  floorRect(-2,14,-22,-7,0x2b2d38);           // máquinas
  floorRect(4,6,-30,-22,0x1c1d24);            // conducto
  floorRect(2,8,-70,-30,0x26242e);            // persecución
  // damero lobby decorativo
  for(let ix=0;ix<10;ix++)for(let iz=0;iz<7;iz++){
    if((ix+iz)%2) continue;
    const t=new THREE.Mesh(new THREE.PlaneGeometry(1.9,1.9),M(0x3d3830,0.95));
    t.rotation.x=-Math.PI/2;t.position.set(-9+ix*2,0.005,-6+iz*2);scene.add(t);
  }
  // alfombra roja lobby -> portón
  const carpet=new THREE.Mesh(new THREE.PlaneGeometry(3,12),M(0x8a1f2e,0.95));
  carpet.rotation.x=-Math.PI/2;carpet.position.set(5,0.008,0);scene.add(carpet);
  [[-10,10,-7,7],[10,20,-7,7],[-5.5,-2.5,-14,-7],[-18,-2,-24,-14],[-2,14,-22,-7],[4,6,-30,-22],[2,8,-70,-30]].forEach(([a,b,c,d])=>ceilingRect(a,b,c,d));

  const wallMat=M(0x464b63), wallMat2=M(0x5a4a52), darkMat=M(0x2b2e3c);
  /* ===== LOBBY ===== */
  wall(-10,7,10,7,3.2,wallMat);                       // sur
  wall(-10,-7,-10,7,3.2,wallMat);                     // oeste
  wall(10,-7,10,2,3.2,wallMat2); wall(10,5,10,7,3.2,wallMat2); // este con hueco tienda
  wall(-10,-7,-5.5,-7,3.2,wallMat); wall(-2.5,-7,3,-7,3.2,wallMat); wall(7,-7,10,-7,3.2,wallMat); // norte con 2 huecos
  // mostrador recepción
  const desk=new THREE.Mesh(new THREE.BoxGeometry(4,1.1,1),M(0x6b4a2f));desk.position.set(-3,0.55,3.5);scene.add(desk);
  addCollider(-5,-1,3,4);
  const deskTop=new THREE.Mesh(new THREE.BoxGeometry(4.2,0.08,1.2),M(0x8a6238));deskTop.position.set(-3,1.14,3.5);scene.add(deskTop);
  const sign=textSprite('JUGUETES SONRISA S.A.','#ffd23e',52);sign.position.set(0,2.4,6.8);sign.rotation.y=Math.PI;scene.add(sign);
  const sign2=textSprite('¡BIENVENIDOS!','#29b6ff',60);sign2.position.set(0,2.5,-6.8);scene.add(sign2);
  poster(-9.8,1.7,0,Math.PI/2,0x27436b,0x7cc4ff,'🧸');
  poster(9.8,1.7,-3,-Math.PI/2,0x6b2743,0xff8ab0,'🪆');
  poster(-6,1.7,6.8,Math.PI,0x3a6b27,0xa8ff7c,'🤖');
  // estatua simpática (tótem)
  const statue=new THREE.Group();
  const sb=new THREE.Mesh(new THREE.SphereGeometry(0.7,14,12),M(0x3f6fd1));sb.position.y=1.1;statue.add(sb);
  const sh=new THREE.Mesh(new THREE.SphereGeometry(0.45,14,12),M(0x3f6fd1));sh.position.y=2.0;statue.add(sh);
  const se1=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),ME(0xffff88,0xffff88,2));se1.position.set(-0.15,2.05,0.38);statue.add(se1);
  const se2=se1.clone();se2.position.x=0.15;statue.add(se2);
  statue.position.set(7.5,0,4.5);scene.add(statue);addCollider(6.8,8.2,3.8,5.2);

  /* ===== TIENDA REGALOS ===== */
  wall(20,-7,20,7,3.2,wallMat2); wall(10,-7,20,-7,3.2,wallMat2); wall(10,7,20,7,3.2,wallMat2);
  for(let i=0;i<4;i++){
    const sh2=new THREE.Mesh(new THREE.BoxGeometry(0.5,2.2,3),M(0x5a3a28));sh2.position.set(19.4,1.1,-4.5+i*2.8);scene.add(sh2);
    for(let s=0;s<3;s++){
      const toy=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),M([0xff5b7a,0x29b6ff,0xffd23e,0x7CFC00][(i+s)%4],0.6));
      toy.position.set(19.1,0.6+s*0.6,-5.4+i*2.8+(s%2)*0.6);scene.add(toy);
    }
  }
  addCollider(19,20,-7,7);
  // mesa GarraPack
  const table=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.9,1.2),M(0x707a99));table.position.set(16,0.45,0);scene.add(table);
  addCollider(14.9,17.1,-0.6,0.6);
  const packCase=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.5,0.7),ME(0x223344,0x29b6ff,0.7));packCase.position.set(16,1.15,0);scene.add(packCase);
  grabPackTable=packCase;
  // mochila garrapack visible
  const pack=new THREE.Group();
  const pk=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.6,0.3),M(0x8a93b0));pack.add(pk);
  const pkB=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,8),M(0x29b6ff));pkB.position.set(-0.2,0.1,0.2);pack.add(pkB);
  const pkR=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,8),M(0xff3b5c));pkR.position.set(0.2,0.1,0.2);pack.add(pkR);
  pack.position.set(16,1.6,0);pack.rotation.y=0.5;scene.add(pack);
  pack.userData.spin=true; grabPackTable.userData.packSpin=pack;
  const t2=textSprite('★ ¡GRARRAPACK GRATIS! ★','#7CFC00',40);t2.position.set(16,2.6,0);scene.add(t2);
  interactables.push({pos:new THREE.Vector3(16,1.2,0),radius:2.6,prompt:'Recoger el GARRAPACK',enabled:()=>!state.hasPack,action:()=>{
    state.hasPack=true; sfx.pickup(); showToast('🎒 ¡GarraPack equipado! Click IZQ = mano azul, Click DER = mano roja.');
    setStage(1); say('¡Guau! Dos manos elásticas. Seguro que abren esa puerta de seguridad del lobby…');
    scene.remove(pack);
  }});

  /* ===== PASILLO SEGURIDAD ===== */
  wall(-5.5,-14,-5.5,-7,3.2,darkMat); wall(-2.5,-14,-2.5,-7,3.2,darkMat);
  // puerta seguridad + pomo agarrable
  makeDoor('security',-4,-7,3,2.6,0x8a93a8);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(0.16,12,10),ME(0xffd23e,0xffd23e,1.4));
  knob.position.set(-4,1.4,-6.75);scene.add(knob);
  knob.userData.grapple={type:'handle',door:'security'};
  grappleTargets.push(knob); doors.security.knob=knob;
  addHitbox(-4,1.4,-6.75,0.65,{type:'handle',door:'security'});
  const ds=textSprite('SEGURIDAD','#ff8a8a',44);ds.position.set(-4,2.8,-6.9);ds.rotation.y=Math.PI;scene.add(ds);

  /* ===== SALA ENERGÍA ===== */
  wall(-18,-14,-5.5,-14,3.2,darkMat); wall(-2.5,-14,-2,-14,3.2,darkMat);
  wall(-18,-24,-2,-24,3.2,darkMat); wall(-18,-24,-18,-14,3.2,darkMat); wall(-2,-24,-2,-14,3.2,darkMat);
  const ps=textSprite('⚡ SALA DE ENERGÍA','#7cc4ff',48);ps.position.set(-10,2.6,-14.2);ps.rotation.y=Math.PI;scene.add(ps);
  // 2 torres eléctricas
  function pylon(x,z){
    const g=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.55,0.4,12),M(0x333848));base.position.y=0.2;g.add(base);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.16,2.2,10),M(0x9aa3c0));pole.position.y=1.4;g.add(pole);
    const orb=new THREE.Mesh(new THREE.SphereGeometry(0.34,14,12),ME(0x2244aa,0x29b6ff,1.6));orb.position.y=2.7;g.add(orb);
    g.position.set(x,0,z);scene.add(g);
    orb.userData.grapple={type:'pylon',id:x< -10?'A':'B'};
    grappleTargets.push(orb);
    addHitbox(x,2.7,z,0.8,{type:'pylon',id:x< -10?'A':'B',orb});
    addCollider(x-0.5,x+0.5,z-0.5,z+0.5);
    return {group:g,orb,holding:false};
  }
  pylons.A=pylon(-14,-19); pylons.B=pylon(-6,-19);
  poster(-17.8,1.7,-19,Math.PI/2,0x6b6327,0xffe67c,'⚡');
  // puerta principal (shutter norte lobby) — se abre con energía
  makeDoor('main',5,-7,4,2.9,0xb8892f,true);
  const ms=textSprite('⛔ SIN ENERGÍA','#ff5b5b',40);ms.position.set(5,2.9,-6.8);ms.rotation.y=Math.PI;scene.add(ms);
  doors.main.sign=ms;

  /* ===== SALA MÁQUINAS ===== */
  wall(10,-7,14,-7,3.2,wallMat); wall(-2,-14,-2,-7,3.2,wallMat);
  wall(-2,-22,4,-22,3.2,wallMat); wall(6,-22,14,-22,3.2,wallMat);
  wall(14,-22,14,-7,3.2,wallMat);
  wall(-2,-22,-2,-14,3.2,darkMat); // oeste (comparte con energía en parte)
  const fs=textSprite('🏭 CREA-UN-AMIGO','#ff9ad1',52);fs.position.set(6,2.7,-21.8);scene.add(fs);
  // máquina grande
  const mach=new THREE.Group();
  const bodyM=new THREE.Mesh(new THREE.BoxGeometry(3.4,2.6,1.6),M(0xd14a6e));mach.add(bodyM);
  const face=new THREE.Mesh(new THREE.BoxGeometry(2.6,1.2,0.2),M(0x7a2438));face.position.set(0,0.4,0.85);mach.add(face);
  const mEye1=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,8),ME(0xffff99,0xffff66,2));mEye1.position.set(-0.5,0.6,1.0);mach.add(mEye1);
  const mEye2=mEye1.clone();mEye2.position.x=0.5;mach.add(mEye2);
  const tube1=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,2.4,10),M(0x9aa3c0));tube1.position.set(-1.2,2.2,0);mach.add(tube1);
  const tube2=tube1.clone();tube2.position.x=1.2;mach.add(tube2);
  mach.position.set(9,1.3,-19.5);scene.add(mach);addCollider(7.2,10.8,-20.4,-18.6);
  machineLeverMesh=new THREE.Mesh(new THREE.BoxGeometry(0.3,1.0,0.3),ME(0xffd23e,0xffaa00,1));
  machineLeverMesh.position.set(6.4,1.2,-19.5);scene.add(machineLeverMesh);
  machineLeverMesh.userData.grapple={type:'lever',id:'machine'};
  grappleTargets.push(machineLeverMesh);
  addHitbox(6.4,1.2,-19.5,0.8,{type:'lever',id:'machine'});
  const leverBase=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.4,0.6),M(0x222));leverBase.position.set(6.4,0.5,-19.5);scene.add(leverBase);
  interactables.push({pos:new THREE.Vector3(9,1.2,-18.2),radius:3.2,prompt:'Insertar piezas / activar máquina',enabled:()=>state.power&&!state.machineOn,action:()=>{
    if(state.parts<state.partsNeeded){sfx.denied();showToast(`🔧 Te faltan piezas (${state.parts}/${state.partsNeeded}). Busca las ★ amarillas.`);return;}
    pullMachineLever();
  }});
  // piezas juguete ★
  function toyPart(x,z){
    const star=new THREE.Mesh(new THREE.OctahedronGeometry(0.3),ME(0xffd23e,0xffaa00,1.2));
    star.position.set(x,0.8,z);scene.add(star);
    star.userData.float=true;
    const it={pos:new THREE.Vector3(x,1,z),radius:2.2,prompt:'Recoger pieza de juguete ★',mesh:star,enabled:()=>!it.done,action:()=>{
      it.done=true;state.parts++;sfx.pickup();scene.remove(star);
      showToast(`🧩 Pieza ${state.parts}/${state.partsNeeded} conseguida.`);
      if(state.parts>=state.partsNeeded&&state.stage===3){setStage(4);say('¡Ya tengo las dos piezas! A la máquina…');}
    }};
    interactables.push(it);
  }
  toyPart(-0.2,-10); toyPart(12.5,-20.5);
  // cinta transportadora decorativa
  const belt=new THREE.Mesh(new THREE.BoxGeometry(6,0.5,1.2),M(0x303344));belt.position.set(3,0.6,-19.5);belt.rotation.y=0.3;scene.add(belt);
  addCollider(0,6,-20.5,-18.5);

  /* ===== CONDUCTO ===== */
  wall(4,-30,4,-22,2.0,darkMat); wall(6,-30,6,-22,2.0,darkMat);
  makeDoor('vent',5,-22,2,2.0,0x5a6b8a);
  const vs=textSprite('VENTILACIÓN','#9adcff',36);vs.position.set(5,2.4,-22.3);scene.add(vs);

  /* ===== PASILLO PERSECUCIÓN ===== */
  wall(2,-70,2,-30,3.4,darkMat); wall(8,-70,8,-30,3.4,darkMat);
  wall(2,-70,8,-70,3.4,wallMat);
  wall(2,-30,4,-30,3.2,darkMat); wall(6,-30,8,-30,3.2,darkMat); // muro con hueco conducto
  // luces de emergencia rojas
  for(let z=-32;z>=-68;z-=6){
    const l=new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8),ME(0xff2222,0xff2222,2));
    l.position.set(5,3.0,z);scene.add(l);
  }
  const cs=textSprite('🏃 ¡CORRE! 🏃','#ff3b5c',64);cs.position.set(5,2.5,-34);cs.rotation.y=Math.PI;scene.add(cs);
  // obstáculos para saltar/esquivar (cajas)
  [[3.5,-40],[6.5,-46],[4,-52],[6,-58],[3.5,-63]].forEach(([x,z])=>{
    const b=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.2,1.2),M(0x6b5a2f));b.position.set(x,0.6,z);b.rotation.y=0.4;scene.add(b);
    addCollider(x-0.7,x+0.7,z-0.7,z+0.7);
  });
  // puerta salida + palanca emergencia
  makeDoor('exit',5,-70,6,3.0,0x2fbf71);
  exitLeverMesh=new THREE.Mesh(new THREE.BoxGeometry(0.35,1.1,0.35),ME(0xff2222,0xff0000,1.4));
  exitLeverMesh.position.set(7.4,1.4,-68.5);scene.add(exitLeverMesh);
  exitLeverMesh.userData.grapple={type:'lever',id:'exit'};
  grappleTargets.push(exitLeverMesh);
  addHitbox(7.4,1.4,-68.5,0.9,{type:'lever',id:'exit'});
  const es=textSprite('SALIDA','#7CFC00',60);es.position.set(5,2.7,-69.7);es.rotation.y=Math.PI;scene.add(es);

  /* ===== CINTAS VHS 📼 ===== */
  [[-8,5.5,'lobby'],[18,5.5,'tienda'],[-16,-16,'energía'],[0,-12,'máquinas']].forEach(([x,z],i)=>{
    const tape=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.12,0.25),M(0x111318));
    tape.position.set(x,0.5,z);scene.add(tape);
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(0.41,0.04,0.1),ME(0xff2f6d,0xff2f6d,1));stripe.position.set(x,0.57,z);scene.add(stripe);
    const it={pos:new THREE.Vector3(x,0.8,z),radius:2.0,prompt:'Ver cinta VHS 📼',meshes:[tape,stripe],enabled:()=>!it.done,action:()=>{
      it.done=true;state.tapes++;sfx.tape();tape.visible=stripe.visible=false;
      $('tapes').textContent=`📼 ${state.tapes}/4`;
      const lore=[
        'CINTA 1/4 — "Bienvenidos a Juguetes Sonrisa. Aquí cada abrazo es eterno."',
        'CINTA 2/4 — "El experimento 1176… Mullido… responde al sonido. No corras. No respires."',
        'CINTA 3/4 — "Si falla la luz, une las dos torres con material conductor. Tus manos sirven."',
        'CINTA 4/4 — "La máquina Crea-un-Amigo necesita dos piezas. Luego reza. Y corre."',
      ];
      say(lore[i]);
      showToast(`📼 Cinta ${state.tapes}/4 guardada.`);
    }};
    interactables.push(it);
  });

  /* ===== LUCES ===== */
  lamps.push(roomLamp(0,0),roomLamp(15,0),roomLamp(-4,-10,0xbfe0ff,0.9),
    roomLamp(-10,-19,0xbfe0ff,1.0),roomLamp(6,-14),roomLamp(5,-26,0xff5555,1.2),
    roomLamp(5,-40,0xff6666,1.2),roomLamp(5,-55,0xff6666,1.2),roomLamp(5,-66,0x7CFC00,1.4));

  buildMonster();
  buildHands();
  buildViewmodel();
}

function makeDoor(id,x,z,w,h,color,shutter=false){
  const g=new THREE.Group();
  const panel=new THREE.Mesh(new THREE.BoxGeometry(w,h,0.25),
    shutter?new THREE.MeshStandardMaterial({color,roughness:0.6,metalness:0.5}):M(color,0.7));
  panel.position.set(x,h/2,z);g.add(panel);
  // marco
  const f1=new THREE.Mesh(new THREE.BoxGeometry(0.3,h+0.3,0.4),M(0x181a26));f1.position.set(x-w/2,h/2,z);g.add(f1);
  const f2=f1.clone();f2.position.x=x+w/2;g.add(f2);
  scene.add(g);
  doors[id]={id,x,z,w,h,panel,open:false,anim:0,shutter};
  if(!doors[id].open) addCollider(x-w/2,x+w/2,z-0.3,z+0.3);
  doors[id].colliderIndex=colliders.length-1;
  return doors[id];
}
function setDoorOpen(id,open){
  const d=doors[id]; if(!d||d.open===open) return;
  d.open=open; sfx.door();
  if(open){ colliders.splice(d.colliderIndex,1); Object.values(doors).forEach(dd=>{ if(dd.colliderIndex>d.colliderIndex) dd.colliderIndex--; }); }
  else addCollider(d.x-d.w/2,d.x+d.w/2,d.z-0.3,d.z+0.3);
}

/* ---------------- MONSTRUO "MULLIDO" ---------------- */
function buildMonster(){
  const g=new THREE.Group();
  const fur=M(0x2b4fd1,0.95);
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.7,14,12),fur);body.position.y=1.5;body.scale.set(1,1.3,0.8);g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.5,14,12),fur);head.position.y=2.5;g.add(head);
  const snout=new THREE.Mesh(new THREE.SphereGeometry(0.25,10,8),M(0x1a2c66,0.9));snout.position.set(0,2.35,0.4);g.add(snout);
  const eL=new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8),ME(0xffff66,0xffff00,2.5));eL.position.set(-0.18,2.6,0.38);g.add(eL);
  const eR=eL.clone();eR.position.x=0.18;g.add(eR);
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.12,0.1),M(0x0a0a0a));mouth.position.set(0,2.2,0.45);g.add(mouth);
  const earG=new THREE.ConeGeometry(0.18,0.6,8);
  const ear1=new THREE.Mesh(earG,fur);ear1.position.set(-0.35,3.0,0);g.add(ear1);
  const ear2=new THREE.Mesh(earG,fur);ear2.position.set(0.35,3.0,0);g.add(ear2);
  const bow=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.07,8,12),M(0xd12030,0.6));bow.position.set(0,2.0,0.42);g.add(bow);
  const limbG=new THREE.CylinderGeometry(0.12,0.16,1.6,8);
  const aL=new THREE.Mesh(limbG,fur);aL.position.set(-0.85,1.5,0);aL.rotation.z=0.25;g.add(aL);
  const aR=new THREE.Mesh(limbG,fur);aR.position.set(0.85,1.5,0);aR.rotation.z=-0.25;g.add(aR);
  const lL=new THREE.Mesh(limbG,fur);lL.position.set(-0.3,0.5,0);g.add(lL);
  const lR=new THREE.Mesh(limbG,fur);lR.position.set(0.3,0.5,0);g.add(lR);
  g.position.set(5,0,-31); g.visible=false; scene.add(g);
  monster=g; monster.userData={aL,aR,phase:0};
}

/* ---------------- MANOS + VIEWMODEL ---------------- */
function buildHands(){
  for(const key of ['blue','red']){
    const h=hands[key];
    const glove=new THREE.Group();
    const palm=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.26,0.14),M(h.color,0.5));glove.add(palm);
    for(let f=0;f<4;f++){
      const fg=new THREE.Mesh(new THREE.BoxGeometry(0.045,0.16,0.05),M(h.color,0.5));
      fg.position.set(-0.075+f*0.05,0.2,0);glove.add(fg);
    }
    const cuff=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.11,0.18,10),M(0x22242e));cuff.position.y=-0.2;glove.add(cuff);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8),ME(h.color,h.color,2));glow.position.set(0,0,0.09);glove.add(glow);
    glove.visible=false;scene.add(glove);h.mesh=glove;
    const lg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
    const line=new THREE.Line(lg,new THREE.LineBasicMaterial({color:h.color}));
    line.visible=false;scene.add(line);h.line=line;
  }
}
function buildViewmodel(){
  // cañones del GarraPack en cámara
  const mk=(side,color)=>{
    const c=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.032,0.2,10),M(color,0.5));
    c.rotation.x=Math.PI/2.3;c.position.set(0.22*side,-0.2,-0.45);camera.add(c);return c;
  };
  window._vmL=mk(-1,0x29b6ff); window._vmR=mk(1,0xff3b5c);
  window._vmL.visible=window._vmR.visible=false;
}

/* ---------------- UI helpers ---------------- */
function showToast(t,ms=3200){toast.textContent=t;toast.classList.remove('hidden');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>toast.classList.add('hidden'),ms);}
function say(t,ms=5200){subtitle.textContent='🎙 '+t;subtitle.classList.remove('hidden');clearTimeout(state.subtitleTimer);state.subtitleTimer=setTimeout(()=>subtitle.classList.add('hidden'),ms);}
function setStage(n){
  state.stage=n;
  const S=[
    ['Explora la TIENDA DE REGALOS','Puerta este del lobby (hueco en la pared). Busca el GarraPack.'],
    ['Abre la puerta de SEGURIDAD','Dispara una mano al POMO AMARILLO y espera el tirón.'],
    ['Restaura la ENERGÍA','Sala oeste: pega la mano AZUL a una torre y la ROJA a la otra. Aguanta 3 s.'],
    ['Busca 2 PIEZAS ★','Sala de máquinas (portón norte). Brillan en amarillo. Pulsa [E].'],
    ['Activa la máquina CREA-UN-AMIGO','Ve a la máquina rosa y pulsa [E] (o dispara a su palanca).'],
    ['Cruza el CONDUCTO','Agáchate… algo respira al otro lado.'],
    ['¡CORRE A LA SALIDA!','Esquiva cajas. Dispara a la PALANCA ROJA para cerrar el portón.'],
  ];
  if(S[n]){objText.textContent=S[n][0];objSub.textContent=S[n][1];}
  $('power-fill').style.width=state.power?'100%':'0%';
}
function fmtTime(s){const m=Math.floor(s/60),ss=Math.floor(s%60);return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;}

/* ---------------- INPUT ---------------- */
function bindInput(){
  addEventListener('keydown',e=>{
    player.keys[e.code]=true;
    if(e.code==='KeyE') tryInteract();
    if(e.code==='KeyR') retractHands();
    if(e.code==='KeyM'){state.muted=!state.muted;showToast(state.muted?'🔇 Silenciado':'🔊 Sonido activado');}
    if(e.code==='KeyP') togglePause();
    if(['Space','ArrowUp'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup',e=>{player.keys[e.code]=false;});
  addEventListener('mousemove',e=>{
    if(!player.locked||!state.running||state.paused) return;
    player.yaw-=e.movementX*0.0024;
    player.pitch-=e.movementY*0.0024;
    player.pitch=Math.max(-1.45,Math.min(1.45,player.pitch));
  });
  canvas.addEventListener('mousedown',e=>{
    if(!state.running||state.paused||state.dead||state.won) return;
    if(!player.locked){canvas.requestPointerLock();return;}
    if(e.button===0) fireHand('blue');
    if(e.button===2) fireHand('red');
  });
  addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('pointerlockchange',()=>{
    player.locked=document.pointerLockElement===canvas;
    if(!player.locked&&state.running&&!state.paused&&!state.dead&&!state.won) togglePause(true);
  });
  $('btn-start').onclick=()=>{initAudio();audio.ctx.resume();startGame();};
  $('btn-how').onclick=()=>$('howto').classList.toggle('hidden');
  $('btn-resume').onclick=()=>togglePause(false);
  $('btn-restart').onclick=()=>location.reload();
  $('btn-retry').onclick=()=>location.reload();
  $('btn-again').onclick=()=>location.reload();
  $('opt-flash').onchange=e=>{if(flashlight)flashlight.visible=e.target.checked;};
}
function togglePause(force){
  if(!state.running||state.dead||state.won) return;
  const to=force===true?true:!state.paused;
  state.paused=to;
  $('menu-pause').classList.toggle('hidden',!to);
  if(to){document.exitPointerLock?.();$('pause-stats').textContent=`Tiempo ${fmtTime(state.elapsed)} · Cintas ${state.tapes}/4 · Piezas ${state.parts}/2`;}
  else canvas.requestPointerLock();
}

/* ---------------- GAME FLOW ---------------- */
function startGame(){
  $('menu-main').classList.add('hidden');
  hud.classList.remove('hidden');
  $('loading').style.display='none';
  state.running=true;state.startTime=performance.now();
  setStage(0);
  say('10 años después… la fábrica sigue respirando. Encuentra el GarraPack en la tienda.');
  canvas.requestPointerLock();
  if(window._vmL&&state.hasPack){} // se muestra al recoger
}
function die(){
  if(state.dead||state.won) return;
  state.dead=true;sfx.sting();sfx.roar();
  $('jumpscare').classList.remove('hidden');
  document.exitPointerLock?.();
  setTimeout(()=>{
    $('jumpscare').classList.add('hidden');
    $('menu-dead').classList.remove('hidden');
    $('dead-stats').textContent=`Sobreviviste ${fmtTime(state.elapsed)} · Etapa: ${objText.textContent} · Cintas ${state.tapes}/4`;
  },1400);
}
function win(){
  if(state.won||state.dead) return;
  state.won=true;sfx.win();
  document.exitPointerLock?.();
  $('menu-win').classList.remove('hidden');
  $('win-stats').textContent=`Tiempo total ${fmtTime(state.elapsed)} · Cintas ${state.tapes}/4 · ¡Capítulo 1 completado!`;
}

/* ---------------- GRARRAPACK ---------------- */
const raycaster=new THREE.Raycaster();
function handOrigin(side){
  const v=new THREE.Vector3(0.32*side,-0.25,-0.5);
  return camera.localToWorld(v.clone());
}
function fireHand(key){
  const h=hands[key];
  if(!state.hasPack){showToast('🔒 Primero recoge el GarraPack en la tienda (este).');sfx.denied();return;}
  if(key==='red'&&state.stage<2){showToast('🔒 La mano ROJA se desbloquea con la puerta de seguridad.');sfx.denied();return;}
  if(h.state!=='idle'||h.cooldown>0) return;
  // raycast centro
  raycaster.setFromCamera({x:0,y:0},camera);
  raycaster.far=24;
  const hits=raycaster.intersectObjects(grappleTargets,false);
  let target=null,point=null;
  if(hits.length){target=hits[0].object;point=hits[0].point.clone();}
  else{
    // punto en pared lejana para feedback visual
    const wallHit=raycaster.intersectObjects(scene.children,true)[0];
    point=wallHit?wallHit.point.clone():camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(18));
  }
  h.state='flying';h.target=target;h.tip.copy(handOrigin(h.side));h.dest=point.clone();
  h.mesh.visible=true;h.line.visible=true;
  document.getElementById(key==='blue'?'hand-left':'hand-right').classList.add('flying');
  sfx.shoot();
  crosshair.classList.add('active');setTimeout(()=>crosshair.classList.remove('active'),180);
}
function retractHands(){
  for(const k of ['blue','red']){
    const h=hands[k];
    if(h.state!=='idle'){h.state='idle';h.mesh.visible=false;h.line.visible=false;
      document.getElementById(k==='blue'?'hand-left':'hand-right').classList.remove('flying');
      if(h.target?.userData?.grapple?.type==='pylon'){const o=h.target.userData.grapple.orb||h.target;if(o.material.emissive)o.material.emissiveIntensity=1.6;}
      h.target=null;}
  }
  sfx.retract();
}
function updateHands(dt){
  for(const key of ['blue','red']){
    const h=hands[key];
    if(h.cooldown>0)h.cooldown-=dt;
    if(h.state==='flying'){
      const d=h.dest.clone().sub(h.tip);
      const dist=d.length();
      if(dist<0.35){
        // llegó
        if(h.target&&h.target.userData.grapple){
          h.state='attached';h.dist=camera.position.distanceTo(h.dest);
          onAttach(key,h.target);
        }else{
          // falló: rebota
          h.state='idle';h.mesh.visible=false;h.line.visible=false;h.cooldown=0.25;
          document.getElementById(key==='blue'?'hand-left':'hand-right').classList.remove('flying');
          showToast('🤏 La mano no agarró nada. Apunta al brillo.');
        }
      }else{
        d.normalize();
        h.tip.addScaledVector(d,Math.min(26*dt,dist));
        h.mesh.position.copy(h.tip);
        h.mesh.lookAt(camera.position);
      }
    }else if(h.state==='attached'){
      const t=h.target;
      if(!t){h.state='idle';continue;}
      h.tip.copy(t.getWorldPosition(new THREE.Vector3()));
      // si es pomo/lever con temporizador de tirón
      if(t.userData.pullTimer!==undefined){
        t.userData.pullTimer+=dt;
        // efecto tirón: sacudir puerta
        if(t.userData.pullTimer>0.8){
          activateGrappleTarget(t);
          t.userData.pullTimer=undefined;
          h.state='idle';h.mesh.visible=false;h.line.visible=false;
          document.getElementById(key==='blue'?'hand-left':'hand-right').classList.remove('flying');
          continue;
        }
      }
      // si es pylón y el jugador se aleja mucho, soltar
      const dd=camera.position.distanceTo(h.tip);
      if(dd>26){h.state='idle';h.mesh.visible=false;h.line.visible=false;
        document.getElementById(key==='blue'?'hand-left':'hand-right').classList.remove('flying');h.target=null;continue;}
      h.mesh.position.copy(h.tip);
    }
    // dibujar cuerda
    if(h.mesh.visible){
      const o=handOrigin(h.side);
      const pos=h.line.geometry.attributes.position;
      pos.setXYZ(0,o.x,o.y,o.z);pos.setXYZ(1,h.tip.x,h.tip.y,h.tip.z);pos.needsUpdate=true;
    }
    const el=document.getElementById(key==='blue'?'hand-left':'hand-right').querySelector('.hand-state');
    if(el) el.textContent=h.state==='idle'?'lista':h.state==='flying'?'volando…':'¡AGARRADA!';
  }
  // puzzle energía: ambas manos en torres distintas
  const b=hands.blue.target, r=hands.red.target;
  const bP=b?.userData?.grapple?.type==='pylon'&&hands.blue.state==='attached';
  const rP=r?.userData?.grapple?.type==='pylon'&&hands.red.state==='attached';
  if(bP&&rP&&b!==r&&!state.power){
    state.powerCharge+=dt;
    sfx.hum();
    const pct=Math.min(100,state.powerCharge/3*100);
    $('power-fill').style.width=pct+'%';
    const orbA=b.userData.grapple.orb||b, orbB=r.userData.grapple.orb||r;
    if(orbA.material.emissive)orbA.material.emissiveIntensity=2.5+Math.sin(performance.now()/60)*1;
    if(orbB.material.emissive)orbB.material.emissiveIntensity=2.5+Math.cos(performance.now()/60)*1;
    if(Math.random()<0.3) tone(150+Math.random()*600,0.08,'sawtooth',0.06);
    if(state.powerCharge>=3) powerOn();
  }else if(!state.power){
    state.powerCharge=Math.max(0,state.powerCharge-dt*1.5);
    $('power-fill').style.width=(state.powerCharge/3*100)+'%';
  }
}
function onAttach(key,target){
  const g=target.userData.grapple;
  sfx.stick();
  document.getElementById(key==='blue'?'hand-left':'hand-right').classList.remove('flying');
  if(g.type==='handle'||g.type==='lever'){
    target.userData.pullTimer=0;
    showToast('🤏 ¡Agarrado! Tirando…');
    tone(140,0.4,'sawtooth',0.2,80);
  }else if(g.type==='pylon'){
    showToast('⚡ Torre conectada. ¡Conecta la otra mano a la otra torre!');
    sfx.zap();
  }
}
function activateGrappleTarget(t){
  const g=t.userData.grapple;
  if(g.type==='handle'&&g.door==='security'){
    setDoorOpen('security',true);
    showToast('🚪 ¡Puerta de seguridad ABIERTA de un tirón!');
    say('Buen tirón. La sala de energía está al fondo del pasillo, al oeste.');
    if(state.stage===1){setStage(2);
      // desbloquear mano roja
      document.querySelector('#hand-right .hand-state').textContent='lista';
    }
    sfx.door();
  }else if(g.type==='lever'&&g.id==='machine'){pullMachineLever();}
  else if(g.type==='lever'&&g.id==='exit'){closeExitDoor();}
}
function powerOn(){
  state.power=true;
  $('power-fill').style.width='100%';
  sfx.win?.();sfx.lever();
  scene.fog=new THREE.Fog(0x0a0c18,10,70);
  lamps.forEach(l=>{l.light.intensity=1.6*22;l.bulb.material.emissiveIntensity=3;});
  setDoorOpen('main',true);
  if(doors.main.sign)doors.main.sign.visible=false;
  showToast('💡 ¡ENERGÍA RESTAURADA! El portón norte del lobby está abierto.');
  say('Se encienden las luces… y algo aplaude despacio en la sala de máquinas. Ve al norte.');
  setStage(3);
  retractHands();
}
function pullMachineLever(){
  if(!state.power){sfx.denied();showToast('🔒 Sin energía. Restaura la luz primero.');return;}
  if(state.parts<state.partsNeeded){sfx.denied();showToast(`🔧 Faltan piezas (${state.parts}/${state.partsNeeded}).`);return;}
  if(state.machineOn) return;
  state.machineOn=true;sfx.lever();noiseBurst(1.0,0.4);
  say('¡La máquina RUGE! Está fabricando… algo. El conducto norte se ha abierto. ¡Corre!');
  showToast('🏭 ¡MÁQUINA ACTIVADA! Conducto abierto al norte.');
  machineLeverMesh.rotation.z=0.7;
  setDoorOpen('vent',true);
  setStage(5);
  // despertar cameo: rugido lejano + parpadeo
  setTimeout(()=>{sfx.roar();say('¿Eso… ha sido una risa? Viene del conducto.');},2500);
  retractHands();
}
function closeExitDoor(){
  if(!state.chase){sfx.denied();return;}
  setDoorOpen('exit',false);
  // animar cierre instantáneo + victoria si el jugador está en zona segura
  state.chase=false;
  $('chase-warning').classList.add('hidden');
  showToast('🟢 ¡PORTÓN CERRADO! Mullido golpea al otro lado…');
  say('Golpes… arañazos… y luego silencio. Lo lograste.');
  setTimeout(win,1800);
  retractHands();
}

/* ---------------- INTERACT ---------------- */
let nearestInteract=null;
function tryInteract(){
  if(!state.running||state.paused||state.dead||state.won) return;
  if(nearestInteract&&nearestInteract.enabled()) nearestInteract.action();
}
function updateInteractables(){
  nearestInteract=null;let best=1e9;
  for(const it of interactables){
    if(!it.enabled()) continue;
    const d=camera.position.distanceTo(it.pos);
    if(d<it.radius&&d<best){best=d;nearestInteract=it;}
  }
  if(nearestInteract){tip.classList.remove('hidden');tip.textContent=`[E] ${nearestInteract.prompt}`;}
  else tip.classList.add('hidden');
}

/* ---------------- MOVIMIENTO + COLISIÓN ---------------- */
function collide(px,pz){
  const r=player.radius;
  for(const c of colliders){
    const nx=Math.max(c.x1,Math.min(px,c.x2));
    const nz=Math.max(c.z1,Math.min(pz,c.z2));
    const dx=px-nx,dz=pz-nz;
    const d2=dx*dx+dz*dz;
    if(d2<r*r){
      if(d2>1e-8){const d=Math.sqrt(d2);px=nx+dx/d*r;pz=nz+dz/d*r;}
      else{
        // centro dentro: empujar por el lado más cercano
        const l=px-c.x1,rr=c.x2-px,tt=pz-c.z1,bb=c.z2-pz;
        const m=Math.min(l,rr,tt,bb);
        if(m===l)px=c.x1-r;else if(m===rr)px=c.x2+r;else if(m===tt)pz=c.z1-r;else pz=c.z2+r;
      }
    }
  }
  return [px,pz];
}
let stepTimer=0;
function updatePlayer(dt){
  const k=player.keys;
  const sprint=(k['ShiftLeft']||k['ShiftRight'])&&player.stamina>0.05;
  const inVent=player.pos.x>3.4&&player.pos.x<6.6&&player.pos.z<-21&&player.pos.z>-31;
  const inChase=state.chase;
  let speed=sprint?player.sprint:player.walk;
  if(inVent)speed=2.2;
  if(sprint&&(k['KeyW']||k['KeyA']||k['KeyS']||k['KeyD']))player.stamina=Math.max(0,player.stamina-dt*0.28);
  else player.stamina=Math.min(1,player.stamina+dt*0.2);
  const f=(k['KeyW']?1:0)-(k['KeyS']?1:0);
  const s=(k['KeyD']?1:0)-(k['KeyA']?1:0);
  const sin=Math.sin(player.yaw),cos=Math.cos(player.yaw);
  let mx=(-sin*f+cos*s),mz=(-cos*f-sin*s);
  const ml=Math.hypot(mx,mz);
  if(ml>0){mx/=ml;mz/=ml;
    player.pos.x+=mx*speed*dt;player.pos.z+=mz*speed*dt;
    stepTimer-=dt*(sprint?1.7:1);
    if(stepTimer<=0){stepTimer=0.42;sfx.step();}
  }
  [player.pos.x,player.pos.z]=collide(player.pos.x,player.pos.z);
  // límites absolutos
  player.pos.x=Math.max(-19,Math.min(21,player.pos.x));
  player.pos.z=Math.max(-71,Math.min(8,player.pos.z));
  // altura cámara (conducto agachado)
  const targetY=inVent?0.9:1.7;
  player.pos.y+=(targetY-player.pos.y)*Math.min(1,dt*8);
  camera.position.copy(player.pos);
  camera.rotation.set(0,0,0);
  camera.rotateY(player.yaw);camera.rotateX(player.pitch);
  // linterna sigue mirada
  const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  flashTarget.position.copy(camera.position).addScaledVector(dir,6);
  // manos atadas a palancas: si jugador retrocede, acelerar tirón
  // zona segura salida
  if(state.chase&&player.pos.z<-67.5){
    objSub.textContent='¡Dispara a la PALANCA ROJA de la derecha para cerrar el portón!';
  }
  // inicio persecución al salir del conducto
  if(state.machineOn&&!state.chase&&!state.won&&player.pos.z<-31&&player.pos.z>-70&&state.stage>=5){
    startChase();
  }
  // muerte si Mullido toca
  if(state.chase&&monster.visible){
    const d=Math.hypot(monster.position.x-player.pos.x,monster.position.z-player.pos.z);
    if(d<1.6) die();
    // si llega a la salida sin cerrar -> Mullido lo alcanza igual salvo cierre rápido
    if(player.pos.z<-69&&d<6){/* tensión */}
  }
  // estrellas flotantes
  scene.traverse(o=>{if(o.userData.float){o.rotation.y+=dt*2;o.position.y=0.8+Math.sin(performance.now()/400)*0.12;}});
}

/* ---------------- PERSECUCIÓN ---------------- */
function startChase(){
  state.chase=true;state.chaseStart=performance.now();
  monster.visible=true;
  monster.position.set(5,0,-32);
  monsterState='chase';
  $('chase-warning').classList.remove('hidden');
  setStage(6);
  sfx.roar();
  say('¡ES MULLIDO! ¡CORRE AL FONDO Y CIERRA EL PORTÓN CON LA PALANCA ROJA!');
  showToast('⚠ ¡CORRE! No mires atrás. Esquiva las cajas. [Shift] para esprintar.');
  // cerrar conducto tras el jugador para que no vuelva
  setDoorOpen('vent',false);
}
function updateMonster(dt){
  if(!monster.visible) return;
  const u=monster.userData;u.phase+=dt*(state.chase?10:3);
  const wob=Math.sin(u.phase)*0.12;
  monster.rotation.y=Math.atan2(player.pos.x-monster.position.x,player.pos.z-monster.position.z);
  if(monsterState==='chase'){
    const dir=new THREE.Vector3(player.pos.x-monster.position.x,0,player.pos.z-monster.position.z);
    const d=dir.length();dir.normalize();
    // Mullido esquiva cajas de forma simple: sigue x del jugador con retardo
    const speed=5.4;
    let nx=monster.position.x+dir.x*speed*dt;
    let nz=monster.position.z+dir.z*speed*dt;
    // colisión simple con cajas: ignorar colliders de cajas pequeñas? las atraviesa con salto animado
    monster.position.x=nx;monster.position.z=nz;
    monster.position.y=Math.abs(Math.sin(u.phase))*0.25;
    u.aL.rotation.x=Math.sin(u.phase)*0.9;u.aR.rotation.x=-Math.sin(u.phase)*0.9;
    monster.scale.setScalar(1+wob*0.3);
    // rugidos periódicos
    if(Math.random()<dt*0.25)sfx.roar();
  }
  // parpadeo ojos
  monster.children.forEach(c=>{});
}

/* ---------------- PUERTAS anim ---------------- */
function updateDoors(dt){
  for(const id in doors){
    const d=doors[id];
    const target=d.open?1:0;
    d.anim+=(target-d.anim)*Math.min(1,dt*2.2);
    if(d.shutter) d.panel.position.y=d.h/2+(d.anim*d.h*0.95);
    else d.panel.position.x=d.x+(d.anim*(d.w*0.95));
    if(d.knob&&!d.open){d.knob.position.y=1.4+Math.sin(performance.now()/300)*0.03;}
  }
}

/* ---------------- LUCES / AMBIENTE ---------------- */
function updateAmbience(dt){
  const t=performance.now()/1000;
  if(!state.power){
    // parpadeo tétrico
    const f=(Math.sin(t*13)+Math.sin(t*7.3))>1.2?0.25:1;
    lamps.forEach((l,i)=>{l.light.intensity=(i%3===0?12:18)*f;});
  }
  if(grabPackTable?.userData.packSpin) grabPackTable.userData.packSpin.rotation.y+=dt*1.2;
  // mostrar viewmodel al tener pack
  if(window._vmL){window._vmL.visible=window._vmR.visible=state.hasPack;}
}

/* ---------------- LOOP ---------------- */
function loop(){
  requestAnimationFrame(loop);
  if(!renderer) return;
  const dt=Math.min(0.05,clock.getDelta());
  if(state.running&&!state.paused&&!state.dead&&!state.won){
    state.elapsed=(performance.now()-state.startTime)/1000;
    $('timer').textContent=fmtTime(state.elapsed);
    updatePlayer(dt);
    updateHands(dt);
    updateMonster(dt);
    updateDoors(dt);
    updateAmbience(dt);
    updateInteractables();
  }else{
    updateDoors(dt*0.5);
  }
  renderer.render(scene,camera);
}

/* ---------------- BOOT ---------------- */
initThree();
buildLevel();
bindInput();
setStage(0);
$('loading').style.display='none';
loop();
// captura automática lista: exponer estado para tests
window.__game={state,player,doors,startGame,setStage,fireHand,tryInteract,retractHands};
