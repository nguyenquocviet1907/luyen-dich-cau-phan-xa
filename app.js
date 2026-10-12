/* Luyện Dịch Câu Phản Xạ — engine + UI (không cần backend) */
'use strict';

/* ================= PURE LOGIC (test được bằng node) ================= */
function norm(s){
  return String(s||'').toLowerCase()
    .replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/[^a-z0-9'\s-]/g,' ')
    .replace(/\s+/g,' ').trim();
}

function scanVietlish(rawText){
  const t = ' ' + norm(rawText) + ' ';
  const hits = [];
  for(const p of VIETLISH_PATTERNS){
    let m = null;
    try{
      if(p.re){ m = t.match(p.re); }
      else if(p.test && p.test(t)){ m = ['']; }
    }catch(e){}
    if(m){ hits.push({msg:p.msg, match:(m[0]||'').trim()}); }
  }
  return hits;
}

/* tier: 3=chuẩn, 2=đúng nhưng gượng, 1=sai */
function gradeSubmission(raw, q){
  const t = norm(raw);
  if(!t || t.split(' ').length < 3) return {tier:1, errors:[], tooShort:true};
  for(const a of q.answers){
    if(t === norm(a)) return {tier:3, errors:[]};
  }
  const errors = scanVietlish(raw);
  if(errors.length) return {tier:1, errors};
  const kw = q.keywords || [];
  const hitCount = kw.filter(k => t.includes(k.toLowerCase())).length;
  if(hitCount >= Math.max(2, Math.ceil(kw.length * 0.6))) return {tier:2, errors:[]};
  return {tier:1, errors:[], generic:true};
}

/* Chế độ tự dán câu: tra từ điển theo cụm dài nhất */
function dictLookup(viText){
  const src = ' ' + String(viText||'').toLowerCase().replace(/\s+/g,' ').trim() + ' ';
  const dict = [...VI_DICT].sort((a,b)=> b[0].length - a[0].length);
  const found = [], used = new Array(src.length).fill(false);
  for(const [vi,en,pos] of dict){
    const needle = ' ' + vi + ' ';
    let idx = src.indexOf(needle);
    while(idx !== -1){
      let overlap = false;
      for(let i=idx;i<idx+needle.length;i++){ if(used[i]){ overlap=true; break; } }
      if(!overlap){
        for(let i=idx;i<idx+needle.length;i++) used[i]=true;
        found.push([en,pos||'',vi]);
      }
      idx = src.indexOf(needle, idx+1);
    }
  }
  return found.slice(0, 14);
}

function gradeCustom(raw){
  const t = norm(raw);
  if(!t || t.split(' ').length < 3) return {tier:1, errors:[], tooShort:true};
  const errors = scanVietlish(raw);
  return {tier: errors.length ? 1 : 2, errors};
}

if(typeof module !== 'undefined'){ module.exports = {norm, scanVietlish, gradeSubmission, dictLookup, gradeCustom}; }

/* ================= UI ================= */
if(typeof document !== 'undefined'){
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const TOPIC_NAME = {daily:'🏠 Đời sống', work:'💼 Công sở'};

let tab='topic', topic='daily', qi=0, score=0, done=0;
let phrasebook=[];
try{ phrasebook = JSON.parse(localStorage.getItem('dichcau_phrasebook')||'[]'); }catch(e){}
const savePB = ()=> localStorage.setItem('dichcau_phrasebook', JSON.stringify(phrasebook));

/* ---------- audio: Web Speech API ---------- */
function speak(text){
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang='en-US'; u.rate=0.92;
    const vs = speechSynthesis.getVoices().filter(v=>v.lang&&v.lang.toLowerCase().startsWith('en'));
    const pick = vs.find(v=>/google us english/i.test(v.name)) || vs.find(v=>/en[-_]us/i.test(v.lang)) || vs[0];
    if(pick) u.voice = pick;
    speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- render helpers ---------- */
function highlightErrors(raw, errors){
  let out = esc(raw), lowered = raw.toLowerCase();
  const marks=[];
  for(const e of errors){
    if(!e.match) continue;
    const m = e.match.toLowerCase();
    let i = lowered.indexOf(m);
    while(i!==-1){ marks.push([i,i+m.length]); i = lowered.indexOf(m, i+1); }
  }
  marks.sort((a,b)=>b[0]-a[0]);
  for(const [a,b] of marks){ out = out.slice(0,a)+'<span class="err">'+out.slice(a,b)+'</span>'+out.slice(b); }
  return out;
}

function starBtn(text){
  const saved = phrasebook.includes(text);
  return `<button class="star ${saved?'on':''}" data-pb="${esc(text)}" title="Lưu vào sổ tay">★</button>`;
}

function renderTabs(){
  $('#tabTopic').classList.toggle('active', tab==='topic');
  $('#tabCustom').classList.toggle('active', tab==='custom');
  $('#tabBook').classList.toggle('active', tab==='book');
  $('#viewTopic').hidden = tab!=='topic';
  $('#viewCustom').hidden = tab!=='custom';
  $('#viewBook').hidden = tab!=='book';
  if(tab==='book') renderBook();
  if(tab==='topic') renderQuestion();
}

function questionsOf(){ return QUESTIONS.filter(q=>q.topic===topic); }

function renderQuestion(){
  const list = questionsOf();
  if(qi>=list.length) qi=0;
  const q = list[qi];
  $('#qCount').textContent = `Câu ${qi+1}/${list.length}`;
  $('#qVi').textContent = q.vi;
  $('#qSub').textContent = q.sub;
  $('#answer').value='';
  $('#feedback').innerHTML='';
  $('#feedback').hidden = true;
  $('#btnSubmit').disabled = false;
  renderHints(q);
  $('#answer').focus();
}

function renderHints(q){
  const h1 = q.hints1.map(([w,pos,mean])=>
    `<div class="hint-row"><span class="hw">${esc(w)}</span> <span class="hpos">${esc(pos)}</span> <span class="hme">${esc(mean)}</span></div>`).join('');
  const h2 = q.hints2.map(c=>
    `<div class="hint-row"><span class="hw2">${esc(c)}</span> ${starBtn(c)}</div>`).join('');
  $('#hintBody').innerHTML =
    `<h4>Mức 1 — Từ khóa cốt lõi</h4>${h1}<h4>Mức 2 — Cụm từ đi kèm (collocations)</h4>${h2}
     <p class="hint-note">💡 Gợi ý không bao giờ hiện nguyên câu dịch hoàn chỉnh.</p>`;
}

function toggleDrawer(force){
  const d = $('#drawer');
  const show = force!==undefined ? force : d.classList.contains('open')===false;
  d.classList.toggle('open', show);
}

function submitAnswer(){
  const list = questionsOf();
  const q = list[qi];
  const raw = $('#answer').value;
  const r = gradeSubmission(raw, q);
  done++;
  let html='';
  if(r.tier===3){
    score+=10;
    html = `<div class="fb good"><div class="fb-title">🎉 Xuất sắc! Câu chuẩn tự nhiên. +10 điểm</div>
      <div class="fb-row"><button class="speak" data-say="${esc(q.fix)}">🔊 Nghe câu chuẩn</button></div>
      ${svoHtml(q)}</div>`;
  }else if(r.tier===2){
    score+=6;
    html = `<div class="fb warn"><div class="fb-title">👍 Đúng ý nhưng hơi gượng gạo. +6 điểm</div>
      <div class="fb-label">Câu chuẩn tự nhiên hơn:</div>
      <div class="fb-better">${esc(q.better)} <button class="speak" data-say="${esc(q.better)}">🔊</button></div>
      ${svoHtml(q)}
      <div class="fb-label">Giải thích:</div><ul>${q.explain.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`;
  }else{
    const errList = r.errors.length
      ? `<div class="fb-label">Lỗi phát hiện:</div><ul>${r.errors.map(e=>`<li>🔴 ${esc(e.msg)}</li>`).join('')}</ul>`
      : `<div class="fb-label">${r.tooShort ? 'Câu của bạn quá ngắn — hãy thử viết đầy đủ ý.' : 'Câu của bạn còn thiếu ý chính hoặc sai cấu trúc — xem câu sửa bên dưới.'}</div>`;
    html = `<div class="fb bad"><div class="fb-title">📝 Chưa đúng — xem lại nhé</div>
      <div class="fb-label">Câu của bạn:</div>
      <div class="fb-user">${r.errors.length?highlightErrors(raw,r.errors):esc(raw)}</div>
      ${errList}
      <div class="fb-label">Câu sửa đúng:</div>
      <div class="fb-fix">${esc(q.fix)} <button class="speak" data-say="${esc(q.fix)}">🔊</button></div>
      ${svoHtml(q)}
      <div class="fb-label">Vì sao:</div><ul>${q.explain.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>
      <div class="fb-label">Nói tự nhiên hơn:</div><div class="fb-better">${esc(q.better)}</div></div>`;
  }
  html += `<div class="fb-nav"><button id="btnNext">Câu tiếp theo →</button></div>`;
  const fb = $('#feedback');
  fb.innerHTML = html; fb.hidden = false;
  $('#btnSubmit').disabled = true;
  updateScore();
  $('#btnNext').onclick = ()=>{ qi=(qi+1)%list.length; renderQuestion(); window.scrollTo({top:0,behavior:'smooth'}); };
  fb.querySelectorAll('.speak').forEach(b=> b.onclick=()=>speak(b.dataset.say));
  fb.querySelectorAll('.star').forEach(b=> b.onclick=()=>togglePB(b.dataset.pb, b));
}

function svoHtml(q){
  return `<div class="fb-label">Bóc tách S–V–O (khối nghĩa):</div>
    <div class="svo">${q.svo.map(([k,v])=>`<span class="chunk c${k}"><b>${k}</b> ${esc(v)}</span>`).join('')}</div>`;
}

function togglePB(text, btn){
  const i = phrasebook.indexOf(text);
  if(i===-1){ phrasebook.push(text); }else{ phrasebook.splice(i,1); }
  savePB();
  if(btn) btn.classList.toggle('on', i===-1);
  if(tab==='book') renderBook();
}

function renderBook(){
  const el = $('#bookList');
  if(!phrasebook.length){ el.innerHTML='<p class="empty">Chưa lưu cụm nào. Bấm ★ ở các cụm collocation để lưu vào đây ôn lại.</p>'; return; }
  el.innerHTML = phrasebook.map((p,i)=>
    `<div class="pb-row"><span>${esc(p)}</span>
     <button class="speak" data-say="${esc(p)}">🔊</button>
     <button class="del" data-i="${i}">✕</button></div>`).join('');
  el.querySelectorAll('.speak').forEach(b=> b.onclick=()=>speak(b.dataset.say));
  el.querySelectorAll('.del').forEach(b=> b.onclick=()=>{ phrasebook.splice(+b.dataset.i,1); savePB(); renderBook(); });
}

function updateScore(){
  $('#score').textContent = `⭐ ${score} điểm · 📝 ${done} câu`;
}

/* ---------- custom mode ---------- */
function renderCustomHints(){
  const vi = $('#customVi').value.trim();
  if(!vi){ $('#customHintBody').innerHTML='<p class="empty">Dán câu tiếng Việt vào ô trên rồi bấm "Tạo gợi ý".</p>'; return; }
  const found = dictLookup(vi);
  $('#customHintBody').innerHTML = found.length
    ? `<h4>Từ khóa tra được (${found.length})</h4>` + found.map(([en,pos,vi])=>
      `<div class="hint-row"><span class="hw">${esc(en)}</span> <span class="hpos">${esc(pos)}</span> <span class="hme">← ${esc(vi)}</span> ${starBtn(en)}</div>`).join('')
      + `<p class="hint-note">💡 Chế độ tự do: mình kiểm tra lỗi Vietlish phổ biến trên bản dịch của bạn.</p>`
    : '<p class="empty">Không tra được từ nào — thử câu ngắn hơn, dùng từ phổ thông.</p>';
  $('#customHintBody').querySelectorAll('.star').forEach(b=> b.onclick=()=>togglePB(b.dataset.pb, b));
}

function submitCustom(){
  const raw = $('#customEn').value;
  const r = gradeCustom(raw);
  done++;
  let html='';
  if(r.tier===2){
    score+=6;
    html=`<div class="fb warn"><div class="fb-title">👍 Không phát hiện lỗi Vietlish phổ biến. +6 điểm</div>
      <div class="fb-label">Mẹo: đọc to câu của bạn — nếu nghe "thuận tai" như người bản xứ nói thì càng tốt. Muốn chắc, dán câu vào từ điển câu mẫu để đối chiếu.</div></div>`;
  }else{
    const errList = r.errors.length
      ? `<ul>${r.errors.map(e=>`<li>🔴 ${esc(e.msg)}</li>`).join('')}</ul>`
      : `<div class="fb-label">${r.tooShort?'Câu quá ngắn — hãy viết đầy đủ ý.':'Không chắc đúng — hãy đối chiếu với gợi ý từ vựng.'}</div>`;
    html=`<div class="fb bad"><div class="fb-title">📝 Phát hiện vấn đề</div>
      <div class="fb-label">Câu của bạn:</div><div class="fb-user">${r.errors.length?highlightErrors(raw,r.errors):esc(raw)}</div>
      ${errList}</div>`;
  }
  const fb=$('#feedbackCustom'); fb.innerHTML=html; fb.hidden=false;
  updateScore();
}

/* ---------- events ---------- */
function init(){
  $('#tabTopic').onclick=()=>{tab='topic';renderTabs();};
  $('#tabCustom').onclick=()=>{tab='custom';renderTabs();};
  $('#tabBook').onclick=()=>{tab='book';renderTabs();};
  $('#topicDaily').onclick=()=>{topic='daily';qi=0;syncTopicBtns();renderQuestion();};
  $('#topicWork').onclick=()=>{topic='work';qi=0;syncTopicBtns();renderQuestion();};
  $('#btnHints').onclick=()=>toggleDrawer();
  $('#drawerClose').onclick=()=>toggleDrawer(false);
  $('#btnSubmit').onclick=submitAnswer;
  $('#btnCustomHints').onclick=renderCustomHints;
  $('#btnCustomSubmit').onclick=submitCustom;
  document.addEventListener('click',e=>{
    const st=e.target.closest('.star');
    if(st && !st.onclick){ togglePB(st.dataset.pb, st); }
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Tab' && tab==='topic' && !$('#viewTopic').hidden){
      const ae=document.activeElement;
      if(ae && (ae.id==='answer')){ e.preventDefault(); toggleDrawer(); }
    }
    if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){
      if(tab==='topic' && !$('#viewTopic').hidden && !$('#btnSubmit').disabled) submitAnswer();
      else if(tab==='custom' && !$('#viewCustom').hidden) submitCustom();
    }
    if(e.key==='Escape'){ toggleDrawer(false); }
  });
  syncTopicBtns(); renderTabs(); updateScore();
}
function syncTopicBtns(){
  $('#topicDaily').classList.toggle('active', topic==='daily');
  $('#topicWork').classList.toggle('active', topic==='work');
}
document.addEventListener('DOMContentLoaded', init);
}
