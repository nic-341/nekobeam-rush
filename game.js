'use strict';
(() => {
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const ui = Object.fromEntries(['wave','progress','score','cats','beam','power','rate','ways','overlay','start','pause','notice','bossHud','bossBar','sound'].map(id=>[id,document.getElementById(id)]));
const W=1280,H=720, keys=new Set();
let state, last=0, sound=false, audio, drag=null;
// Explicit encounters keep each wave distinct and make enemy art replaceable.
const enemyTypes={
 normal:{name:'ネズミ',hp:1,size:1,speed:.085,damage:1,body:'#a49eae',face:'#bbb4c5'},
 armor:{name:'青よろい',hp:8,size:1.25,speed:.067,damage:2,body:'#397da9',face:'#74b9d5'},
 elite:{name:'赤よろい',hp:18,size:1.4,speed:.072,damage:2,body:'#b34e65',face:'#e98b96'},
 captain:{name:'ネズミ隊長',hp:360,size:2.3,speed:.065,damage:1,body:'#796092',face:'#b6a0cf'}
};
const encounters=[
 {normal:55,armor:0,elite:0,captains:0,interval:.08,group:1,title:'はじまりの丘'},
 {normal:38,armor:8,elite:0,captains:0,interval:.22,group:2,title:'青よろい出現！ 硬い敵に集中攻撃'},
 {normal:40,armor:8,elite:0,captains:1,interval:.23,group:2,title:'中ボス · ネズミ隊長が接近！'},
 {normal:44,armor:6,elite:8,captains:2,interval:.22,group:3,title:'中ボス2体！ 赤よろいにも注意'},
 {normal:50,armor:8,elite:12,captains:2,interval:.24,group:3,title:'最終決戦 · 混成軍団と巨大ロボ！'}
];
function makeLineup(config){
 const basic=Array(config.normal).fill('normal');
 for(const [type,count] of [['armor',config.armor],['elite',config.elite]])
  for(let i=0;i<count;i++)basic.splice(Math.floor((i+.5)*basic.length/count),0,type);
 for(let i=0;i<config.captains;i++)basic.splice(Math.floor(basic.length*(.22+i*.32)),0,'captain');
 return basic;
}
const lineups=encounters.map(makeLineup), waves=lineups.map(list=>list.length);
// Upgrade data is independent of rendering; signed changes can support risk gates later.
const upgrades={cats5:{label:'ネコ +5',sub:'仲間がふえる！',color:'#35bca1',apply:s=>s.cats+=5},beam:{label:'ビームLv +1',sub:'もっと強く、もっと派手に',color:'#ac80db',apply:s=>s.beam=Math.min(5,s.beam+1)},double:{label:'ネコ ×2',sub:'軍団を倍にしよう',color:'#35bca1',apply:s=>s.cats*=2},rapid:{label:'連射速度 UP',sub:'ビームの雨をふらせよう',color:'#f6a549',apply:s=>s.rate+=2},power:{label:'攻撃力 +3',sub:'一撃のパワーを強化',color:'#f6a549',apply:s=>s.power+=3},three:{label:'3WAYビーム',sub:'広がる3本のビーム',color:'#ac80db',apply:s=>s.extraWays=3},cats10:{label:'ネコ +10',sub:'決戦に向けて大集合！',color:'#35bca1',apply:s=>s.cats+=10}};
const gatePairs=[['cats5','beam'],['double','rapid'],['power','three'],['cats10','beam']];
const sideItems=[
 {label:'ネコ +1',color:'#35bca1',apply:s=>s.cats=Math.min(60,s.cats+1)},
 {label:'攻撃力 +1',color:'#f6a549',apply:s=>s.power++},
 {label:'連射 +1',color:'#ac80db',apply:s=>s.rate++}
];
function beginWindup(e){
 e.aimX=state.x;
 // One contested reward per wave arrives inside the telegraphed lane.
 if(state.riskItemWave!==state.wave){
  state.riskItemWave=state.wave;
  state.items.push({side:e.aimX<0?-1:1,targetX:e.aimX,z:.34,x:e.aimX,type:1,risky:true});
 }
}
function updateCaptain(e,dt){
 e.z=Math.max(.22,e.z-e.speed*dt);
 if(e.recovery>0){e.recovery=Math.max(0,e.recovery-dt);return;}
 if(e.z>.65)return;
 const previous=e.attack;e.attack+=dt;
 if(previous<2.2&&e.attack>=2.2)beginWindup(e);
 if(e.attack>=3.2){
  e.attack=0;e.recovery=2.4;e.strike=.2;
  if(Math.abs(state.x-(e.aimX??e.x))<.23)hurt(e.damage);
 }
}
function updateItems(dt){
 const s=state;
 if(s.phase!=='wave'){s.items=[];return;}
 if(s.itemWave!==s.wave&&s.phaseTime>=4.8){
  s.itemWave=s.wave;
  const front=s.enemies.filter(e=>e.hp>0).sort((a,b)=>a.z-b.z)[0];
  const side=front?(front.x<0?-1:1):(s.wave%2===0?-1:1);
  s.items.push({side,z:1,x:side*1.4,type:[0,1,0,2,0][s.wave]});
 }
 for(const item of s.items){
  item.z-=dt*.23;
  item.x=item.targetX===undefined?item.side*(.78+.62*clamp((item.z-.55)/.45,0,1)):item.targetX+(item.side*1.1-item.targetX)*clamp((item.z-.12)/.22,0,1);
  if(item.z<=.12&&item.z>=.025&&Math.abs(s.x-item.x)<.19){
   const upgrade=sideItems[item.type];upgrade.apply(s);s.maxCats=Math.max(s.maxCats,s.cats);
   s.history.push(upgrade.label);announce(upgrade.label,1.2);tone(1100,.12);item.collected=true;
  }
 }
 s.items=s.items.filter(item=>item.z>0&&!item.collected);
}
function drawItems(){
 for(const item of state.items){
  const p=project(item.x,item.z),upgrade=sideItems[item.type],scale=Math.max(.65,p.s);
  const y=p.y+Math.sin(state.time*5)*4;
  ellipse(p.x,p.y+13,38*scale,10*scale,'#31544425');
  ctx.fillStyle=item.risky?'#ef9961':upgrade.color;ctx.fillRect(p.x-65*scale,y-52*scale,130*scale,52*scale);
  ctx.fillStyle='#fffdf1';ctx.fillRect(p.x-61*scale,y-48*scale,122*scale,44*scale);
  text(upgrade.label,p.x,y-19*scale,20*scale,'#244c43');
 }
}
function fresh(){return {mode:'ready',paused:false,x:0,cats:1,maxCats:1,beam:1,power:1,rate:1,extraWays:1,hits:0,kills:0,time:0,scroll:0,wave:0,phase:'wave',phaseTime:0,spawned:0,spawnClock:0,shotClock:0,enemies:[],beams:[],effects:[],items:[],itemWave:-1,riskItemWave:-1,history:[],gate:null,boss:null,notice:0,shake:0};}
state=fresh();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ways=()=>Math.max(state.extraWays,state.beam>=3?3:state.beam>=2?2:1);
const damage=()=>state.power+2*(state.beam-1);
function start(){endDrag();state=fresh();state.mode='playing';ui.pause.textContent='Ⅱ';ui.overlay.classList.add('hidden');keys.clear();endDrag();announce('WAVE 1 · はじまりの丘',2);sync();}
ui.start.addEventListener('click',start);
function announce(t,seconds=2){ui.notice.textContent=t;state.notice=seconds;}
function tone(freq=520,duration=.06){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(freq/2,audio.currentTime+duration);g.gain.setValueAtTime(.025,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{sound=false;ui.sound.textContent='♪ SOUND OFF';}}
ui.sound.onclick=()=>{sound=!sound;ui.sound.textContent=sound?'♪ SOUND ON':'♪ SOUND OFF';tone();};
function pause(){if(state.mode!=='playing')return;state.paused=!state.paused;keys.clear();endDrag();ui.pause.textContent=state.paused?'▶':'Ⅱ';ui.notice.textContent=state.paused?'PAUSED · Pキー / ▶ で再開':'';}
ui.pause.onclick=pause;
window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','a','A','d','D','p','P',' '].includes(e.key))e.preventDefault();keys.add(e.key.toLowerCase());if(e.key.toLowerCase()==='p'&&!e.repeat)pause();});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>{keys.clear();if(state.mode==='playing'&&!state.paused)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing'&&!state.paused)pause();});
function endDrag(e){
 if(!drag||(e&&e.pointerId!==undefined&&e.pointerId!==drag.id))return;
 const id=drag.id;drag=null;
 if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerdown',e=>{
 if(state.mode!=='playing'||state.paused||drag||e.isPrimary===false||(e.pointerType==='mouse'&&e.button!==0))return;
 e.preventDefault();
 drag={id:e.pointerId,lastX:e.clientX};
 canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
 if(!drag||drag.id!==e.pointerId)return;
 if(e.buttons===0||state.mode!=='playing'||state.paused){endDrag(e);return;}
 e.preventDefault();movePointer(e);
});
for(const event of ['pointerup','pointercancel'])window.addEventListener(event,endDrag,true);
canvas.addEventListener('lostpointercapture',endDrag);
canvas.addEventListener('dragstart',e=>e.preventDefault());
window.addEventListener('blur',()=>endDrag());
window.addEventListener('resize',()=>endDrag());
function movePointer(e){
 const r=canvas.getBoundingClientRect();
 state.x=clamp(state.x+(e.clientX-drag.lastX)/r.width*2.6,-.85,.85);
 drag.lastX=e.clientX;
}
function project(x,z){const p=1-clamp(z,0,1);const t=p*p;return {x:640+x*(92+361*t),y:165+455*t,s:.24+1.0*t};}
function spawn(){
 const s=state,n=s.spawned++,type=lineups[s.wave][n],def=enemyTypes[type];
 const captainIndex=lineups[s.wave].slice(0,n).filter(t=>t==='captain').length;
 const hp=type==='captain'?def.hp+(s.wave-2)*140:def.hp;
 s.enemies.push({type,x:type==='captain'?(encounters[s.wave].captains===1?0:captainIndex===0?-.52:.52):Math.sin(n*2.399+s.wave)*.8,
  z:type==="captain"?.82:1.04+(n%3)*.025,hp,maxHp:hp,speed:type==='normal'&&s.wave===0?.073:def.speed,
  size:def.size,damage:def.damage,bob:n*2,hit:0,attack:0,recovery:0,strike:0});

}
function kill(e){state.kills++;const p=project(e.x,e.z);state.effects.push({type:'mouse',enemyType:e.type,x:p.x,y:p.y,s:p.s*e.size,life:.65,max:.65,vx:(Math.random()-.5)*130});for(let i=0;i<(e.type==='captain'?18:4);i++)state.effects.push({type:'spark',x:p.x,y:p.y,life:.4,max:.4,vx:(Math.random()-.5)*150,vy:-50-Math.random()*120});if(e.type==='captain'){state.shake=.15;}tone(380+Math.random()*250);}
function shoot(){const s=state;const targets=s.enemies.filter(e=>e.hp>0).sort((a,b)=>a.z-b.z);if(s.boss&&s.boss.hp>0)targets.push(s.boss);if(!targets.length)return;
 const count=Math.min(s.cats,30), pellets=ways();
 for(let c=0;c<count;c++){const origin=catPosition(c,count);for(let w=0;w<pellets;w++){const maxRange=.39+(pellets-1)*.19+s.beam*.025;const available=targets.filter(e=>e.hp>0&&Math.abs(e.x-s.x)<maxRange+(e===s.boss?.15:0));if(!available.length)continue;const e=available[(c+w)%available.length];const p=project(e.x,e.z);e.hp-=damage()*(e.type==="captain"?(e.recovery>0?2.5:.25):1);e.hit=.1;s.beams.push({x:origin.x,y:origin.y-24,tx:p.x+(Math.random()-.5)*12,ty:p.y-13,life:.14,max:.14,width:s.beam>=5?9:2+s.beam,color:s.beam>=3?'#b58aff':'#65faff'});if(e.hp<=0&&e!==s.boss)kill(e);}}
 tone(850,.045);
}
function catPosition(i,count){const cols=Math.min(7,Math.ceil(Math.sqrt(count*1.7))),row=Math.floor(i/cols),inRow=Math.min(cols,count-row*cols);return {x:640+state.x*390+(i%cols-(inRow-1)/2)*30,y:550+row*24};}
function nextGate(){state.phase='gate';state.phaseTime=0;state.gate={z:1,options:gatePairs[state.wave]};announce('',0);}
function selectGate(){const s=state,id=s.gate.options[s.x<=0?0:1],up=upgrades[id];up.apply(s);s.cats=Math.min(60,s.cats);s.maxCats=Math.max(s.maxCats,s.cats);s.history.push(up.label);s.gate=null;s.wave++;s.phase='wave';s.phaseTime=0;s.spawned=0;s.spawnClock=0;announce(up.label+'！',2);tone(1000,.2);if(s.wave===4){s.boss={x:0,z:.85,hp:Math.max(520,320+s.cats*40),maxHp:Math.max(520,320+s.cats*40),hit:0,attack:0};}}
function hurt(amount=1){state.hits+=amount;state.shake=.18;while(state.hits>=3&&state.cats>0){state.hits-=3;state.cats--;}if(state.cats===0)finish(false);else announce('突破された！ 残り耐久 '+(state.cats*3-state.hits),1.1);}
function finish(clear){if(state.mode!=='playing')return;endDrag();state.mode=clear?'clear':'over';state.paused=false;ui.pause.textContent='Ⅱ';keys.clear();ui.overlay.classList.remove('hidden');const elapsed=state.time.toFixed(1);ui.overlay.innerHTML='<div class="panel"><div class="eyebrow">'+(clear?'はじまりの丘、奪還成功！':'ネコたちの反撃は、ここから。')+'</div><h2>'+(clear?'STAGE CLEAR':'GAME OVER')+'</h2><div class="results"><div>倒したネズミ<strong>'+state.kills+' 匹</strong></div><div>最大ネコ人数<strong>'+state.maxCats+' 匹</strong></div><div>'+(clear?'クリアタイム':'プレイ時間')+'<strong>'+elapsed+' 秒</strong></div><div>取得した強化<strong>'+state.history.length+' 個</strong></div></div><p class="upgrades">'+(state.history.join(' / ')||'ゲートに到達して仲間を増やそう！')+'</p><button id="retry" class="primary">RETRY ↻</button></div>';document.getElementById('retry').onclick=start;}
function update(dt){const s=state;if(s.mode!=='playing'||s.paused)return;s.time+=dt;s.scroll+=dt;s.phaseTime+=dt;s.shake=Math.max(0,s.shake-dt);s.notice-=dt;if(s.notice<=0)ui.notice.textContent='';const direction=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0);s.x=clamp(s.x+direction*dt*1.4,-.85,.85);
 if(s.phase==='wave'){
 s.spawnClock-=dt;
 if(s.spawned<waves[s.wave]&&s.spawnClock<=0){const config=encounters[s.wave];for(let n=0;n<Math.min(config.group,s.cats)&&s.spawned<waves[s.wave];n++)spawn();s.spawnClock=config.interval;}
 for(const e of s.enemies){
  if(e.hp<=0)continue;
  e.hit=Math.max(0,e.hit-dt);
  if(e.type==='captain'){
   e.strike=Math.max(0,e.strike-dt);updateCaptain(e,dt);
  }else{e.z-=e.speed*dt;if(e.z<=.055){e.hp=0;hurt(e.damage);}}
  if(s.mode!=='playing')break;
 }
 if(s.mode!=='playing'){sync();return;}s.enemies=s.enemies.filter(e=>e.hp>0);s.shotClock-=dt;if(s.shotClock<=0){shoot();s.shotClock=Math.max(.09,.28/ (1+(s.rate-1)*.55+(s.beam-1)*.2));}s.enemies=s.enemies.filter(e=>e.hp>0);
 if(s.boss){s.boss.z=Math.max(.25,s.boss.z-dt*.028);s.boss.x=Math.sin(s.time*.45)*.48;s.boss.hit=Math.max(0,s.boss.hit-dt);if(s.boss.hp<=0&&s.enemies.length===0&&s.spawned===waves[s.wave]){finish(true);}else if(s.boss.hp>0&&s.boss.z<=.25){s.boss.attack+=dt;if(s.boss.attack>3.5){s.boss.attack=0;hurt(2);}}}
 else if(s.spawned===waves[s.wave]&&s.enemies.length===0)nextGate();
 }else if(s.phase==='gate'){s.gate.z-=dt*.17;if(s.gate.z<.12)selectGate();}
 if(s.mode==="playing")updateItems(dt);
 for(const b of s.beams)b.life-=dt;s.beams=s.beams.filter(b=>b.life>0);for(const e of s.effects){e.life-=dt;e.x+=e.vx*dt;e.y+=(e.vy||-100)*dt;}s.effects=s.effects.filter(e=>e.life>0);sync();}
