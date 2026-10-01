'use strict';
(() => {
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const ui = Object.fromEntries(['progress','score','cats','beam','power','rate','ways','overlay','start','pause','notice','bossHud','bossBar','sound'].map(id=>[id,document.getElementById(id)]));
let W=1280,H=720,portrait=false; const keys=new Set();
let state, last=0, sound=false, audio, drag=null;
const sprites={};
const spriteFrames={
 cat:{rects:[[164,84,355,493],[775,84,295,493],[204,673,359,493],[749,673,329,493]],anchors:[360,920,360,920],height:493,size:66},
 normal:{rects:[[124,108,441,471],[689,106,441,469],[120,681,445,467],[687,681,445,467]],anchors:[346,908,346,908],height:471,size:60}
};
if(typeof Image!=='undefined'){
 for(const [name,path] of Object.entries({cat:'assets/cat-rear-walk-v2.png',normal:'assets/mouse-walk-v2.png'})){
  const img=new Image();img.decoding='async';
  img.onload=()=>{sprites[name]=img;};
  // Keep the existing Canvas character if an asset is missing or unavailable.
  img.onerror=()=>{sprites[name]=null;};img.src=path;
 }
}
function spriteCharacter(name,x,y,scale,dead=false,hit=false,phase=0){
 const img=sprites[name];if(!img)return false;
 ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
 ellipse(0,14,22,6,'#36553725');
 const sheet=spriteFrames[name],frame=dead?1:Math.floor(state.time*8+phase)%4;
 const [sx,sy,sw,sh]=sheet.rects[frame],ratio=sheet.size/sheet.height;
 const width=sw*ratio,height=sh*ratio;
 if(hit)ctx.filter='brightness(1.6)';
 ctx.drawImage(img,sx,sy,sw,sh,(sx-sheet.anchors[frame])*ratio,17-height,width,height);ctx.filter='none';
 if(dead){
  for(const eye of [-8,8]){
   ellipse(eye,-16,3,3,'#b8b0ac');
   line(eye-2,-18,eye+2,-14,'#354350',1.5);line(eye+2,-18,eye-2,-14,'#354350',1.5);
  }
 }
 ctx.restore();return true;
}
function worldY(y){return portrait?y/720*H:y;}
function resizeScene(){
 const rect=canvas.getBoundingClientRect();
 const vertical=rect.height>rect.width;
 const width=vertical?720:1280,height=vertical?Math.round(720*rect.height/rect.width):720;
 if(width===W&&height===H)return;
 W=width;H=height;portrait=vertical;canvas.width=W;canvas.height=H;
 // Screen-space effects are transient; discard them after orientation changes.
 state.beams=[];state.effects=[];state.upgradeFX=[];endDrag();
}
// Explicit encounters keep each wave distinct and make enemy art replaceable.
const enemyTypes={
 normal:{name:'ネズミ',hp:1,size:1,speed:.085,damage:1,body:'#a49eae',face:'#bbb4c5'},
 armor:{name:'青よろい',hp:8,size:1.25,speed:.067,damage:2,body:'#397da9',face:'#74b9d5'},
 elite:{name:'赤よろい',hp:18,size:1.4,speed:.072,damage:2,body:'#b34e65',face:'#e98b96'},
 captain:{name:'ネズミ隊長',hp:360,size:2.3,speed:.065,damage:1,body:'#796092',face:'#b6a0cf'}
};
const encounters=[
 {normal:55,armor:0,elite:0,captains:0,interval:.08,group:1,title:'はじまりの丘'},
 {normal:46,armor:8,elite:0,captains:0,interval:.22,group:2,title:'青よろい出現！ 硬い敵に集中攻撃'},
 {normal:50,armor:8,elite:0,captains:1,interval:.23,group:2,title:'中ボス · ネズミ隊長が接近！'},
 {normal:56,armor:6,elite:8,captains:2,interval:.22,group:3,title:'中ボス2体！ 赤よろいにも注意'},
 {normal:64,armor:8,elite:12,captains:2,interval:.24,group:3,title:'最終決戦 · 混成軍団と巨大ロボ！'}
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
const upgradeThemes={cat:{color:'#dc8a22',light:'#fff2cf',ink:'#794418'},attack:{color:'#e05b67',light:'#ffeaeb',ink:'#902e43'},speed:{color:'#368dcc',light:'#e2f4ff',ink:'#215a8e'},beam:{color:'#9160d0',light:'#f0e8ff',ink:'#623496'}};
// icon is a renderer key; set iconImage to a loaded image to replace the vector art.
function upgrade(type,label,title,description,icon,apply,rare=false){return {type,label,title,description,icon,apply,rare,...upgradeThemes[type]};}
const upgrades={
 cats5:upgrade('cat','ネコ +5','+5','ネコが5匹増える','cat',s=>s.cats+=5),
 beam:upgrade('beam','ビームLv +1','Lv +1','ビームの威力・拡散UP','beam',s=>s.beam=Math.min(5,s.beam+1)),
 double:upgrade('cat','ネコ ×2','×2','ネコの人数が2倍','cat',s=>s.cats*=2),
 rapid:upgrade('speed','連射速度 UP','SPD +2','連射レベルが2上がる','speed',s=>s.rate+=2),
 power:upgrade('attack','攻撃力 +3','ATK +3','一撃の威力が3上がる','bolt',s=>s.power+=3),
 three:upgrade('beam','3WAYビーム','3WAY','3方向へ広がるビーム','spread',s=>s.extraWays=3),
 cats10:upgrade('cat','ネコ +10','+10','ネコが10匹増える','cat',s=>s.cats+=10,true)
};
const gatePairs=[['cats5','beam'],['double','rapid'],['power','three'],['cats10','beam']];
const sideItems=[
 upgrade('cat','ネコ +1','+1','仲間を追加','cat',s=>s.cats=Math.min(60,s.cats+1)),
 upgrade('attack','攻撃力 +1','ATK +1','ビームの威力UP','bolt',s=>s.power++),
 upgrade('speed','連射 +1','SPD +1','連射スピードUP','speed',s=>s.rate++)
];
// Shared by hit detection and warning graphics. Damage is in durability points (3 per cat).
const areaAttacks={captain:{radius:.36,minCats:1,fraction:.12},boss:{radius:.46,minCats:2,fraction:.20}};
function areaDamage(type){const a=areaAttacks[type];return Math.max(a.minCats,Math.ceil(state.cats*a.fraction))*3;}
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
  if(Math.abs(state.x-(e.aimX??e.x))<areaAttacks.captain.radius)hurt(areaDamage('captain'));
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
   const upgrade=sideItems[item.type],before=s.cats;upgrade.apply(s);upgradeFeedback(upgrade,project(item.x,item.z),s.cats-before,true);s.maxCats=Math.max(s.maxCats,s.cats);
   s.history.push(upgrade.label);announce(upgrade.label,1.2);tone(1100,.12);item.collected=true;
  }
 }
 s.items=s.items.filter(item=>item.z>0&&!item.collected);
}
function drawItems(){
 for(const item of state.items){
  const p=project(item.x,item.z),up=sideItems[item.type],scale=Math.max(.72,p.s);
  drawUpgradeCard(up,p.x,p.y-48*scale+Math.sin(state.time*5)*4,scale,Math.abs(state.x-item.x)<.19,true);
 }
}
function fresh(){return {mode:'ready',paused:false,x:0,cats:1,maxCats:1,beam:1,power:1,rate:1,extraWays:1,hits:0,kills:0,time:0,scroll:0,wave:0,phase:'wave',phaseTime:0,spawned:0,spawnClock:0,shotClock:0,enemies:[],beams:[],effects:[],upgradeFX:[],items:[],itemWave:-1,riskItemWave:-1,history:[],gate:null,boss:null,notice:0,shake:0};}
state=fresh();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ways=()=>Math.max(state.extraWays,state.beam>=3?3:state.beam>=2?2:1);
const damage=()=>state.power+2*(state.beam-1);
function start(){endDrag();state=fresh();state.mode='playing';ui.pause.textContent='Ⅱ';ui.overlay.classList.add('hidden');keys.clear();endDrag();announce('はじまりの丘',2);sync();}
ui.start.addEventListener('click',start);
function announce(t,seconds=2){ui.notice.textContent=t;state.notice=seconds;}
function tone(freq=520,duration=.06){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(freq/2,audio.currentTime+duration);g.gain.setValueAtTime(.025,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{sound=false;ui.sound.textContent='♪ SOUND OFF';}}
ui.sound.onclick=()=>{sound=!sound;ui.sound.textContent=sound?'♪ SOUND ON':'♪ SOUND OFF';tone();};
function pause(reason='manual'){if(state.mode!=='playing')return;state.paused=!state.paused;keys.clear();endDrag();ui.pause.textContent=state.paused?'▶':'Ⅱ';ui.notice.textContent=state.paused?(reason==='background'?'画面を離れたため一時停止 · ▶ で再開':'一時停止 · ▶ で再開'):'';}
ui.pause.onclick=()=>pause();
window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','a','A','d','D','p','P',' '].includes(e.key))e.preventDefault();keys.add(e.key.toLowerCase());if(e.key.toLowerCase()==='p'&&!e.repeat)pause();});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>{keys.clear();endDrag();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();endDrag();if(state.mode==='playing'&&!state.paused)pause('background');}});
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

window.addEventListener('resize',()=>endDrag());
function movePointer(e){
 const r=canvas.getBoundingClientRect();
 state.x=clamp(state.x+(e.clientX-drag.lastX)/r.width*2.6,-.85,.85);
 drag.lastX=e.clientX;
}
function project(x,z){const p=1-clamp(z,0,1);const t=p*p;return {x:W/2+x*(92+361*t)*(W/1280),y:worldY(165+455*t),s:.24+1.0*t};}
function spawn(wave=state.wave,n=state.spawned++){
 const s=state,type=lineups[wave][n],def=enemyTypes[type];
 const captainIndex=lineups[wave].slice(0,n).filter(t=>t==='captain').length;
 const hp=type==='captain'?def.hp+(wave-2)*140:def.hp;
 s.enemies.push({type,x:type==='captain'?(encounters[wave].captains===1?0:captainIndex===0?-.52:.52):Math.sin(n*2.399+wave)*.8,
  z:type==="captain"?.82:1.04+(n%3)*.025,hp,maxHp:hp,speed:type==='normal'&&wave===0?.073:def.speed,
  size:def.size,damage:def.damage,bob:n*2,hit:0,attack:0,recovery:0,strike:0});

}
function kill(e){state.kills++;if(e.type==='captain'){state.effects.push({type:'captainDefeat',x:0,y:0,vx:0,vy:0,enemy:{...e},life:1.35,max:1.35});state.shake=.2;tone(240,.3);return;}const p=project(e.x,e.z);state.effects.push({type:'mouse',enemyType:e.type,x:p.x,y:p.y,s:p.s*e.size,life:.65,max:.65,vx:(Math.random()-.5)*130});for(let i=0;i<(e.type==='captain'?18:4);i++)state.effects.push({type:'spark',x:p.x,y:p.y,life:.4,max:.4,vx:(Math.random()-.5)*150,vy:-50-Math.random()*120});if(e.type==='captain'){state.shake=.15;}tone(380+Math.random()*250);}
function shoot(){const s=state;const targets=s.enemies.filter(e=>e.hp>0).sort((a,b)=>a.z-b.z);if(s.boss&&s.boss.hp>0)targets.push(s.boss);if(!targets.length)return;
 const count=Math.min(s.cats,30), pellets=ways();
 for(let c=0;c<count;c++){const origin=catPosition(c,count);for(let w=0;w<pellets;w++){const maxRange=.39+(pellets-1)*.19+s.beam*.025;const available=targets.filter(e=>e.hp>0&&Math.abs(e.x-s.x)<maxRange+(e===s.boss?.15:0));if(!available.length)continue;const e=available[(c+w)%available.length];const p=project(e.x,e.z);e.hp-=damage()*(e===s.boss?(e.recovery>0?1.5:.3):e.type==="captain"?(e.recovery>0?2.5:.25):1);e.hit=.1;s.beams.push({x:origin.x,y:origin.y-24,tx:p.x+(Math.random()-.5)*12,ty:p.y-13,life:.14,max:.14,width:s.beam>=5?9:2+s.beam,color:s.beam>=3?'#b58aff':'#65faff'});if(e.hp<=0&&e!==s.boss)kill(e);}}
 tone(850,.045);
}
function catPosition(i,count){const cols=Math.min(7,Math.ceil(Math.sqrt(count*1.7))),row=Math.floor(i/cols),inRow=Math.min(cols,count-row*cols);return {x:W/2+state.x*390*(W/1280)+(i%cols-(inRow-1)/2)*30,y:worldY(550)+row*24};}
function nextGate(){state.phase='gate';state.phaseTime=0;state.gate={z:.85,options:gatePairs[state.wave],spawned:0,clock:.15};announce('',0);}
function selectGate(){const s=state,id=s.gate.options[s.x<=0?0:1],up=upgrades[id],before=s.cats,position=gatePosition(s.x<=0?0:1,s.gate.z);up.apply(s);s.cats=Math.min(60,s.cats);upgradeFeedback(up,position,s.cats-before,false);s.maxCats=Math.max(s.maxCats,s.cats);s.history.push(up.label);const advance=s.gate.spawned||0;s.gate=null;s.wave++;s.phase='wave';s.phaseTime=0;s.spawned=advance;s.spawnClock=0;announce(up.label+'！',2);tone(1000,.2);if(s.wave===4){s.boss={x:0,z:.85,hp:Math.max(1800,900+s.cats*70),maxHp:Math.max(1800,900+s.cats*70),hit:0,attack:0,recovery:0,aimX:null,strike:0};}}
function updateBoss(dt){
 const b=state.boss;if(b.hp<=0)return;
 b.z=Math.max(.3,b.z-dt*.028);b.hit=Math.max(0,b.hit-dt);b.strike=Math.max(0,b.strike-dt);
 if(b.recovery>0){b.recovery=Math.max(0,b.recovery-dt);return;}
 b.x=Math.sin(state.time*.45)*.48;
 if(b.z>.78)return;
 b.attack+=dt;const cycle=b.hp>b.maxHp*.5?3:2.3;
 if(b.attack>=cycle-1&&b.aimX===null)b.aimX=state.x;
 if(b.attack>=cycle){
  if(Math.abs(state.x-b.aimX)<areaAttacks.boss.radius)hurt(areaDamage('boss'));
  b.attack=0;b.recovery=2;b.strike=.25;b.impactX=b.aimX;b.aimX=null;
 }
}
function drawBossThreat(){
 const b=state.boss;if(!b||b.hp<=0)return;
 const p=project(b.x,b.z);
 if(b.recovery>0){ellipse(p.x,p.y-30,18*p.s,18*p.s,'#ffe29a');}
 else{line(p.x-70*p.s,p.y+8,p.x+70*p.s,p.y+8,'#81cfe3',8*p.s);}
 if(b.aimX!==null||b.strike>0){
  const center=W/2+(b.aimX??b.impactX)*390*(W/1280),half=areaAttacks.boss.radius*390*(W/1280);
  ctx.save();ctx.globalAlpha=b.strike>0?.65:.25+Math.sin(state.time*18)*.08;
  ctx.fillStyle='#ef6b64';ctx.fillRect(center-half,worldY(495),half*2,worldY(645)-worldY(495));
  if(b.strike>0)line(p.x,p.y,center,worldY(550),'#fff0ae',12);
  ctx.restore();
 }
}
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
 if(s.boss){updateBoss(dt);if(s.boss.hp<=0){if(s.boss.defeat===undefined){s.boss.defeat=0;state.shake=.35;tone(130,.5);}s.boss.defeat+=dt;if(s.boss.defeat>=2.1&&s.enemies.length===0&&s.spawned===waves[s.wave])finish(true);}}
 else if(s.spawned===waves[s.wave]&&s.enemies.length===0)nextGate();
 }else if(s.phase==='gate'){
  const gate=s.gate;gate.z-=dt*.32;gate.clock-=dt;
  if(gate.clock<=0&&gate.spawned<12){
   spawn(s.wave+1,gate.spawned++);gate.clock=.14;
   s.enemies[s.enemies.length-1].z=.72;
  }
  for(const e of s.enemies){e.z-=e.speed*dt;e.hit=Math.max(0,e.hit-dt);}
  s.shotClock-=dt;
  if(s.shotClock<=0){shoot();s.shotClock=Math.max(.09,.28/(1+(s.rate-1)*.55+(s.beam-1)*.2));}
  s.enemies=s.enemies.filter(e=>e.hp>0);
  if(gate.z<.12)selectGate();
 }
 if(s.mode==="playing")updateItems(dt);
 for(const b of s.beams)b.life-=dt;s.beams=s.beams.filter(b=>b.life>0);for(const e of s.effects){e.life-=dt;e.x+=e.vx*dt;e.y+=(e.vy||-100)*dt;}s.effects=s.effects.filter(e=>e.life>0);for(const f of s.upgradeFX)f.life-=dt;s.upgradeFX=s.upgradeFX.filter(f=>f.life>0);sync();}
