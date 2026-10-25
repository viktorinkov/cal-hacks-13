const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/band3d-BF-b5LGk.js","assets/BufferGeometryUtils-XdL_VI7S.js","assets/rolldown-runtime-XKyaHtl9.js"])))=>i.map(i=>d[i]);
import{t as e}from"./preload-helper-CFijIu3R.js";function t(e){let t=e.textContent??``;return e.textContent=``,[...t].map(t=>{let n=document.createElement(`span`);return n.className=`ch`,n.textContent=t,e.append(n),n})}function n(e){let t=e.querySelector(`.title-name`),n=e.querySelector(`.title-line`);if(!t||!n)return;n.style.fontSize=``;let r=t.getBoundingClientRect().width,i=n.getBoundingClientRect().width;if(!r||!i)return;let a=parseFloat(getComputedStyle(n).fontSize);n.style.fontSize=`${a*r/i}px`}function r(e){let n=[...e.querySelectorAll(`[data-type]`)].map(e=>e.textContent?.trim()).join(`. `);e.setAttribute(`aria-label`,n);let r=[...e.querySelectorAll(`[data-type]`)];return r.forEach(e=>e.setAttribute(`aria-hidden`,`true`)),r.map(t)}async function i(e,t,n){let r=!1,i=null,a=()=>{r||(r=!0,i?.())},o=e=>new Promise(t=>{if(r)return t();let n=window.setTimeout(a,e);function a(){window.clearTimeout(n),i=null,t()}i=a}),s=[`keydown`,`pointerdown`,`wheel`,`touchstart`];s.forEach(e=>window.addEventListener(e,a,{passive:!0,once:!0}));let c=t.flat();c.forEach(e=>e.classList.add(`is-off`));let l=document.createElement(`span`);l.className=`caret is-typing`,l.setAttribute(`aria-hidden`,`true`),e.append(l);let u=(e,t)=>{let n=e.parentElement,r=parseFloat(getComputedStyle(n).fontSize);l.style.fontSize=`${r}px`,l.style.left=`${e.offsetLeft+(t?e.offsetWidth:0)+r*.04}px`,l.style.top=`${n.offsetTop+r*.08}px`,l.style.height=`${r*.72}px`},d=e.getBoundingClientRect(),f=e.closest(`[data-stage]`).getBoundingClientRect(),p=parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--m`))||24,m=Math.max(1,Math.min((f.width-p*2)/d.width,f.height*.8/d.height,2.4)),h=f.top+(f.height-d.height*m)/2-d.top;e.style.transform=`translate3d(0, ${h.toFixed(1)}px, 0) scale(${m.toFixed(4)})`,e.classList.add(`is-ready`),u(c[0],!1),await o(380);for(let e=0;e<t.length;e++){for(let i of t[e]){if(r)break;i.classList.remove(`is-off`),u(i,!0),i.textContent!==` `&&n.onKey();let t=e===0?92:i.textContent===` `?70:36;await o(t+(Math.random()-.5)*t*.5)}e<t.length-1&&!r&&(l.classList.remove(`is-typing`),await o(240),l.classList.add(`is-typing`),u(t[e+1][0],!1),await o(60))}c.forEach(e=>e.classList.remove(`is-off`)),l.classList.remove(`is-typing`),u(c[c.length-1],!0),await o(r?0:300),s.forEach(e=>window.removeEventListener(e,a)),n.onRise(),l.animate([{opacity:1},{opacity:0}],{duration:260,fill:`forwards`}).finished.then(()=>l.remove()),e.classList.add(`is-rising`),e.style.transform=``,await new Promise(e=>window.setTimeout(e,r?260:460)),n.onStrike(),await new Promise(e=>window.setTimeout(e,800)),e.classList.remove(`is-rising`),n.onDone()}var a={width:624,height:803,center:[188.1,307.4],step:2,count:12,pitch:30,phase:11.24,inner:[[292.2,296.6],[292.9,300.2],[293.7,304],[294.3,307.8],[294.8,311.8],[295.2,315.8],[295.5,319.9],[295.6,324.2],[295.7,328.5],[295.6,332.9],[295.3,337.4],[294.9,342],[294.3,346.7],[293.6,351.4],[292.6,356.3],[291.5,361.1],[290.2,366],[288.6,371],[286.9,375.9],[284.9,380.9],[282.7,385.8],[280.2,390.7],[277.5,395.6],[274.6,400.4],[271.5,405.1],[268.1,409.6],[264.6,414.1],[260.8,418.4],[256.8,422.5],[252.6,426.5],[248.3,430.2],[243.8,433.8],[239.1,437.1],[234.3,440.1],[229.4,442.9],[224.4,445.5],[219.3,447.8],[214.2,449.8],[209,451.6],[203.8,453.1],[198.6,454.3],[193.4,455.3],[188.2,456],[183.1,456.5],[177.9,456.7],[172.9,456.7],[167.9,456.5],[163,456],[158.2,455.4],[153.4,454.5],[148.8,453.5],[144.3,452.2],[139.8,450.8],[135.5,449.2],[131.3,447.5],[127.2,445.6],[123.2,443.6],[119.4,441.4],[115.6,439.1],[112,436.7],[108.5,434.2],[105.1,431.5],[101.8,428.8],[98.6,425.9],[95.6,423],[92.7,420],[89.8,416.8],[87.2,413.6],[84.6,410.3],[82.1,406.9],[79.8,403.5],[77.5,399.9],[75.4,396.3],[73.4,392.7],[71.5,388.9],[69.8,385.1],[68.1,381.2],[66.6,377.3],[65.2,373.2],[63.9,369.2],[62.8,365],[61.7,360.8],[60.9,356.6],[60.1,352.3],[59.5,347.9],[59,343.5],[58.6,339.1],[58.4,334.6],[58.4,330.1],[58.5,325.5],[58.7,320.9],[59.1,316.2],[59.7,311.6],[60.4,306.9],[61.3,302.3],[62.4,297.6],[63.6,292.9],[65,288.3],[66.6,283.6],[68.4,279],[70.3,274.5],[72.5,270],[74.8,265.5],[77.2,261.2],[79.9,256.9],[82.7,252.7],[85.7,248.7],[88.8,244.7],[92.1,240.9],[95.6,237.2],[99.1,233.7],[102.8,230.3],[106.6,227.2],[110.5,224.1],[114.5,221.3],[118.5,218.7],[122.7,216.2],[126.8,214],[131,211.9],[135.2,210],[139.5,208.3],[143.7,206.9],[148,205.6],[152.2,204.5],[156.4,203.5],[160.5,202.8],[164.6,202.2],[168.7,201.7],[172.7,201.4],[176.6,201.3],[180.4,201.3],[184.2,201.4],[187.9,201.7],[191.6,202.1],[195.2,202.6],[198.6,203.2],[202.1,203.8],[205.4,204.6],[208.6,205.5],[211.8,206.4],[214.9,207.5],[217.9,208.6],[220.9,209.8],[223.8,211],[226.6,212.3],[229.3,213.7],[232,215.1],[234.6,216.6],[237.2,218.1],[239.7,219.7],[242.1,221.3],[244.4,223],[246.8,224.8],[249,226.6],[251.3,228.4],[253.4,230.3],[255.5,232.2],[257.6,234.2],[259.6,236.2],[261.6,238.3],[263.5,240.5],[265.4,242.6],[267.3,244.9],[269.1,247.2],[270.8,249.5],[272.5,251.9],[274.2,254.4],[275.8,256.9],[277.4,259.6],[278.9,262.2],[280.4,264.9],[281.8,267.7],[283.2,270.6],[284.6,273.6],[285.8,276.6],[287,279.7],[288.2,282.9],[289.3,286.2],[290.3,289.6],[291.3,293]],outer:[[326.6,293],[326.8,297.9],[326.9,302.9],[326.9,307.9],[326.6,313],[326.3,318.2],[325.8,323.4],[325.1,328.7],[324.2,334.1],[323.2,339.4],[322,344.9],[320.6,350.3],[319,355.8],[317.2,361.3],[315.3,366.8],[313.1,372.3],[310.7,377.8],[308.2,383.3],[305.4,388.8],[302.4,394.2],[299.2,399.6],[295.8,404.9],[292.2,410.1],[288.5,415.2],[284.5,420.2],[280.3,425.1],[275.9,429.9],[271.4,434.6],[266.6,439],[261.8,443.4],[256.7,447.5],[251.5,451.4],[246.2,455.1],[240.7,458.6],[235.2,461.9],[229.5,465],[223.8,467.8],[217.9,470.4],[212.1,472.7],[206.1,474.7],[200.2,476.5],[194.2,478],[188.2,479.3],[182.2,480.3],[176.3,481],[170.4,481.5],[164.5,481.7],[158.7,481.6],[152.9,481.3],[147.3,480.8],[141.7,480],[136.2,479],[130.8,477.7],[125.5,476.2],[120.4,474.6],[115.3,472.6],[110.4,470.6],[105.6,468.2],[101,465.8],[96.5,463.1],[92.1,460.3],[87.9,457.3],[83.8,454.1],[79.9,450.8],[76.1,447.3],[72.5,443.7],[69.1,440],[65.8,436.1],[62.6,432.1],[59.6,428],[56.8,423.8],[54.1,419.5],[51.6,415.1],[49.3,410.6],[47.1,406],[45.1,401.3],[43.2,396.5],[41.5,391.7],[40,386.7],[38.6,381.7],[37.5,376.7],[36.4,371.6],[35.5,366.4],[34.9,361.1],[34.3,355.9],[34,350.5],[33.8,345.2],[33.7,339.8],[33.9,334.3],[34.2,328.9],[34.7,323.4],[35.4,317.9],[36.2,312.4],[37.3,306.9],[38.5,301.3],[39.9,295.8],[41.4,290.3],[43.2,284.9],[45.1,279.4],[47.2,274],[49.5,268.6],[51.9,263.3],[54.5,258.1],[57.3,252.9],[60.3,247.8],[63.4,242.7],[66.7,237.8],[70.2,232.9],[73.8,228.2],[77.6,223.6],[81.5,219.1],[85.5,214.7],[89.7,210.5],[94,206.4],[98.4,202.5],[102.9,198.8],[107.6,195.2],[112.3,191.8],[117.1,188.6],[122,185.6],[126.9,182.7],[131.9,180.1],[137,177.6],[142.1,175.4],[147.2,173.3],[152.3,171.5],[157.4,169.8],[162.6,168.4],[167.7,167.2],[172.8,166.1],[177.9,165.3],[182.9,164.6],[187.9,164.1],[192.9,163.9],[197.8,163.8],[202.6,163.8],[207.4,164.1],[212.1,164.5],[216.8,165.1],[221.3,165.9],[225.8,166.8],[230.2,167.8],[234.6,169.1],[238.8,170.4],[242.9,171.9],[247,173.5],[251,175.2],[254.8,177.1],[258.6,179.1],[262.3,181.2],[265.9,183.4],[269.4,185.8],[272.8,188.2],[276.1,190.8],[279.3,193.4],[282.4,196.1],[285.4,199],[288.3,201.9],[291.1,204.9],[293.8,208.1],[296.4,211.3],[298.9,214.6],[301.4,218],[303.7,221.4],[305.9,225],[308,228.6],[310.1,232.3],[312,236.2],[313.8,240.1],[315.5,244],[317.1,248.1],[318.6,252.2],[319.9,256.4],[321.2,260.7],[322.3,265.1],[323.4,269.6],[324.2,274.1],[325,278.7],[325.7,283.4],[326.2,288.1]]},o=[1,.42,.64],s=[.36,.7,1],c=[.34,.95,.72],l=[1,.68,.38],u=[.36,.95,.47],d=[1,.11,.09],f=[1,.97,.93],p=[.82,.92,1],m=[o,s,c,l],h=performance.now();function ee(e){h=e}function te(e){return(e-h)/1e3*(124/60)}function g(e){let t=e-Math.floor(e);return Math.exp(-t*5)}function _(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}var v=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)};function y(e){let t=Math.floor(e/4),n=v(3.5,4,e-t*4),r=[];for(let e=0;e<4;e++)r.push(_(b(t+e),b(t+e+1),n));return r}function b(e){return m[(e%4+4)%4]}var x=a.count,S=2.2,C={inner:a.inner,outer:a.outer};function w(e,t){let n=(t%360+360)%360/a.step,r=Math.floor(n)%e.length,i=(r+1)%e.length,o=n-Math.floor(n);return[e[r][0]+(e[i][0]-e[r][0])*o,e[r][1]+(e[i][1]-e[r][1])*o]}function T(e,t){let n=w(C.inner,e),r=w(C.outer,e);return[n[0]+(r[0]-n[0])*t,n[1]+(r[1]-n[1])*t]}function ne(e,t,n,r){let i=a.phase+e*a.pitch+r,o=a.phase+(e+1)*a.pitch-r,s=new Path2D;for(let e=0;e<=12;e++){let[t,r]=T(i+(o-i)*e/12,n);e===0?s.moveTo(t,r):s.lineTo(t,r)}for(let e=12;e>=0;e--){let[n,r]=T(i+(o-i)*e/12,t);s.lineTo(n,r)}return s.closePath(),s}var re=Array.from({length:x},(e,t)=>ne(t,.02,.98,S)),ie=Array.from({length:x},(e,t)=>ne(t,.3,.72,6.2)),E=Array.from({length:x},(e,t)=>{let[n,r]=T(a.phase+(t+.5)*a.pitch,.5);return Math.atan2(r-a.center[1],n-a.center[0])*180/Math.PI}),D=(e,t)=>Math.abs(((e-t)%360+540)%360-180),O=e=>Math.exp(-e*e);function ae(e){let t=e-Math.floor(e);return+(t<.09||t>.18&&t<.27||t>.36&&t<.45)}var k=(e,t)=>`rgba(${Math.round(Math.min(1,e[0])*255)},${Math.round(Math.min(1,e[1])*255)},${Math.round(Math.min(1,e[2])*255)},${Math.max(0,Math.min(1,t)).toFixed(3)})`,oe=class{canvas;ctx;level=new Float32Array(x);colour=Array.from({length:x},()=>f);last=0;lastBuzz=-1;glow;onBuzz;mode=`off`;modeAt=0;after=null;aim=-50;rotation=0;spin=0;spinPhase=0;beatGlow=0;calm=!1;headless=!1;get levels(){return this.level}get colours(){return this.colour}constructor(e,t={}){this.canvas=e;let n=e.getContext(`2d`);if(!n)throw Error(`2d context`);this.ctx=n,this.glow=t.glow??.045,this.onBuzz=t.onBuzz,this.resize()}resize(){let e=this.canvas.getBoundingClientRect(),t=this.canvas.offsetWidth||e.width,n=this.canvas.offsetHeight||e.height,r=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(t*r)),this.canvas.height=Math.max(1,Math.round(n*r))}set(e,t=performance.now(),n){this.mode=e,this.modeAt=t,this.lastBuzz=-1,this.after=n?{mode:n.mode,at:t+n.after}:null}frame(e){if(this.after&&e>=this.after.at){let t=this.after.mode;this.after=null,this.set(t,e)}let t=this.last?Math.min(.1,(e-this.last)/1e3):1;this.last=e;let n=(e-this.modeAt)/1e3,r=this.calm?.5:te(e),i=new Float32Array(x),a=Array.from({length:x},()=>f),o=e=>e-this.rotation;switch(this.mode){case`off`:break;case`boot`:for(let e=0;e<x;e++){let t=((E[e]+90)%360+360)%360,r=n*1e3>t/360*520;i[e]=r?Math.max(.25,1-Math.max(0,n-.6)*1.4):0,a[e]=f}break;case`compass`:case`away`:{let e=o(this.aim),t=this.mode===`away`?40:50;for(let n=0;n<x;n++){let r=Math.max(0,1-D(E[n],e)/t);i[n]=r**1.25,a[n]=u}break}case`breathe`:{let e=this.calm?.3:.24+.14*Math.sin(n*1.7);for(let t=0;t<x;t++)i[t]=e,a[t]=f;break}case`alert`:{let e=this.calm?1:ae(n),t=Math.floor(n);!this.calm&&t!==this.lastBuzz&&(this.lastBuzz=t,this.onBuzz?.());for(let t=0;t<x;t++)i[t]=e,a[t]=d;break}case`exit`:{let e=o(this.aim),t=180*(1-(this.calm?.7:n/1.05%1));for(let n=0;n<x;n++){let r=D(E[n],e),o=O((r-t)/22),s=O(r/26)*.9;i[n]=Math.max(o,s),a[n]=u}break}case`lane`:{let e=o(this.aim),t=this.calm?1:.8+.2*Math.sin(n*7);for(let n=0;n<x;n++){let r=Math.min(D(E[n],e+90),D(E[n],e-90));i[n]=Math.max(0,1-r/42)*t,a[n]=p}break}}if(this.beatGlow>0&&!this.calm&&(this.mode===`compass`||this.mode===`breathe`)){let e=y(r),t=g(r)*this.beatGlow;for(let n=0;n<x;n++){let o=t*(.22+.2*((n+Math.floor(r))%3==0));o>i[n]&&(a[n]=_(a[n],e[n%4],Math.min(1,(o-i[n])*3)),i[n]=o)}}if(this.spin>.02&&this.mode===`compass`){this.spinPhase+=this.spin*t*900;for(let e=0;e<x;e++){let t=this.spin*O(D(E[e],this.spinPhase)/38);t>i[e]*.8&&(a[e]=_(a[e],f,Math.min(1,t*1.5)),i[e]=Math.max(i[e],t))}}for(let e=0;e<x;e++){let n=i[e]>this.level[e],r=this.mode===`alert`?40:n?16:7;this.level[e]+=(i[e]-this.level[e])*(1-Math.exp(-t*r)),this.colour[e]=i[e]>.01?_(this.colour[e],a[e],1-Math.exp(-t*14)):this.colour[e]}this.headless||this.draw()}draw(){let{ctx:e,canvas:t}=this;e.setTransform(1,0,0,1,0,0),e.clearRect(0,0,t.width,t.height);let n=t.width/a.width,r=t.height/a.height;e.setTransform(n,0,0,r,0,0);let i=t.width*this.glow;for(let t=0;t<x;t++){let n=this.level[t];if(n<.01)continue;let r=this.colour[t];e.globalCompositeOperation=`source-over`,e.shadowColor=k(r,Math.min(1,n*1.1)),e.shadowBlur=i*(.5+.5*n),e.fillStyle=k(_(r,f,.12),.94*Math.min(1,n*1.15)),e.fill(re[t]),e.shadowBlur=0,e.globalCompositeOperation=`lighter`,e.fillStyle=k(f,.4*n),e.fill(ie[t])}e.globalCompositeOperation=`source-over`}};function se(e){return{x:e.left+e.width*(a.center[0]/a.width),y:e.top+e.height*(a.center[1]/a.height),r:e.width*.29}}var ce=`#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,le=`#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;
uniform float uOn;
uniform float uSpot;
uniform float uKey;
uniform float uBoost;
uniform float uCalm;
uniform float uScale;
uniform float uHorizon;
uniform vec3 uFace;
uniform vec3 uPtr;
uniform vec3 uPal[4];
uniform vec4 uRip[12];
uniform vec3 uRipC[12];
uniform vec4 uFall;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float W = uRes.x;
  float H = uRes.y;
  float S = uScale;
  float t = uTime;
  float moving = 1.0 - uCalm;
  vec2 uv = p / H;

  float h1 = fbm(uv * vec2(1.5, 2.3) + vec2(t * 0.018, -t * 0.03) * moving);
  float h2 = fbm(uv * 4.2 - vec2(t * 0.045, t * 0.012) * moving);
  float haze = 0.22 + 0.78 * h1 * (0.65 + 0.7 * h2);

  float ph = fract(uBeat);
  float env = exp(-ph * 5.0) * moving;
  float down = 1.0 - step(0.5, mod(floor(uBeat), 4.0));
  float pulse = 0.36 + 1.3 * env * (0.72 + 0.55 * down) + uBoost * 0.9;

  vec3 col = vec3(0.0);

  // Moving heads on a truss above the stage.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 o = vec2(W * (0.08 + 0.168 * fi), -0.05 * H);
    float sweep = sin(t * 0.37 + fi * 1.9) * 0.36 + sin(t * 0.13 + fi * 0.7) * 0.16;
    float a = 1.5708 + (2.5 - fi) * 0.17 + sweep * moving;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 d = p - o;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = along * 0.075 + 7.0 * S;
    float q = across * across / (w * w);
    float reach = smoothstep(0.0, 30.0 * S, along) * smoothstep(H * 1.4, H * 0.1, along);
    float beam = exp(-q * 1.6) * reach;
    float core = exp(-q * 14.0) * reach;
    float alt = mod(fi, 2.0) < 0.5 ? 1.0 : 0.35 + 0.65 * step(0.5, mod(floor(uBeat), 2.0));
    col += uPal[i % 4] * (beam * (0.25 + 0.9 * haze) + core * 0.4) * pulse * alt * 0.95 * uOn;
  }

  // Uplights along the front of the stage, fanning out on the off-beats.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 o = vec2(W * (0.2 + 0.2 * fi), uHorizon + 0.02 * H);
    float a = -1.5708 + (fi - 1.5) * 0.34 + sin(t * 0.5 + fi * 2.3) * 0.22 * moving;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 d = p - o;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = along * 0.05 + 4.0 * S;
    float q = across * across / (w * w);
    float beam = exp(-q * 2.0) * smoothstep(0.0, 20.0 * S, along) * smoothstep(H * 0.9, 0.0, along);
    float off = exp(-fract(uBeat + 0.5) * 6.0) * moving;
    col += uPal[(i + 2) % 4] * beam * (0.2 + 0.8 * haze) * (0.18 + 0.9 * off) * 0.7 * uOn;
  }

  // Wash of light along the back of the stage, and a flash through the haze on the downbeat.
  float wash = exp(-pow((p.y - uHorizon) / (0.12 * H), 2.0));
  col += uPal[1] * wash * haze * (0.05 + 0.3 * env * down) * uOn;
  col += vec3(0.9, 0.92, 1.0) * haze * haze * env * down * 0.14 * uOn;

  // The follow spot on the headliner.
  vec2 so = vec2(uFace.x + 0.05 * W, -0.5 * H);
  vec2 toF = uFace.xy - so;
  float dist = length(toF);
  vec2 sd = toF / dist;
  vec2 d2 = p - so;
  float al = dot(d2, sd);
  float ac = abs(d2.x * sd.y - d2.y * sd.x);
  float cr = uFace.z * 1.2 * (al / dist);
  float cone = smoothstep(cr, cr * 0.55, ac) * step(0.0, al) * smoothstep(dist * 1.7, dist * 0.95, al);
  float pool = exp(-pow(length(p - uFace.xy) / (uFace.z * 1.7), 2.0));
  vec3 warm = vec3(1.0, 0.93, 0.82);
  col += warm * uSpot * (cone * (0.06 + 0.17 * haze) + pool * 0.4);

  // A hand-held light that follows the pointer through the haze.
  vec2 pd = (p - uPtr.xy) / (S * 210.0);
  col += uPal[0] * uPtr.z * exp(-dot(pd, pd)) * (0.05 + 0.2 * haze) * (0.35 + 0.65 * uOn);

  // Ripples left by the pointer.
  vec3 rip = vec3(0.0);
  for (int k = 0; k < 12; k++) {
    vec4 r = uRip[k];
    float age = t - r.z;
    if (age < 0.0 || age > 2.6) continue;
    vec2 dd = (p - r.xy) * vec2(1.0, 1.6);
    float rad = (age * 340.0 + 8.0) * S * r.w;
    float wid = (14.0 + age * 34.0) * S * r.w;
    float x = (length(dd) - rad) / wid;
    rip += uRipC[k] * exp(-x * x) * exp(-age * 1.55);
  }
  col += rip * (0.08 + 0.3 * haze);

  // Someone falls.
  float fallAge = t - uFall.z;
  float fallOn = uFall.w * step(0.0, fallAge);
  float R = 118.0 * S;
  float fp = fract(fallAge);
  float sos = step(fp, 0.09) + step(0.18, fp) * step(fp, 0.27) + step(0.36, fp) * step(fp, 0.45);
  float alertOn = fallOn * (1.0 - step(3.0, fallAge));
  float guideOn = fallOn * smoothstep(1.0, 1.4, fallAge) * (1.0 - smoothstep(5.4, 6.4, fallAge));
  vec2 fd = (p - uFall.xy) * vec2(1.0, 2.0);
  float fr = length(fd);
  vec3 red = vec3(1.0, 0.1, 0.08);
  col += red * exp(-pow((fr - fallAge * 600.0 * S) / (26.0 * S), 2.0)) * exp(-fallAge * 1.5) * fallOn * 0.5;
  col += red * alertOn * sos * exp(-pow(fr / (R * 1.5), 2.0)) * 0.3;

  // The crowd: a field of bands in perspective.
  float hy = uHorizon;
  if (p.y > hy - 6.0 * S) {
    vec2 qp = p;
    vec2 fq = qp - uFall.xy;
    float frq = length(fq * vec2(1.0, 2.0));
    float back = 30.0 * S * fallOn * smoothstep(0.15, 1.0, fallAge) * (1.0 - smoothstep(4.8, 6.6, fallAge))
      * exp(-pow(frq / (R * 1.7), 2.0));
    qp -= normalize(fq + vec2(0.001)) * back;

    float span = H - hy;
    float v = clamp((qp.y - hy) / span, 0.0, 1.0);
    const float N = 32.0;
    float j0 = floor(sqrt(v) * N);
    vec3 dots = vec3(0.0);
    for (int dj = -1; dj <= 1; dj++) {
      float j = j0 + float(dj);
      if (j < 0.0) continue;
      float sj = (j + 0.5) / N;
      float rowY = hy + sj * sj * span;
      float dy = 2.0 * sj * span / N;
      float dx = max(dy * 1.35, 5.5 * S);
      float rad = max(dy * 0.15, 0.9 * S);
      float far = 0.3 + 0.7 * smoothstep(0.05, 0.7, sj);
      float i0 = floor((qp.x - W * 0.5) / dx);
      for (int di = -1; di <= 1; di++) {
        vec2 cell = vec2(i0 + float(di), j);
        float a1 = hash12(cell + 0.37);
        float a2 = hash12(cell + 7.1);
        float a3 = hash12(cell + 19.3);
        vec2 c = vec2(W * 0.5 + (cell.x + 0.5 + (a1 - 0.5) * 0.8) * dx, rowY + (a2 - 0.5) * dy * 0.7);
        c.x += sin(t * (0.7 + a3) + a1 * 30.0) * dx * 0.12 * moving;
        c.y -= env * uOn * dy * 0.4 * (0.5 + a3);
        float dd = length(qp - c);
        float lit = smoothstep(rad + 1.0 * S, rad - 0.6 * S, dd) + exp(-dd / (rad * 2.2)) * 0.32;
        if (lit < 0.003) continue;
        float twinkle = pow(max(0.0, sin(t * (0.5 + a3 * 0.9) * moving + a2 * 50.0)), 14.0);
        float idle = (0.055 + 0.6 * twinkle + uKey * 0.55 * step(0.55, a1)) * far;
        float flash = step(0.6, hash12(cell + floor(uBeat) * 1.31)) * env;
        float wave = pow(max(0.0, sin((c.x / W) * 6.2832 - uBeat * 1.5708 + sj * 2.0)), 10.0) * moving;
        vec3 tint = mix(vec3(0.82, 0.86, 1.0), uPal[int(a3 * 3.99)], uOn);
        vec3 cc = tint * (idle + uOn * far * (0.05 + flash * 1.5 + wave * 1.0 + uBoost * 0.6));
        cc += rip * 3.4;
        float frc = length((c - uFall.xy) * vec2(1.0, 2.0));
        float inside = smoothstep(R * 1.05, R * 0.85, frc);
        float around = smoothstep(R * 0.95, R * 1.15, frc) * smoothstep(R * 2.9, R * 2.1, frc);
        float chase = pow(0.5 + 0.5 * sin(frc / (15.0 * S) - fallAge * 10.0), 3.0);
        cc = mix(cc, red * 2.4 * sos, inside * alertOn);
        cc = mix(cc, vec3(0.3, 1.0, 0.42) * 1.9 * chase, around * guideOn);
        dots += cc * lit;
      }
    }
    col += dots * smoothstep(hy - 6.0 * S, hy + 20.0 * S, p.y);
  }

  col = vec3(1.0) - exp(-col * 1.3);
  vec2 vq = p / vec2(W, H) - 0.5;
  float vig = 1.0 - 0.6 * pow(length(vq * vec2(0.9, 1.1)) * 1.3, 2.4);
  col *= clamp(vig, 0.0, 1.0);
  col += vec3(0.043, 0.043, 0.047);
  col += (hash12(p + fract(t * 7.0) * 91.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`,ue=12;function de(e,t,n){let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(console.warn(`[stage]`,e.getShaderInfoLog(r)),e.deleteShader(r),null)):null}function fe(e){let t=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!1,powerPreference:`high-performance`});if(!t)return null;let n=de(t,t.VERTEX_SHADER,ce),r=de(t,t.FRAGMENT_SHADER,le);if(!n||!r)return null;let i=t.createProgram();if(!i)return null;if(t.attachShader(i,n),t.attachShader(i,r),t.linkProgram(i),!t.getProgramParameter(i,t.LINK_STATUS))return console.warn(`[stage]`,t.getProgramInfoLog(i)),null;t.useProgram(i);let a=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,a),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),t.STATIC_DRAW);let o=t.getAttribLocation(i,`aPos`);t.enableVertexAttribArray(o),t.vertexAttribPointer(o,2,t.FLOAT,!1,0,0);let s=Object.fromEntries([`uRes`,`uTime`,`uBeat`,`uOn`,`uSpot`,`uKey`,`uBoost`,`uCalm`,`uScale`,`uHorizon`,`uFace`,`uPtr`,`uPal`,`uRip`,`uRipC`,`uFall`].map(e=>[e,t.getUniformLocation(i,e)])),c=performance.now(),l=new Float32Array(48).fill(-100),u=new Float32Array(36),d=0,f=0,p=new Float32Array([0,0,-100,0]),m=0,h=[0,0,100],ee=0,g=[0,0,0],_=0,v=0,x=1,S=1,C=0,w=0,T={levels:{on:0,spot:0,boost:0},calm:!1,resize(){let n=e.clientWidth,r=e.clientHeight,i=Math.min(window.devicePixelRatio||1,1.5),a=n*r*i*i,o=19e5*S;x=i*Math.min(1,Math.sqrt(o/Math.max(1,a))),e.width=Math.max(1,Math.round(n*x)),e.height=Math.max(1,Math.round(r*x)),t.viewport(0,0,e.width,e.height)},setFace(e,t,n){h[0]=e,h[1]=t,h[2]=n},setHorizon(e){ee=e},ripple(e,t,n=1,r){let i=(performance.now()-c)/1e3,a=d;d=(d+1)%ue,l[a*4]=e*x,l[a*4+1]=t*x,l[a*4+2]=i,l[a*4+3]=n;let o=r??b(f++);u[a*3]=o[0],u[a*3+1]=o[1],u[a*3+2]=o[2]},pointer(e,t,n){g[0]=e,g[1]=t,_=+!!n},key(){v=1},fall(e,t){let n=performance.now();p[0]=e*x,p[1]=t*x,p[2]=(n-c)/1e3,p[3]=1,m=n+7e3},frame(n){let r=C?Math.min(.1,(n-C)/1e3):1/60;C&&!T.calm&&(w=r>.026?w+1:Math.max(0,w-1),w>45&&S>.45&&(S*=.75,w=0,T.resize())),C=n,v*=Math.exp(-r*7),g[2]+=(_-g[2])*(1-Math.exp(-r*4)),p[3]&&n>m&&(p[3]=0);let i=T.calm?.5:te(n),a=y(i),o=(n-c)/1e3;t.uniform2f(s.uRes,e.width,e.height),t.uniform1f(s.uTime,T.calm?12:o),t.uniform1f(s.uBeat,i),t.uniform1f(s.uOn,T.levels.on),t.uniform1f(s.uSpot,T.levels.spot),t.uniform1f(s.uKey,v),t.uniform1f(s.uBoost,T.levels.boost),t.uniform1f(s.uCalm,+!!T.calm),t.uniform1f(s.uScale,x),t.uniform1f(s.uHorizon,ee*x),t.uniform3f(s.uFace,h[0]*x,h[1]*x,h[2]*x),t.uniform3f(s.uPtr,g[0]*x,g[1]*x,g[2]),t.uniform3fv(s.uPal,a.flat()),t.uniform4fv(s.uRip,l),t.uniform3fv(s.uRipC,u),t.uniform4fv(s.uFall,p),t.drawArrays(t.TRIANGLES,0,3)},destroy(){t.getExtension(`WEBGL_lose_context`)?.loseContext()}};return T.resize(),T}var A=document.documentElement,j=matchMedia(`(prefers-reduced-motion: reduce)`).matches,M=(e,t=document)=>t.querySelector(e),pe=(e,t=document)=>[...t.querySelectorAll(e)],N=(e,t,n)=>Math.min(n,Math.max(t,e)),me=e=>e*180/Math.PI,he=e=>1-(1-N(e,0,1))**3,P=M(`[data-stage]`),F=M(`[data-act]`),ge=M(`[data-act-tilt]`),I=M(`[data-act-spin]`),_e=pe(`[data-act-shade]`),L=M(`[data-title]`),ve=M(`[data-hint]`),R=M(`[data-ring-back]`),z=R.getContext(`2d`),ye=-6;I.style.setProperty(`--pose`,`${ye}deg`);var B=null;try{B=fe(M(`[data-gl]`))}catch{B=null}B&&(A.classList.add(`has-gl`),B.calm=j);var V=new oe(M(`[data-ring]`,F),{glow:.05});V.calm=j,V.rotation=ye;var H={w:0,h:0,horizon:0,face:{x:0,y:0,r:100}},be=900,U=null,W={x:0,y:0,on:0};function xe(){if(!U)return;let e=Math.min(H.h*.3,H.w*.5);U.place(H.w/2,H.h*(H.w<600?.58:.675),e)}async function Se(){let t=document.createElement(`canvas`);try{let{createBand:n}=await e(async()=>{let{createBand:e}=await import(`./band3d-BF-b5LGk.js`);return{createBand:e}},__vite__mapDeps([0,1,2]));t.className=`band-3d`,t.setAttribute(`role`,`img`),t.setAttribute(`aria-label`,M(`.act-band`).alt),P.insertBefore(t,F);let r=n(t,E);if(!r)throw Error(`no WebGL`);U=r,V.headless=!0,V.rotation=0,xe(),j&&Ve(),requestAnimationFrame(()=>A.classList.add(`has-3d`))}catch{U=null,t.remove(),A.classList.add(`no-3d`)}}function Ce(){B?.resize(),V.resize(),R.width=V.canvas.width,R.height=V.canvas.height,be=Math.max(640,window.innerHeight*1.1);let e=P.getBoundingClientRect(),t=F.getBoundingClientRect();H.w=e.width,H.h=e.height,H.face=se({left:t.left-e.left,top:t.top-e.top,width:t.width,height:t.height}),H.horizon=e.height*(e.width<600?.6:.64),B?.setFace(H.face.x,H.face.y,H.face.r),B?.setHorizon(H.horizon),xe(),n(L),j&&Ve()}function we(){let e=M(`.act-band`),t=M(`.act-back`);for(let n=1;n<=7;n++){let r=e.cloneNode();r.className=`act-edge`,r.alt=``,r.removeAttribute(`fetchpriority`),r.style.setProperty(`--z`,`calc(var(--half) * ${(2*n/8-1).toFixed(3)})`),I.insertBefore(r,t)}}var Te=-1;function G(e){Math.abs(e-Te)<.001||(Te=e,_e.forEach(t=>t.style.opacity=String(e)))}var K=-1,Ee=[[0,0],[50,.95],[100,.08],[170,.7],[220,.15],[360,1]];function De(e){if(e<=0)return 0;for(let t=1;t<Ee.length;t++){let[n,r]=Ee[t],[i,a]=Ee[t-1];if(e<=n)return a+(r-a)*(e-i)/(n-i)}return 1}function Oe(e){K=e,ee(e+520),window.setTimeout(()=>V.set(`boot`,performance.now(),{mode:`compass`,after:900}),260)}var ke=!1,Ae=0,q=-50,J={x:0,y:0},Y={x:0,y:0},X={x:-999,y:-999,t:0};function je(e){let t=P.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}}function Me(e,t){return me(Math.atan2(t-H.face.y,e-H.face.x))}P.addEventListener(`pointermove`,e=>{let{x:t,y:n}=je(e);if(ke=!0,W.x=t,W.y=n,W.on=1,B?.pointer(t,n,!0),V.mode===`compass`&&(q=Me(t,n)),Y.x=N((n-H.face.y)/H.h,-.6,.6)*-14,Y.y=N((t-H.face.x)/H.w,-.6,.6)*16,j||K<0)return;let r=performance.now(),i=Math.hypot(t-X.x,n-X.y);(i>46||i>8&&r-X.t>140)&&(B?.ripple(t,n,e.pointerType===`touch`?1.4:1),X.x=t,X.y=n,X.t=r)}),P.addEventListener(`pointerleave`,()=>{W.on=0,B?.pointer(0,0,!1),Y.x=0,Y.y=0});function Ne(e,t){let n=performance.now(),r=H.h-H.horizon,i=N(t,H.horizon+r*.18,H.h-r*.14);j||(B?.fall(e,i),B?.ripple(e,i,2.4,d)),q=Me(e,i)+180,V.set(`alert`,n,{mode:`away`,after:2600}),Ae=n+6400,j||(U?.canvas??F).animate([{translate:`0 0`},{translate:`-7px 0`},{translate:`7px 0`},{translate:`-4px 0`},{translate:`0 0`}],{duration:360,easing:`linear`,composite:`add`})}P.addEventListener(`click`,e=>{if(e.target.closest(`a, button`))return;let{x:t,y:n}=je(e);Ne(t,n)}),ve.addEventListener(`click`,()=>{Ne(H.w*(.2+Math.random()*.6),H.horizon+(H.h-H.horizon)*(.35+Math.random()*.3))});var Z=0,Q=0,$=0,Pe=0;function Fe(){return Math.round((A.scrollHeight-window.innerHeight)/2)}function Ie(){let e=window.scrollY,t=e-Z;Q+=t/be*360,Z=e,Pe=performance.now();let n=A.scrollHeight-window.innerHeight,r=window.innerHeight*1.2;Math.abs(t)<window.innerHeight*.5&&n>r*4&&(t<0&&e<r||t>0&&e>n-r)&&(window.scrollTo({top:Fe(),behavior:`instant`}),Z=window.scrollY)}function Le(e){!z||Math.cos(e*Math.PI/180)>.2||(z.clearRect(0,0,R.width,R.height),z.drawImage(V.canvas,0,0))}var Re=performance.now();function ze(e){if(requestAnimationFrame(ze),document.hidden)return;let t=Math.min(.1,(e-Re)/1e3);if(Re=e,e-Pe>500){let e=Math.round(Q/180)*180;Q+=(e-Q)*(1-Math.exp(-t*2.5))}if($+=(Q-$)*(1-Math.exp(-t*6)),Math.abs($)>36e3){let e=360*Math.trunc($/360);$-=e,Q-=e}let n=N(Math.abs(Q-$)/140,0,1);if(K>=0){let t=e-K;B&&(B.levels.spot=De(t),B.levels.on=he((t-520)/1100),B.levels.boost=n*.6),G(1-De(t))}V.mode===`away`&&e>Ae&&V.set(`compass`,e),!ke&&V.mode===`compass`&&(q=-60+Math.sin(e/2400)*70),J.x+=(Y.x-J.x)*(1-Math.exp(-t*4)),J.y+=(Y.y-J.y)*(1-Math.exp(-t*4));let r=K>=0?Math.sin(e/2600)*7:0,i=$+r;if(V.spin=n,V.beatGlow=B?B.levels.on:1,U){let t=U.aimLocal(q);t!==null&&(V.aim=t),V.frame(e),Be(e,i,K>=0?De(e-K):0,B?B.levels.on:1),B?.frame(e)}else I.style.transform=`rotateY(${i.toFixed(2)}deg)`,ge.style.transform=`rotateX(${J.x.toFixed(2)}deg) rotateY(${J.y.toFixed(2)}deg)`,V.aim=Math.cos((i+J.y)*Math.PI/180)<0?180-q:q,B?.frame(e),V.frame(e),Le(i+J.y)}function Be(e,t,n,r){if(!U)return;let i=te(e);U.frame({turn:t,tiltX:J.x,tiltY:J.y,lit:n,on:r,palette:y(i),kick:j?0:g(i),pointer:W,levels:V.levels,colours:V.colours});let a=U.face();H.face={x:a.x,y:a.y,r:a.r},B?.setFace(a.x,a.y,a.r*(.6+.4*Math.max(0,a.facing)))}function Ve(){let e=performance.now();V.mode===`off`&&V.set(`compass`,e),U?(V.aim=U.aimLocal(-50)??-50,V.frame(e),Be(e,0,1,.8)):(I.style.transform=``,V.aim=-50,V.frame(e)),B&&(B.levels.on=.8,B.levels.spot=1,B.frame(e))}async function He(){let e=document.fonts?.load(`900 100px "Epilogue Variable"`).catch(()=>null);await Promise.race([e,new Promise(e=>setTimeout(e,900))]);let t=r(L),n=j||window.scrollY>40||!A.classList.contains(`intro`);if(Ce(),window.addEventListener(`resize`,()=>requestAnimationFrame(Ce)),Se(),j||(we(),Z=window.scrollY,window.addEventListener(`scroll`,Ie,{passive:!0})),n){if(A.classList.remove(`intro`),A.classList.add(`no-intro`),L.classList.add(`is-ready`),G(0),j){Ve();return}Oe(performance.now()-400),requestAnimationFrame(ze)}else G(1),requestAnimationFrame(ze),await i(L,t,{onKey:()=>B?.key(),onRise:()=>A.classList.remove(`intro`),onStrike:()=>Oe(performance.now()),onDone:()=>{}})}He();