function sync(){const s=state;ui.cats.textContent=s.cats;ui.beam.textContent=s.beam;ui.power.textContent=damage();ui.rate.textContent=s.rate;ui.ways.textContent=ways();ui.score.textContent=String(s.kills).padStart(3,'0');ui.wave.textContent=s.mode==='ready'?'READY?':s.wave===4?'FINAL WAVE':'WAVE '+(s.wave+1)+' / 5';ui.progress.style.width=(s.mode==='clear'?100:((s.wave+(s.phase==='gate'?.95:s.spawned/waves[s.wave]*.8))/5*100))+'%';ui.bossHud.classList.toggle('hidden',!s.boss||s.boss.hp<=0);if(s.boss){const hp=Math.max(0,s.boss.hp/s.boss.maxHp*100);ui.bossBar.style.width=hp+'%';}}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function poly(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function line(x,y,tx,ty,color,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();}
function text(t,x,y,size,color='#30594d'){ctx.fillStyle=color;ctx.font='900 '+size+'px "Yu Gothic",sans-serif';ctx.textAlign='center';ctx.fillText(t,x,y);}
// Sprite renderers are isolated here for a later swap to image assets.
function cat(x,y,s=1){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ellipse(0,12,21,7,'#314f3923');ellipse(0,0,15,19,'#e7ebe5');ellipse(-10,14,8,5,'#fffdf6');ellipse(10,14,8,5,'#fffdf6');poly([[-18,-11],[-17,-39],[-3,-27]],'#fffdf6');poly([[18,-11],[17,-39],[3,-27]],'#fffdf6');poly([[-14,-25],[-13,-34],[-6,-26]],'#e8a8ad');poly([[14,-25],[13,-34],[6,-26]],'#e8a8ad');ellipse(0,-17,20,17,'#fffdf6');poly([[0,-33],[11,-30],[5,-18]],'#a4b4b1');ellipse(-7,-17,2.4,3.4,'#385652');ellipse(7,-17,2.4,3.4,'#385652');ellipse(0,-10,2.5,1.8,'#e2999c');line(-19,-10,-11,-9,'#91a4a0',1);line(19,-10,11,-9,'#91a4a0',1);ellipse(-13,-9,3,2,'#f7d5c9');ellipse(13,-9,3,2,'#f7d5c9');ctx.restore();}
function mouse(x,y,s=1,dead=false,hit=false,type="normal"){const palette=enemyTypes[type];ctx.save();ctx.translate(x,y);ctx.scale(s,s);ellipse(0,14,22,6,'#36553725');ctx.strokeStyle='#a48f99';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(14,9);ctx.quadraticCurveTo(40,0,28,-12);ctx.stroke();ellipse(0,0,18,20,hit?'#fff':palette.body);ellipse(-16,-22,12,13,'#aaa3b5');ellipse(16,-22,12,13,'#aaa3b5');ellipse(-16,-22,7,8,'#e4b8bc');ellipse(16,-22,7,8,'#e4b8bc');ellipse(0,-12,20,17,hit?'#fff':palette.face);ellipse(0,-3,11,9,'#e2d6d4');for(const a of [-7,7]){if(dead){line(a-3,-15,a+3,-9,'#554c60',2);line(a+3,-15,a-3,-9,'#554c60',2);}else ellipse(a,-13,2.5,3.5,'#4e4658');}ellipse(0,-6,4,3,'#826274');ctx.fillStyle='#fff';ctx.fillRect(-3,1,6,5);if(type!=='normal'){poly([[-17,0],[0,5],[17,0],[14,16],[0,22],[-14,16]],palette.body);line(-10,10,10,10,'#ffe4ad',3);if(type==='captain'){poly([[-17,-30],[-20,-44],[-7,-37],[0,-49],[7,-37],[20,-44],[17,-30]],'#ffd16e');ellipse(0,-36,3,3,'#ed7d66');}else{line(-17,-21,17,-21,'#edf4ff',4);}}ctx.restore();}
function drawEnemy(e,p){
 if(e.type!=='captain'){
  mouse(p.x,p.y+Math.sin(state.time*9+e.bob)*3*p.s,p.s*e.size,false,e.hit>0,e.type);
  return;
 }
 const windup=e.recovery<=0?clamp(e.attack-2.2,0,1):0;
 const impact=clamp(e.strike/.2,0,1);
 const recovery=e.recovery>0&&impact===0;
 const lean=recovery?Math.sin((2.4-e.recovery)*10)*.12*(e.recovery/2.4):0;
 const x=p.x+(windup>0?Math.sin(state.time*45)*2*windup:0);
 const y=p.y+impact*42*p.s;
 ctx.save();ctx.translate(x,y);ctx.rotate(lean);
 ctx.scale(1+windup*.2-impact*.1,1-windup*.24+impact*.18);
 mouse(0,0,p.s*e.size,false,e.hit>0,e.type);
 if(e.recovery<=0){
  const shield=p.s*e.size;
  poly([[-19*shield,-9*shield],[0,-16*shield],[19*shield,-9*shield],[15*shield,11*shield],[0,21*shield],[-15*shield,11*shield]],'#688ea8');
  line(-10*shield,0,10*shield,0,'#d2f4ff',3*shield);
 }
 ctx.restore();
 if(windup>0){
  const size=35*p.s*(1+windup*.45);
  ctx.strokeStyle='#f09a66';ctx.lineWidth=3;
  ctx.beginPath();ctx.ellipse(p.x,p.y+15*p.s,size,size*.28,0,0,Math.PI*2);ctx.stroke();
 }
 if(impact>0){
  const target=640+(e.aimX??e.x)*390,expansion=1-impact;
  ctx.save();ctx.globalAlpha=impact;
  // Impact graphics use the locked attack lane; they do not alter hit timing.
  for(const offset of [-45,0,45])line(p.x+offset*p.s,p.y+5,target+offset,550,'#ffe3a3',5);
  ctx.strokeStyle='#ffb36c';ctx.lineWidth=8*impact+2;
  ctx.beginPath();ctx.ellipse(target,550,30+expansion*75,10+expansion*24,0,0,Math.PI*2);ctx.stroke();
  for(let i=0;i<6;i++){const angle=i*Math.PI/3;ellipse(target+Math.cos(angle)*(30+expansion*65),550+Math.sin(angle)*25,5*impact,5*impact,'#fff4ce');}
  ctx.restore();
 }
}
function enemyHealth(e,p){
 if(e.type==='normal')return;
 const captain=e.type==='captain',width=Math.max(captain?75:26,55*p.s*e.size),y=p.y-(captain?62:46)*p.s*e.size;
 ctx.fillStyle='#314655';ctx.fillRect(p.x-width/2-2,y-2,width+4,9);
 ctx.fillStyle=captain?(e.recovery>0?'#ffd566':'#ce90ed'):e.type==='elite'?'#f58c91':'#77d5ec';
 ctx.fillRect(p.x-width/2,y,width*clamp(e.hp/e.maxHp,0,1),5);
 if(captain){
  if(e.attack>=2.2||e.strike>0){const center=640+(e.aimX??e.x)*390;ctx.globalAlpha=e.strike>0?.65:.22+Math.sin(state.time*20)*.08;ctx.fillStyle='#ef6b64';ctx.fillRect(center-90,495,180,150);ctx.globalAlpha=1;}if(e.recovery>0){ellipse(p.x,p.y+10,42*p.s,12*p.s,'#ffdf7855');for(let i=0;i<3;i++){const a=state.time*3+i*2.094;ellipse(p.x+Math.cos(a)*30*p.s,y-14+Math.sin(a)*6,4,4,'#ffce4c');}}
 }
}
function robot(b){const p=project(b.x,b.z);ctx.save();ctx.translate(p.x,p.y-25);ctx.scale(p.s*2.9,p.s*2.9);ellipse(0,30,44,10,'#344b4433');ctx.fillStyle='#657487';ctx.fillRect(-30,-7,60,37);ctx.fillStyle='#c1cbd0';ctx.fillRect(-37,-43,74,48);ellipse(-32,-48,17,17,'#8898a7');ellipse(32,-48,17,17,'#8898a7');ellipse(-32,-48,9,9,'#efb0b2');ellipse(32,-48,9,9,'#efb0b2');ctx.fillStyle=b.hit>0?'white':'#435769';ctx.fillRect(-27,-32,54,19);ctx.fillStyle='#fd8594';ctx.fillRect(-22,-26,13,5);ctx.fillRect(9,-26,13,5);ellipse(0,-7,8,6,'#e2a676');ctx.fillStyle='#f1dfae';ctx.fillRect(-8,8,16,11);ctx.fillStyle='#495d6c';ctx.fillRect(-38,24,25,11);ctx.fillRect(13,24,25,11);ctx.restore();}
function background(){const sky=ctx.createLinearGradient(0,0,0,300);sky.addColorStop(0,'#ade5e7');sky.addColorStop(1,'#e9f4d7');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);ellipse(1020,88,35,35,'#fff4bc');for(const [x,y] of [[170,70],[530,55],[880,120]]){ellipse(x,y,50,10,'#ffffff90');ellipse(x+15,y-10,23,17,'#ffffff90');}ellipse(180,200,350,105,'#b9d6a0');ellipse(1120,190,360,105,'#a8cf98');ellipse(550,211,240,64,'#8fbc88');ctx.fillStyle='#9dc577';ctx.fillRect(0,205,W,515);poly([[539,170],[741,170],[1169,720],[111,720]],'#ebdca8');poly([[537,170],[548,170],[149,720],[102,720]],'#fff0c3');poly([[732,170],[743,170],[1178,720],[1131,720]],'#fff0c3');for(let i=0;i<16;i++){const z=1-((i/16+state.scroll*.055)%1),p=project(0,z);line(p.x-(92+361*(1-z)**2),p.y,p.x+(92+361*(1-z)**2),p.y,'#c9b78335',2);}
 for(let i=0;i<24;i++){const z=1-((i/24+state.scroll*.035)%1),side=i%2?1:-1,p=project(side*(1.23+(i%3)*.15),z);if(i%4===0){ctx.fillStyle='#947e58';ctx.fillRect(p.x-4*p.s,p.y-50*p.s,8*p.s,50*p.s);ellipse(p.x,p.y-65*p.s,30*p.s,34*p.s,'#669b66');ellipse(p.x-12*p.s,p.y-75*p.s,21*p.s,23*p.s,'#7aae70');}else if(i%5===0){ellipse(p.x,p.y,15*p.s,9*p.s,'#a7b1a0');}else{line(p.x,p.y,p.x-7*p.s,p.y-12*p.s,'#709d56',3*p.s);line(p.x,p.y,p.x+4*p.s,p.y-16*p.s,'#709d56',3*p.s);if(i%3===0)ellipse(p.x+4*p.s,p.y-16*p.s,3*p.s,3*p.s,'#fff4bd');}}
}
function drawGate(){
 const g=state.gate;if(!g)return;
 const selected=state.x<=0?0:1;
 const descriptions={cats5:'仲間を5匹追加',cats10:'仲間を10匹追加',double:'仲間の数が2倍',beam:'威力＋拡散アップ',rapid:'連射レベル +2',power:'一撃の威力アップ',three:'3方向に攻撃'};
 for(let i=0;i<2;i++){
  const id=g.options[i],up=upgrades[id],p=project(i===0?-.49:.49,g.z),active=i===selected;
  // A minimum scale preserves legibility without a separate screen-space panel.
  const scale=Math.max(.72,p.s),width=260*scale,height=132*scale;
  const x=640+(i===0?-1:1)*Math.max(Math.abs(p.x-640),width/2+10),bottom=p.y+35,top=bottom-height;
  ctx.fillStyle='#254d4630';ctx.fillRect(x-width/2+4,top+5,width,height);
  ctx.fillStyle=up.color;ctx.fillRect(x-width/2,top,width,height);
  const border=(active?7:3)*scale;
  ctx.fillStyle=active?'#fffef3':'#f3f6f1';ctx.fillRect(x-width/2+border,top+border,width-2*border,height-2*border);
  text(up.label,x,top+43*scale,28*scale,'#244c43');
  text(descriptions[id],x,top+75*scale,18*scale,'#476052');
  text(active?'✓':i===0?'←':'→',x,top+112*scale,28*scale,'#286b53');
 }
}
function render(){ctx.clearRect(0,0,W,H);ctx.save();if(state.shake>0)ctx.translate(Math.sin(state.time*150)*5,0);background();if(state.boss&&state.boss.hp>0)robot(state.boss);drawGate();drawItems();for(const e of [...state.enemies].sort((a,b)=>b.z-a.z)){const p=project(e.x,e.z);drawEnemy(e,p);enemyHealth(e,p);}for(const e of state.effects){ctx.globalAlpha=e.life/e.max;if(e.type==='mouse'){ctx.save();ctx.translate(e.x,e.y);ctx.rotate((1-e.life/e.max)*1.5);mouse(0,0,e.s,true,false,e.enemyType);ctx.restore();text('+1',e.x,e.y-38,16,'#ffffff');}else ellipse(e.x,e.y,7*e.life/e.max,7*e.life/e.max,'#fff9df');}ctx.globalAlpha=1;
 for(const b of state.beams){ctx.globalAlpha=b.life/b.max;line(b.x,b.y,b.tx,b.ty,b.color,b.width*3);line(b.x,b.y,b.tx,b.ty,'#fff',b.width);ellipse(b.tx,b.ty,7,7,'#fff');}ctx.globalAlpha=1;const count=Math.min(30,state.cats);for(let i=0;i<count;i++){const p=catPosition(i,count);cat(p.x,p.y+Math.sin(state.time*7+i)*1.4,.85);}if(state.cats>0){const p=catPosition(0,count);text('× '+state.cats,640+state.x*390,510,19,'#386b52');}ctx.restore();}
function frame(now){const dt=Math.min(.04,(now-last)/1000||0);last=now;update(dt);render();requestAnimationFrame(frame);}sync();requestAnimationFrame(frame);
})();

