function sync(){const s=state;ui.cats.textContent=s.cats;ui.beam.textContent=s.beam;ui.power.textContent=damage();ui.rate.textContent=s.rate;ui.ways.textContent=ways();ui.score.textContent=String(s.kills).padStart(3,'0');ui.progress.style.width=(s.mode==='clear'?100:((s.wave+(s.phase==='gate'?.95:s.spawned/waves[s.wave]*.8))/5*100))+'%';ui.bossHud.classList.toggle('hidden',!s.boss||s.boss.hp<=0);if(s.boss){const hp=Math.max(0,s.boss.hp/s.boss.maxHp*100);ui.bossBar.style.width=hp+'%';}}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function poly(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function line(x,y,tx,ty,color,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();}
function text(t,x,y,size,color='#30594d'){ctx.fillStyle=color;ctx.font='900 '+size+'px "Yu Gothic",sans-serif';ctx.textAlign='center';ctx.fillText(t,x,y);}
// Sprite renderers are isolated here for a later swap to image assets.
function cat(x,y,s=1,phase=0){
 if(spriteCharacter('cat',x,y,s,false,false,phase))return;
 const step=Math.sin(state.time*12+phase);
 ctx.save();ctx.translate(x,y);ctx.scale(s,s);
 ellipse(0,14,21,6,'#314f3923');ellipse(0,0,16,20,'#aab0b5');
 ellipse(-9,13+step*3,7,5,'#fffdf6');ellipse(9,13-step*3,7,5,'#fffdf6');
 poly([[-18,-15],[-16,-39],[-4,-27]],'#aab0b5');poly([[18,-15],[16,-39],[4,-27]],'#aab0b5');
 ellipse(0,-19,19,16,'#bdc1c5');
 for(const x of [-9,0,9])line(x,-31,x*.7,-22,'#737a84',3);
 line(-12,-4,12,-4,'#737a84',3);line(-12,3,12,3,'#737a84',3);
 line(0,11,step*9,-6,'#7e8791',7);ellipse(step*9,-6,4,4,'#fffdf6');ctx.restore();
}function mouse(x,y,s=1,dead=false,hit=false,type="normal",phase=0){if(type==="normal"&&spriteCharacter("normal",x,y,s,dead,hit,phase))return;const palette=enemyTypes[type];ctx.save();ctx.translate(x,y);ctx.scale(s,s);ellipse(0,14,22,6,'#36553725');ctx.strokeStyle='#a48f99';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(14,9);ctx.quadraticCurveTo(40,0,28,-12);ctx.stroke();ellipse(0,0,18,20,hit?'#fff':palette.body);ellipse(-16,-22,12,13,'#aaa3b5');ellipse(16,-22,12,13,'#aaa3b5');ellipse(-16,-22,7,8,'#e4b8bc');ellipse(16,-22,7,8,'#e4b8bc');ellipse(0,-12,20,17,hit?'#fff':palette.face);ellipse(0,-3,11,9,'#e2d6d4');for(const a of [-7,7]){if(dead){line(a-3,-15,a+3,-9,'#554c60',2);line(a+3,-15,a-3,-9,'#554c60',2);}else ellipse(a,-13,2.5,3.5,'#4e4658');}ellipse(0,-6,4,3,'#826274');ctx.fillStyle='#fff';ctx.fillRect(-3,1,6,5);if(type!=='normal'){poly([[-17,0],[0,5],[17,0],[14,16],[0,22],[-14,16]],palette.body);line(-10,10,10,10,'#ffe4ad',3);if(type==='captain'){poly([[-17,-30],[-20,-44],[-7,-37],[0,-49],[7,-37],[20,-44],[17,-30]],'#ffd16e');ellipse(0,-36,3,3,'#ed7d66');}else{line(-17,-21,17,-21,'#edf4ff',4);}}ctx.restore();}
function drawEnemy(e,p){
 if(e.type!=='captain'){
  mouse(p.x,p.y+Math.sin(state.time*9+e.bob)*3*p.s,p.s*e.size,false,e.hit>0,e.type,e.bob);
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
 captainArt(p.s*e.size,windup,impact,e.hit>0,false);
 ctx.restore();
 if(windup>0){
  const size=35*p.s*(1+windup*.45);
  ctx.strokeStyle='#f09a66';ctx.lineWidth=3;
  ctx.beginPath();ctx.ellipse(p.x,p.y+15*p.s,size,size*.28,0,0,Math.PI*2);ctx.stroke();
 }
 if(impact>0){
  const target=W/2+(e.aimX??e.x)*390*(W/1280),expansion=1-impact;
  ctx.save();ctx.globalAlpha=impact;
  // Impact graphics use the locked attack lane; they do not alter hit timing.
  for(const offset of [-45,0,45])line(p.x+offset*p.s,p.y+5,target+offset,worldY(550),'#ffe3a3',5);
  ctx.strokeStyle='#ffb36c';ctx.lineWidth=8*impact+2;
  ctx.beginPath();ctx.ellipse(target,worldY(550),30+expansion*75,10+expansion*24,0,0,Math.PI*2);ctx.stroke();
  for(let i=0;i<6;i++){const angle=i*Math.PI/3;ellipse(target+Math.cos(angle)*(30+expansion*65),worldY(550)+Math.sin(angle)*25,5*impact,5*impact,'#fff4ce');}
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
  if(e.attack>=2.2||e.strike>0){const center=W/2+(e.aimX??e.x)*390*(W/1280);ctx.globalAlpha=e.strike>0?.65:.22+Math.sin(state.time*20)*.08;ctx.fillStyle='#ef6b64';ctx.fillRect(center-areaAttacks.captain.radius*390*(W/1280),worldY(495),areaAttacks.captain.radius*780*(W/1280),worldY(645)-worldY(495));ctx.globalAlpha=1;}if(e.recovery>0){ellipse(p.x,p.y+10,42*p.s,12*p.s,'#ffdf7855');for(let i=0;i<3;i++){const a=state.time*3+i*2.094;ellipse(p.x+Math.cos(a)*30*p.s,y-14+Math.sin(a)*6,4,4,'#ffce4c');}}
 }
}
// Dedicated articulated boss art. Draw functions never change combat state.
function captainArt(scale,windup=0,impact=0,hit=false,dead=false){
 ctx.save();ctx.scale(scale,scale);ctx.lineJoin='round';ctx.lineCap='round';
 const step=dead?0:Math.sin(state.time*7)*2;
 ellipse(0,17,25,6,'#36444d30');
 poly([[-15,-19],[15,-19],[23,16],[0,10],[-23,16]],'#8052a0');
 rounded(-17,9+step,13,9,4,'#56687d');rounded(4,9-step,13,9,4,'#56687d');
 rounded(-20,-19,40,32,10,hit?'#fff':'#94afc3','#43566e',2);
 rounded(-12,-8,24,15,5,'#d9e6e8');line(-8,0,8,0,'#dab15c',3);
 for(const x of [-17,17]){ellipse(x,-35,12,12,'#abb6c0');ellipse(x,-35,7,7,'#e8c7c3');}
 ellipse(0,-25,21,19,hit?'#fff':'#c9d0d3');ellipse(0,-18,12,8,'#f2eee1');
 for(const x of [-7,7]){if(dead){line(x-3,-29,x+3,-23,'#4a5362',2);line(x+3,-29,x-3,-23,'#4a5362',2);}else ellipse(x,-26,2,3,'#404a59');}
 ellipse(0,-20,3,2,'#7e777f');
 rounded(-20,-44,40,10,4,'#567f9e','#354e65',2);poly([[-8,-44],[0,-56],[8,-44]],'#e7bc5e');
 // Raised hammer follows the same one-second windup as the attack warning.
 ctx.save();ctx.translate(24,-9-windup*17);ctx.rotate(-windup*.55+impact*1.25);line(0,8,10,-28,'#80654f',5);rounded(-5,-39,32,18,5,'#9ab3c7','#40586e',2);line(1,-35,20,-35,'#e1f3f4',3);ellipse(0,5,7,7,'#c7cdd0');ctx.restore();
 if(!dead){poly([[-31,-13],[-12,-17],[-8,1],[-22,17],[-36,2]],'#4b87ae');line(-25,-10,-20,8,'#c8eff0',3);line(-31,-1,-15,-3,'#c8eff0',3);}
 ctx.restore();
}
function robotArt(scale,charge=0,slam=0,hit=false,death=0){
 ctx.save();ctx.scale(scale,scale);ctx.lineJoin='round';ctx.lineCap='round';
 const broken=death>0,split=Math.max(0,death-.6)*32,step=broken?0:Math.sin(state.time*5)*2;
 ellipse(0,35,54,11,'#344b4433');
 for(const side of [-1,1]){
  ctx.save();ctx.translate(side*(26+split),25+side*step+split*.3);ctx.rotate(side*death*.35);rounded(-17,-9,34,20,6,'#566d83','#344c63',3);line(-10,3,10,3,'#a9c5d2',3);ctx.restore();
  ctx.save();ctx.translate(side*(48+split),-13-charge*22+slam*34+split*.5);ctx.rotate(side*(charge*.45+death*.7));rounded(-12,-13,24,34,8,'#8ca9bc','#354e69',3);rounded(-17,9,34,27,8,hit?'#fff':'#bacfda','#354e69',3);line(-10,19,10,19,'#f1ce76',4);ctx.restore();
 }
 rounded(-37,-26,74,60,16,hit?'#fff':'#6d91aa','#344d65',3);rounded(-27,-16,54,38,10,'#c7dae0');
 ellipse(0,2,14,14,'#456a86');ellipse(0,2,10+charge*3,10+charge*3,broken?'#8998a1':charge>0?'#ffbd71':'#79f4ec');ellipse(-3,-2,4,4,'#ffffffaa');
 ctx.save();ctx.translate(Math.sin(state.time*45)*charge*2,-split*.6);ctx.rotate(broken?Math.sin(death*16)*.1:0);
 for(const side of [-1,1]){ellipse(side*32,-51,19,19,'#728fa6');ellipse(side*32,-51,12,12,'#b6cdda');ellipse(side*32,-51,7,7,'#e9c0bd');}
 rounded(-38,-56,76,39,13,hit?'#fff':'#c9dce2','#3d5872',3);rounded(-29,-45,58,18,7,'#3f586e');
 for(const x of [-15,15]){if(broken){line(x-5,-41,x+5,-31,'#f3c57c',3);line(x+5,-41,x-5,-31,'#f3c57c',3);}else rounded(x-6,-39,12,6,3,charge>0?'#ffba71':'#93f0e9');}
 ellipse(0,-20,7,5,'#b08c91');rounded(-7,-14,14,9,2,'#fff1d5');line(0,-14,0,-5,'#a5b7bb',1);ctx.restore();ctx.restore();
}
function defeatClouds(x,y,scale,age){
 ctx.save();ctx.globalAlpha=clamp(1-(age-.5)/1.5,0,1);
 for(let i=0;i<9;i++){const a=i*2.4,r=(15+age*48)*scale;ellipse(x+Math.cos(a)*r,y+Math.sin(a)*r*.5-age*22*scale,(8+age*9)*scale,(7+age*8)*scale,i%2?'#fff8e8':'#dae5e4');}
 for(let i=0;i<6;i++){const a=i*Math.PI/3+age,r=(25+age*65)*scale;const sx=x+Math.cos(a)*r,sy=y+Math.sin(a)*r*.55-age*40;line(sx-5,sy,sx+5,sy,'#efbd58',3);line(sx,sy-5,sx,sy+5,'#efbd58',3);}
 ctx.restore();
}
function captainDefeat(f){
 const p=project(f.enemy.x,f.enemy.z),age=f.max-f.life;
 ctx.save();ctx.globalAlpha=Math.min(1,f.life*3);ctx.translate(p.x+Math.sin(age*8)*15,p.y-Math.sin(Math.min(1,age)*Math.PI)*65);ctx.rotate(age*1.5);captainArt(p.s*f.enemy.size,0,0,false,true);ctx.restore();
 defeatClouds(p.x,p.y,p.s,age);text('+1',p.x,p.y-age*65-50,20,'#fff');
}
function robot(b){
 const p=project(b.x,b.z),age=b.defeat||0,cycle=b.hp>b.maxHp*.5?3:2.3;
 const charge=b.hp>0&&b.aimX!==null?clamp(b.attack-(cycle-1),0,1):0,slam=clamp(b.strike/.25,0,1);
 ctx.save();ctx.translate(p.x,p.y-25+slam*15);if(age)ctx.globalAlpha=clamp((2.1-age)/.8,0,1);robotArt(p.s*2.9,charge,slam,b.hit>0,age);ctx.restore();
 if(age>.3)defeatClouds(p.x,p.y-35,p.s*2,age-.3);
}
// Layered scenery: sky and mountains drift slowly; roadside objects advance faster.
function sceneryPoint(z){
 const depth=1-clamp(z,0,1),y=worldY(165)+(H-worldY(165))*depth*depth;
 return {y,s:.2+depth*1.15,edge:W*(.085+.38*depth*depth)};
}
function roadside(kind,x,y,s,phase){
 ctx.save();ctx.translate(x,y);ctx.scale(s,s);
 const sway=Math.sin(state.scroll*2+phase)*2.5;
 if(kind==='tree'){
  ellipse(0,4,27,7,'#567c5c20');
  ctx.fillStyle='#a69973';ctx.fillRect(-4,-52,8,54);
  ellipse(sway,-66,26,32,'#91b27d');ellipse(sway-10,-74,20,23,'#a3bf88');
  ellipse(sway+13,-64,18,24,'#87aa76');
 }else if(kind==='rock'){
  ellipse(0,2,19,5,'#567c5c18');poly([[-18,0],[-13,-15],[1,-21],[16,-12],[20,0]],'#b3b9a2');
  poly([[-13,-15],[1,-21],[7,-13],[-7,-8]],'#cbd0b9');
 }else if(kind==='sign'){
  ctx.fillStyle='#a89a78';ctx.fillRect(-3,-31,6,33);
  poly([[-20,-46],[14,-46],[24,-35],[14,-24],[-20,-24]],'#c9b488');
  line(-10,-35,10,-35,'#8b9172',3);line(5,-40,10,-35,'#8b9172',3);
 }else{
  for(let j=-1;j<=1;j++)line(j*5,0,j*8+sway,-12-Math.abs(j)*4,'#93af76',2);
  if(kind==='flower'){
   const fx=sway,fy=-19;
   line(0,0,fx,fy,'#8ba777',2);
   for(let j=0;j<5;j++){const a=j*Math.PI*2/5;ellipse(fx+Math.cos(a)*4,fy+Math.sin(a)*4,3,3,phase%2?'#f3e8c4':'#e8d2c9');}
   ellipse(fx,fy,2.5,2.5,'#d9bc76');
  }
 }
 ctx.restore();
}
function background(){
 const horizon=worldY(165),t=state.scroll;
 const sky=ctx.createLinearGradient(0,0,0,horizon+80);
 sky.addColorStop(0,'#8fcce7');sky.addColorStop(1,'#e8f1da');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 ellipse(W*.82,worldY(73),29,29,'#fff1c5');
 // Far layer: airy clouds and hazy blue mountains.
 for(let i=0;i<5;i++){
  const x=((i*.24+t*.0018)%1.24-.12)*W,y=worldY(54+(i%3)*22),s=.6+(i%2)*.25;
  ellipse(x,y,62*s,12*s,'#f9fcf0');ellipse(x-20*s,y-10*s,25*s,20*s,'#f9fcf0');ellipse(x+15*s,y-17*s,29*s,23*s,'#f9fcf0');
 }
 const drift=Math.sin(t*.014)*W*.006;
 poly([[-W*.1,horizon+20],[W*.08+drift,horizon-worldY(57)],[W*.24+drift,horizon-12],[W*.37+drift,horizon-worldY(38)],[W*.52,horizon+24]],'#b0cbd1');
 poly([[W*.43,horizon+22],[W*.65+drift,horizon-worldY(46)],[W*.76,horizon-18],[W*.9+drift,horizon-worldY(65)],[W*1.1,horizon+22]],'#b7cfd0');
 // Mid layer: low hills, with a small distant castle echoing the main game's world.
 const hillDrift=Math.sin(t*.023)*W*.009;
 ellipse(W*.09+hillDrift,horizon+30,W*.37,worldY(70),'#b5c99a');
 ellipse(W*.88+hillDrift,horizon+27,W*.38,worldY(63),'#afc493');
 ctx.save();ctx.translate(W*.86+hillDrift,horizon-worldY(27));ctx.fillStyle='#d1d6ba';
 ctx.fillRect(-12,-20,24,22);ctx.fillRect(-17,-30,8,33);ctx.fillRect(9,-34,8,37);
 poly([[-19,-30],[-13,-40],[-7,-30]],'#94b2bb');poly([[7,-34],[13,-45],[19,-34]],'#94b2bb');ctx.restore();
 const grass=ctx.createLinearGradient(0,horizon,0,H);grass.addColorStop(0,'#b0c690');grass.addColorStop(1,'#a2bd83');
 ctx.fillStyle=grass;ctx.fillRect(0,horizon+12,W,H-horizon);
 // A slightly wider, quiet central road. No props inside its edges.
 const road=ctx.createLinearGradient(0,horizon,0,H);road.addColorStop(0,'#e8dfbc');road.addColorStop(1,'#dfcea3');
 ctx.fillStyle=road;ctx.beginPath();ctx.moveTo(W*.415,horizon);ctx.lineTo(W*.585,horizon);ctx.lineTo(W*.965,H);ctx.lineTo(W*.035,H);ctx.closePath();ctx.fill();
 line(W*.415,horizon,W*.035,H,'#efe5c0',5);line(W*.585,horizon,W*.965,H,'#efe5c0',5);
 // Ground layer: sparse streaks and stones, never a distracting grid.
 for(let i=0;i<22;i++){
  const z=1-((i/22+t*.082)%1),p=sceneryPoint(z),lane=Math.sin(i*2.4)*.8,x=W/2+lane*p.edge;
  ellipse(x,p.y,(i%4===0?4:10)*p.s,1.5*p.s,i%4===0?'#c6bb9a60':'#bba78022');
 }
 // Mid trees drift more slowly than the low foreground grass and flowers.
 const props=[];
 for(let i=0;i<12;i++){
  const p=sceneryPoint(1-((i/12+t*.034)%1));
  props.push({...p,x:W/2+(i%2?1:-1)*(p.edge+37*p.s),kind:i%5===0?'sign':i%3===0?'rock':'tree',phase:i});
 }
 for(let i=0;i<30;i++){
  const p=sceneryPoint(1-((i/30+t*.073)%1));
  props.push({...p,x:W/2+(i%2?1:-1)*(p.edge+(12+(i%3)*11)*p.s),kind:i%4===0?'rock':i%3===0?'flower':'grass',phase:i});
 }
 for(const p of props.sort((a,b)=>a.y-b.y))roadside(p.kind,p.x,p.y,p.s,p.phase);
}

function rounded(x,y,w,h,r,fill,stroke,width=2){
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
}
function upgradeIcon(up,x,y,size){
 ctx.save();ctx.translate(x,y);ctx.scale(size/50,size/50);
 if(up.iconImage){ctx.drawImage(up.iconImage,-25,-25,50,50);ctx.restore();return;}
 ctx.lineCap='round';ctx.lineJoin='round';
 if(up.icon==='cat'){
  ctx.beginPath();ctx.moveTo(-22,10);ctx.lineTo(-23,-23);ctx.lineTo(-9,-14);ctx.quadraticCurveTo(0,-18,9,-14);ctx.lineTo(23,-23);ctx.lineTo(22,10);ctx.quadraticCurveTo(0,31,-22,10);ctx.fillStyle='#fffdf5';ctx.fill();ctx.strokeStyle=up.ink;ctx.lineWidth=3;ctx.stroke();
  ellipse(-8,1,2,3,up.ink);ellipse(8,1,2,3,up.ink);line(-3,10,0,12,up.ink,2);line(0,12,3,10,up.ink,2);
 }else if(up.icon==='bolt'){
  ctx.beginPath();ctx.moveTo(5,-26);ctx.lineTo(-19,4);ctx.lineTo(-2,4);ctx.lineTo(-7,26);ctx.lineTo(21,-7);ctx.lineTo(5,-7);ctx.closePath();ctx.fillStyle=up.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();
 }else{
  const spread=up.icon==='spread';
  for(let i=-1;i<=1;i++){const x=i*15;line(spread?0:x,22,x,-18,up.color,7);line(x,-18,x-6,-10,up.color,4);line(x,-18,x+6,-10,up.color,4);if(up.icon==='speed')line(x,28,x,34,up.color,3);}
 }
 ctx.restore();
}
function drawUpgradeCard(up,x,y,scale,active,compact=false,flash=0){
 const pulse=active?1.035+Math.sin(state.time*7)*.008:1;
 ctx.save();ctx.translate(x,y);ctx.scale(scale*pulse,scale*pulse);
 const w=compact?164:270,h=compact?146:218,top=-h/2;
 ctx.shadowColor=active?up.color+'99':'#30493c40';ctx.shadowBlur=active?22:8;ctx.shadowOffsetY=7;
 rounded(-w/2,top,w,h,20,up.light,up.rare?'#eabc42':up.color,active?5:3);ctx.shadowBlur=0;ctx.shadowOffsetY=0;
 rounded(-w/2+7,top+7,w-14,h-14,15,'#ffffff45','#ffffffaa',2);
 rounded(-w/2+12,top+12,w-24,compact?24:29,10,up.color);
 const category={cat:'ネコ増加',attack:'攻撃力',speed:'連射速度',beam:'特殊ビーム'}[up.type];
 text(up.rare?'★ '+category:category,0,top+(compact?29:33),compact?15:18,'#fff');
 const iy=top+(compact?64:82);ellipse(0,iy,compact?23:33,compact?23:33,'#ffffffcc');upgradeIcon(up,0,iy,compact?32:45);
 text(up.title,0,top+(compact?111:159),compact?25:42,up.ink);
 text(up.description,0,top+(compact?133:189),compact?13:18,up.ink);
 if(active&&!compact){rounded(-58,top+h-7,116,27,13,up.color,'#fff',2);text('✓ 選択中',0,top+h+12,16,'#fff');}
 if(flash>0){ctx.globalAlpha=flash*.6;rounded(-w/2,top,w,h,20,'#fff');}
 ctx.restore();
}
function gatePosition(i,z){
 const p=project(i===0?-.49:.49,z),scale=Math.max(.88,p.s);
 return {x:W/2+(i===0?-1:1)*Math.max(Math.abs(p.x-W/2),146*scale),y:Math.max(205,p.y-55*scale),s:scale};
}
function drawGate(){
 const g=state.gate;if(!g)return;
 for(let i=0;i<2;i++){const p=gatePosition(i,g.z);drawUpgradeCard(upgrades[g.options[i]],p.x,p.y,p.s,i===(state.x<=0?0:1));}
}
function upgradeFeedback(up,p,cats,compact){
 state.upgradeFX.push({up,x:p.x,y:p.y,s:p.s||1,compact,cats:Math.min(10,Math.max(0,cats)),life:1.05});
 tone(1320,.16);
}
function drawUpgradeFeedback(){
 for(const f of state.upgradeFX){
  const age=1.05-f.life,alpha=Math.min(1,f.life*3);ctx.save();ctx.globalAlpha=alpha;
  if(age<.4)drawUpgradeCard(f.up,f.x,f.y-age*60,f.s*(1+age*.3),true,f.compact,1-age/.4);
  for(let i=0;i<12;i++){const a=i*Math.PI/6,dist=25+age*150,x=f.x+Math.cos(a)*dist,y=f.y+Math.sin(a)*dist-age*65;line(x-5,y,x+5,y,f.up.color,3);line(x,y-5,x,y+5,'#fff',3);}
  for(let i=0;i<f.cats;i++)upgradeIcon(f.up,f.x+(i-(f.cats-1)/2)*29,f.y-50-age*150+Math.sin(i*2)*18,25);
  if(!f.cats)for(let i=-1;i<=1;i++)line(f.x+i*22,f.y-age*160+30,f.x+i*45,f.y-age*160-70,f.up.color,6);
  ctx.restore();
 }
}
function render(){ctx.clearRect(0,0,W,H);ctx.save();if(state.shake>0)ctx.translate(Math.sin(state.time*150)*5,0);background();if(state.boss&&(state.boss.hp>0||(state.boss.defeat||0)<2.1))robot(state.boss);drawBossThreat();for(const e of [...state.enemies].sort((a,b)=>b.z-a.z)){const p=project(e.x,e.z);drawEnemy(e,p);enemyHealth(e,p);}for(const e of state.effects){ctx.globalAlpha=e.life/e.max;if(e.type==='captainDefeat'){ctx.globalAlpha=1;captainDefeat(e);}else if(e.type==='mouse'){ctx.save();ctx.translate(e.x,e.y);ctx.rotate((1-e.life/e.max)*1.5);mouse(0,0,e.s,true,false,e.enemyType);ctx.restore();text('+1',e.x,e.y-38,16,'#ffffff');}else ellipse(e.x,e.y,7*e.life/e.max,7*e.life/e.max,'#fff9df');}ctx.globalAlpha=1;
 for(const b of state.beams){ctx.globalAlpha=b.life/b.max;line(b.x,b.y,b.tx,b.ty,b.color,b.width*3);line(b.x,b.y,b.tx,b.ty,'#fff',b.width);ellipse(b.tx,b.ty,7,7,'#fff');}ctx.globalAlpha=1;drawGate();drawItems();drawUpgradeFeedback();const count=Math.min(30,state.cats);for(let i=0;i<count;i++){const p=catPosition(i,count);cat(p.x,p.y,.85,i*.73);}if(state.cats>0){const p=catPosition(0,count);text('× '+state.cats,W/2+state.x*390*(W/1280),worldY(510),portrait?26:19,'#386b52');}ctx.restore();}
function frame(now){resizeScene();const dt=Math.min(.04,(now-last)/1000||0);last=now;update(dt);render();requestAnimationFrame(frame);}sync();requestAnimationFrame(frame);
})();

























