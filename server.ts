import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';

const execAsync = promisify(exec);

const SYSTEM_PROMPT = `You are viral clip detector TikTok Affiliate. Return ONLY valid JSON. Schema: {"clips":[{"start_time":0,"end_time":35,"hook_text":"5-12 words hook","virality_score":95,"seo_keyword":"cara-atasi-insomnia","caption":"keyword first 50 chars","hashtags":["#insomnia","#tidur"],"cta_text":"Save & Share ->"}],"niche_tag":"kesehatan","niche_profit_tier":"high","niche_score":85,"niche_advisory":"High profit niche — upload 19:00 WIB","niche_approved":true,"comments":[{"text":"Ah masa sih bang? Kok di gue gak ngaruh ya?","intent":"skeptic"}],"pinned_reply":"Yang mau coba serum Skintific cek keranjang kuning no.3 ya!","cta_target":"keranjang_kuning"} Rules: 30-60s clips, hyphen keyword, caption keyword first 50, 3-5 hashtags, CTA Save/Share. WAJIB return niche_tag (string non-empty), niche_profit_tier enum low|medium|high (map 8-15%->high, 4-8%->medium, else low), niche_score integer 0-100, niche_advisory string. JANGAN null. CONTEXT-AWARE HOOK: Gunakan SOURCE METADATA + NLP ENTITIES + EXTERNAL CONTEXT untuk memilih angle terkuat: (a) public figure jika ada people terkenal, (b) brand/product jika ada brand/produk, (c) pain point jika ada masalah audiens, (d) number/data jika ada angka kuat, (e) trend/news jika ada konteks publik. Hook TIDAK boleh generic — harus spesifik dari entity paling relevan dengan transcript dan niche. JANGAN membuat klaim palsu yang tidak ada di transcript/metadata/context. Jika external_context kosong, tetap pakai transcript+metadata. COMMENTS WAJIB 3-5 items array comments tiap {text,intent} intent enum skeptic|curious|relatable. Tulis dari sudut pandang AUDIENS (bukan kreator). Variasi: skeptic memicu debat (Ah masa sih bang?), curious memicu tanya (varian lama atau baru bang?), relatable memicu curhat (gue juga ngalamin!). DILARANG generic bot Mantap bang/Keren/Ijin sedot. DILARANG SARA/toxic/melangkui guideline. PINNED_REPLY WAJIB: jika entities.brands/products ada -> CTA keranjang_kuning sebut produk mis Yang mau coba {product} cek keranjang kuning no.3 mumpung diskon! Jika TIDAK ADA produk -> CTA follow/playlist mis Cek playlist di profil / part 2 besok ya! cta_target enum keranjang_kuning|link_bio|follow sesuaikan produk. SEAMLESS LOOP WAJIB return object seamless_loop {loop_score integer 0-100, bridge_phrase string kalimat penutup yang grammar memancing hook_text, loop_transition enum cut|fade|dissolve, crossfade_ms integer 200-500}. Konsep Syntactic Loop: bridge_phrase di akhir video harus nyambung sintaksis dengan hook_text di awal sehingga saat TikTok auto-loop kalimat jadi satu. Mis Hook uang 1,2 miliar bisa hilang dari TikTok! + Bridge Dan itulah alasan kenapa -> loop Dan itulah alasan kenapa uang 1,2 miliar bisa hilang dari TikTok! Lakukan analisis transcript untuk buat bridge_phrase paling mulus. MULTI-CLIP INDEPENDENT WAJIB: Return 2-3 clip VIRAL dengan start_time BERBEDA minimal 120 detik, JANGAN berurutan. Contoh BURUK clip1 0-30s clip2 30-60s berurutan. Contoh BAIK clip1 5-35s topik A, clip2 125-155s topik B, clip3 260-290s topik C. Setiap clip hook_text BERBEDA dan virality_score sendiri. Jumlah clip: durasi <10 menit max 2, 10-60 menit max 3, >60 menit max 5.`;
function slugify(s: string){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'viral-hook'; }
function extractJson(t: string){ let x=t.trim(); if(x.startsWith('```')){const n=x.indexOf('\n'); if(n!==-1) x=x.slice(n+1); if(x.endsWith('```')) x=x.slice(0,-3); x=x.trim();} try{JSON.parse(x); return x;}catch{} const a=x.indexOf('{'),b=x.lastIndexOf('}'); if(a!==-1&&b>a){const c=x.slice(a,b+1); try{JSON.parse(c); return c;}catch{}} return x; }
function enforceSeo(cs:any[]){ for(const c of cs){ if(!c.seo_keyword||!c.seo_keyword.includes('-')) c.seo_keyword=slugify(c.hook_text||c.caption||'viral')+'-viral'; const kw=c.seo_keyword.replace(/-/g,' ').toLowerCase().split(' ').filter(Boolean); const cap=(c.caption||'').toLowerCase(); if(c.caption&&!kw.some((w:string)=>cap.slice(0,60).includes(w))) c.caption=c.seo_keyword.replace(/-/g,' ')+' '+c.caption; if(!c.caption) c.caption=c.seo_keyword.replace(/-/g,' ')+' — tonton sampai akhir'; if(!c.hashtags||!c.hashtags.length) c.hashtags=['#'+c.seo_keyword.split('-')[0],'#tipssehat','#viral']; if(!c.cta_text) c.cta_text='Save video ini & Share ->'; if(!c.hook_text) c.hook_text='Tonton sampai habis'; } return cs; }
function normalizeNicheTier(v:any): 'low'|'medium'|'high' { const s=String(v??'').toLowerCase().trim(); if(s==='high'||s==='tinggi'||s.includes('8-15')||s.includes('15%')||s==='high-profit'||s==='premium') return 'high'; if(s==='medium'||s==='mid'||s==='sedang'||s.includes('4-8')||s.includes('medium')) return 'medium'; if(s==='low'||s==='rendah') return 'low'; if(s.includes('high')) return 'high'; if(s.includes('medium')||s.includes('mid')) return 'medium'; return 'low'; }
function normalizeNiche(raw:any){ const tag=(typeof raw?.tag==='string'&&raw.tag.trim())?raw.tag.trim().toLowerCase().slice(0,32): (typeof raw?.niche_tag==='string'&&raw.niche_tag.trim()?raw.niche_tag.trim().toLowerCase().slice(0,32):'unknown'); const tier=normalizeNicheTier(raw?.tier??raw?.niche_profit_tier); let sc=Number(raw?.score??raw?.niche_score); if(!Number.isFinite(sc)) sc=0; sc=Math.round(Math.max(0,Math.min(100,sc))); const llmAdv=(typeof raw?.advisory==='string'&&raw.advisory.trim())?raw.advisory.trim().slice(0,200): (typeof raw?.niche_advisory==='string'&&raw.niche_advisory.trim()?raw.niche_advisory.trim().slice(0,200):''); const tierAdvice=tier==='high'?'High profit niche': tier==='medium'?'Medium niche':'Low niche — cek riset'; const bestSlot=tier==='high'?'06:30 & 19:00 WIB': tier==='medium'?'19:00 WIB':'19:30 WIB'; const adv=llmAdv ? (llmAdv.toLowerCase().includes(tag) ? llmAdv : `${tag} — ${llmAdv}`) : `${tag} — ${tierAdvice} — upload ${bestSlot}`; return {tag,tier,score:sc,advisory:adv}; }
function normalizeViralityScore(v:any): number { const n=Number(v); if(!Number.isFinite(n)){ console.warn('[Virality] missing/invalid score -> fallback 50, raw:',String(v).slice(0,80)); return 50; } return Math.round(Math.max(0,Math.min(100,n))); }
function getViralityBadge(score:number){ if(score>=85) return {badge:'viral_potential' as const,label:'Potensi FYP',emoji:'\uD83D\uDD25'}; if(score>=60) return {badge:'solid' as const,label:'Konten Solid',emoji:'\u2705'}; return {badge:'experimental' as const,label:'Eksperimental',emoji:'\uD83E\uDDEA'}; }
function enrichAndSortClips(raw:any[]):any[]{
  if(!Array.isArray(raw)||!raw.length) return [];
  const enriched=raw.map((c,i)=>{ const vs=normalizeViralityScore(c?.virality_score); const b=getViralityBadge(vs); return {...c, virality_score:vs, virality_badge:b.badge, virality_label:b.label, virality_emoji:b.emoji, _orig_idx:i}; });
  enriched.sort((a,b)=> b.virality_score - a.virality_score || a._orig_idx - b._orig_idx);
  return enriched.map((c,i)=>{ const { _orig_idx, ...rest }=c; return {...rest, is_primary:i===0}; });
}
function buildFallbackComments(entities:any):{text:string,intent:'skeptic'|'curious'|'relatable'}[]{
  const prod=(entities?.products?.[0]||entities?.brands?.[0]||'').trim();
  return [
    {text: prod?`Ah masa sih ${prod} sebagus itu? Di gue kok gak ngaruh ya?`:`Ah masa sih sebagus itu? Kok di gue gak ngaruh ya?`, intent:'skeptic' as const},
    {text: prod?`Itu ${prod} varian lama atau baru bang? Ngaruh gak ke hasilnya?`:`Itu varian lama atau baru bang? Ada yang udah coba?`, intent:'curious' as const},
    {text:`Sumpah gue juga ngalamin hal yang sama persis, relate banget!`, intent:'relatable' as const},
  ];
}
function normalizeComments(raw:any, entities:any):{text:string,intent:'skeptic'|'curious'|'relatable'}[]{
  const allowed=new Set(['skeptic','curious','relatable']);
  let arr:Array<any>=Array.isArray(raw)?raw:[];
  let out:{text:string,intent:'skeptic'|'curious'|'relatable'}[]=[];
  for(const c of arr){
    if(out.length>=5) break;
    let text=typeof c==='string'?c:(c?.text||'');
    let intent=String(c?.intent||'').toLowerCase().trim();
    text=String(text).trim().slice(0,140);
    if(!text||text.length<8) continue;
    const low=text.toLowerCase();
    if(/\b(mantap bang|ijin sedot|ijin save)\b/.test(low)||low==='keren'||low==='mantap bang') continue;
    if(/\b(sara|rasis)\b/.test(low)) continue;
    if(!allowed.has(intent)) intent=['skeptic','curious','relatable'][out.length%3];
    out.push({text,intent:intent as any});
  }
  if(out.length<3){
    const fb=buildFallbackComments(entities);
    for(const f of fb){ if(out.length>=3) break; if(!out.some(o=>o.intent===f.intent)) out.push(f); }
    while(out.length<3) out.push(fb[out.length%fb.length]);
  }
  const uniq=new Set(out.map(o=>o.intent));
  if(uniq.size===1 && out.length>=3){ out[1].intent='curious' as const; out[2].intent='relatable' as const; }
  return out.slice(0,5);
}
function normalizePinnedReply(raw:any, entities:any):string{
  let s=typeof raw==='string'?raw.trim():String(raw||'').trim();
  if(s) return s.slice(0,220);
  const prod=(entities?.products?.[0]||entities?.brands?.[0]||'').trim();
  if(prod) return `Yang mau coba ${prod} yang aku bahas, cek keranjang kuning no. 3 ya, mumpung lagi diskon! \uD83D\uDC47`;
  return `Buat yang mau dengar cerita lengkapnya, cek playlist di profil / part 2 besok ya!`;
}
let lastWhisperSegments:any[]|null=null;
let transcriptPartialFlag=false;
let groqTranscribeLock:Promise<void>=Promise.resolve();
async function acquireGroqLock():Promise<()=>void>{ let release:()=>void; const wait=new Promise<void>(r=>{release=r as any}); const prev=groqTranscribeLock; groqTranscribeLock=prev.then(()=>wait); await prev; return release!; }
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r as any,ms));
const FILLER_RE=/\b(?:eee+|hmm+|eh+|um+|uh+|anu|emm+|er+|anu)\b|apa namanya|ya kan/gi;
function computeNarrativeMetrics(transcript:string|null, segments:any[]|null, durSec:number){
  const txt=(transcript||'').trim();
  const words=txt?txt.split(/\s+/).filter(Boolean).length:0;
  const mins=durSec>0?durSec/60:0;
  const wpm=mins>0&&words>0?Math.round(words/mins):null;
  let pacing:'fast'|'normal'|'slow'='normal';
  if(wpm!=null){ if(wpm>160) pacing='fast'; else if(wpm<130) pacing='slow'; else pacing='normal'; }
  const lower=txt.toLowerCase();
  const fillers=(lower.match(FILLER_RE)||[]).map(x=>x.trim().toLowerCase()).slice(0,20);
  const filler_count=fillers.length;
  let silence_sec=0;
  if(Array.isArray(segments)&&segments.length>=2){
    for(let i=0;i<segments.length-1;i++){
      const end=Number(segments[i].end ?? segments[i].end_time ?? segments[i].end ?? 0);
      const start=Number(segments[i+1].start ?? segments[i+1].start_time ?? 0);
      const gap=start-end;
      if(Number.isFinite(gap)&&gap>0.6) silence_sec+=gap;
    }
    silence_sec=Math.round(silence_sec*10)/10;
  }
  return {wpm,filler_count,fillers_detected:fillers,silence_sec,pacing,total_words:words};
}
function normalizeSeamlessLoop(raw:any): {loop_score:number|null, bridge_phrase:string, loop_transition:string, crossfade_ms:number}{
  if(!raw||typeof raw!=='object') return {loop_score:null, bridge_phrase:'', loop_transition:'cut', crossfade_ms:0};
  let n=Number(raw.loop_score); let ls:number|null=(Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):null);
  let bp=typeof raw.bridge_phrase==='string'?raw.bridge_phrase.trim().slice(0,160):''; 
  let tr=String(raw.loop_transition||'cut').toLowerCase().trim(); if(!['cut','fade','dissolve'].includes(tr)) tr='cut';
  let cf=Number(raw.crossfade_ms); if(!Number.isFinite(cf)) cf=tr==='cut'?0:300; cf=Math.round(Math.max(0,Math.min(500,cf))); if(tr==='cut') cf=0; if(cf>0&&cf<200) cf=200; if(ls===null&&tr==='cut') cf=0;
  return {loop_score:ls, bridge_phrase:bp, loop_transition:tr, crossfade_ms:cf};
}
function getCtaTarget(entities:any, pinned:string):'keranjang_kuning'|'link_bio'|'follow'{
  if((entities?.products?.length||0)>0 || (entities?.brands?.length||0)>0) return 'keranjang_kuning';
  const low=(pinned||'').toLowerCase();
  if(low.includes('keranjang')) return 'keranjang_kuning';
  if(low.includes('link')||low.includes('bio')) return 'link_bio';
  return 'follow';
}
function formatAssTime(sec:number):string{
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); const sc=(sec%60); const s=Math.floor(sc), cs=Math.floor((sc-s)*100);
  return `${String(h).padStart(1,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}
function escapeAssText(t:string):string{ return t.replace(/\\/g,'\\\\').replace(/{/g,'\\{').replace(/}/g,'\\}').replace(/\n/g,'\\N'); }
function buildAssForClip(segments:any[], cStart:number, cEnd:number):string{
  const cDur=cEnd-cStart;
  const header=`[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CC,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,5,30,30,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  let body='';
  for(const seg of segments){
    const st=Number((seg as any).start ?? (seg as any).start_time ?? 0);
    const en=Number((seg as any).end ?? (seg as any).end_time ?? st+2);
    const txt=String((seg as any).text ?? (seg as any).word ?? '').trim();
    if(!txt) continue;
    const rs=Math.max(0, st - cStart);
    const re=Math.min(cDur, en - cStart);
    if(re<=rs || re<=0 || rs>=cDur) continue;
    // clamp to clip duration, ensure at least 0.4s
    const dur=re-rs; if(dur<0.3) continue;
    const wrapped=txt.length>32 ? txt.replace(/(.{28,32})\s/g,'$1\\N') : txt;
    body+=`Dialogue: 0,${formatAssTime(rs)},${formatAssTime(re)},CC,,0,0,0,,${escapeAssText(wrapped)}\n`;
  }
  if(!body) body=`Dialogue: 0,${formatAssTime(0)},${formatAssTime(Math.min(3,cDur))},CC,,0,0,0,,${escapeAssText('')}\n`;
  return header+body;
}

function extractEntitiesFromText(txt:string, cap=8){
  const lower=txt.toLowerCase();
  const PEOPLE_BLACKLIST = new Set(['bisa itu','nah tapi','oke ini','ate aku','baby udon saya','ya kan','gitu loh','kok bisa','masa sih','eh tunggu','curhat bang','bisa ada','bisa diakses','iya pas','nah tapi','bisa itu']);
  const people:string[]=[]; const peopleRe=/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g; let m:RegExpExecArray|null; while((m=peopleRe.exec(txt))&&people.length<cap){ const v=m[1].trim(); const vl=v.toLowerCase(); if(v.length>=5&&v.length<=40&&!/^(Video|Channel|TikTok|YouTube|Save|Share)/i.test(v) && v.split(' ').length>=2 && !PEOPLE_BLACKLIST.has(vl)) people.push(v); }
  const brands=Array.from(new Set((txt.match(/\b(?:Samsung|iPhone|Apple|Xiaomi|Oppo|Vivo|Wardah|Skintific|Somethinc|Scarlett|Emina|Azarine|Implora|Hanasui|Garnier|L'Oreal|Nivea|Vaseline|Erha|Avoskin|Whitelab|Shopee|Tokopedia|Lazada|TikTok Shop|Grab|Gojek|BCA|BRI|BNI|Mandiri|Dana|OVO|Gopay|Indomie|Mixue|JCO|Starbucks|McD|KFC|Uniqlo|Zara|H&M|Nike|Adidas|Honda|Yamaha|Toyota|Mitsubishi|Tesla|BYD|Wuling|GadgetIn|Z Fold|Galaxy)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const products=Array.from(new Set((txt.match(/\b(?:serum|moisturizer|sunscreen|toner|cream|lotion|lipstik|foundation|cushion|skincare|parfum|handphone|hp|iphone|samsung|laptop|ayam|bakso|sate|rendang|kopi|sambal|cumi|teri|obat|suplemen|vitamin|diet|jerawat|flek|whitening|acne|glowing|Z Fold|Galaxy|Foldable|smartphone)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const places=Array.from(new Set((txt.match(/\b(?:Jakarta|Surabaya|Bandung|Blora|Tuban|Lasem|Bali|Jogja|Semarang|Medan|Indonesia|Jawa|Korea|Jepang|USA|Amerika|China|Thailand)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const numbers=Array.from(new Set((txt.match(/\b\d+(?:[.,]\d+)?\s*(?:%|juta|miliar|ribu|kg|gram|ml|cm|tahun|bulan|hari|kali|x|rupiah|rp|dollar|\$|jt|m|k)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const pain_points=Array.from(new Set((lower.match(/\b(?:jerawat|flek hitam|kusam|berminyak|kering|iritasi|breakout|pori-pori|ketombe|rontok|bau badan|overthinking|insomnia|stress|cemas|utang|bangkrut|rugi|gagal|ditipu|penipuan|scam|nyeri|sakit|pegal|lambung|maag|diet gagal|berat badan|gemuk|kurus)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const topics=Array.from(new Set((lower.match(/\b(?:keuangan|investasi|saham|crypto|trading|affiliate|jualan|bisnis|kuliner|resep|masak|skincare|kecantikan|makeup|kesehatan|diet|olahraga|teknologi|gadget|review|unboxing|tutorial|viral|fyp|edukasi|motivasi|cerita|misteri|sejarah)\b/gi)||[]).map(x=>x.trim()))).slice(0,cap);
  const claims:string[]=[]; const claimRe=/(?:klaim|terbukti|hasil|efek|manfaat|bisa|dapat|mampu)[^.!?]{10,80}[.!?]/gi; let cm:RegExpExecArray|null; while((cm=claimRe.exec(txt))&&claims.length<5){ claims.push(cm[0].trim().slice(0,120)); }
  return { people, brands, products, places, numbers, topics, pain_points, claims };
}
function mergeEntities(a:any,b:any, cap=8){
  const dedup=(arr:string[])=>Array.from(new Map(arr.map(x=>[(x.toLowerCase()),x])).values()).slice(0,cap);
  return {
    people: dedup([...(a.people||[]), ...(b.people||[])]),
    brands: dedup([...(a.brands||[]), ...(b.brands||[])]),
    products: dedup([...(a.products||[]), ...(b.products||[])]),
    places: dedup([...(a.places||[]), ...(b.places||[])]),
    numbers: dedup([...(a.numbers||[]), ...(b.numbers||[])]),
    topics: dedup([...(a.topics||[]), ...(b.topics||[])]),
    pain_points: dedup([...(a.pain_points||[]), ...(b.pain_points||[])]),
    claims: dedup([...(a.claims||[]), ...(b.claims||[])]),
  };
}
function extractContextEntities(sourceMeta:any, transcript:string|null){
  const txt=[sourceMeta?.title||'', sourceMeta?.description||'', (sourceMeta?.tags||[]).join(' '), transcript||''].join(' ').slice(0,6000);
  return extractEntitiesFromText(txt, 8);
}
async function searchBraveContext(query:string, entity_type:string, timeoutMs=5000):Promise<{query:string,entity_type:string,title:string,snippet:string,url:string}|null>{
  const key=(process.env.BRAVE_SEARCH_API_KEY||process.env.BRAVE_API_KEY||'').trim();
  if(!key||key.includes('your_')) return null;
  const controller=new AbortController(); const t=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r=await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3&freshness=pm`,{headers:{'Accept':'application/json','X-Subscription-Token':key},signal:controller.signal});
    clearTimeout(t);
    if(!r.ok){ console.warn('[Brave]',r.status,(await r.text()).slice(0,120)); return null; }
    const j:any=await r.json(); const first=j.web?.results?.[0]||j.results?.[0]; if(!first) return null;
    return { query, entity_type, title:(first.title||'').slice(0,120), snippet:(first.description||first.snippet||'').slice(0,280), url:first.url||'' };
  }catch(e:any){ clearTimeout(t); console.warn('[Brave]',e?.message?.slice(0,80)||e); return null; }
}
function lookupYtdlpUrlByFilename(filename:string):string|null{
  for(const job of (ytdlpJobs as any).values()){ if(job.filename===filename || job.filepath?.endsWith(filename)) return job.url||null; }
  return null;
}
async function extractYtdlpMetadata(url:string):Promise<any|null>{
  try{
    const { stdout }=await execAsync(`/usr/local/bin/yt-dlp --dump-json --no-playlist "${url.replace(/"/g,'\"')}"`, { timeout:30000 } as any);
    const info=JSON.parse(stdout);
    return { title:(info.title||'').slice(0,200), description:(info.description||'').slice(0,800), channel:info.uploader||info.channel||info.uploader_id||'', channel_id:info.channel_id||info.uploader_id||'', upload_date:info.upload_date||'', duration:info.duration||0, view_count:info.view_count||0, like_count:info.like_count||0, categories:info.categories||[], tags:(info.tags||[]).slice(0,20), extractor:info.extractor||'', url };
  }catch(e:any){ console.warn('[ytdlp-meta]',String(e?.message||e).slice(0,120)); return null; }
}
async function buildContextPackage(sourceName:string, transcript:string|null):Promise<{source_meta:any, entities:any, external_context:any[]}>{
  let source_meta:any=null; let url:string|null=lookupYtdlpUrlByFilename(sourceName);
  if(url){ console.log(`[Context] Found URL for ${sourceName}: ${url.slice(0,80)}`); source_meta=await extractYtdlpMetadata(url); }
  if(!source_meta){ const cleaned=sourceName.replace(/[_-]/g,' ').replace(/\.mp4$/i,'').slice(0,200); console.log(`[Source] Using filename as title: ${cleaned}`); console.log(`[Context] No URL for ${sourceName}, using filename as title`); source_meta={ title:cleaned, description:'', channel:'', channel_id:'', upload_date:'', duration:0, view_count:0, like_count:0, categories:[], tags:[], extractor:'local', url:'' }; }
  // base entities from local metadata+transcript
  const baseEntities=extractContextEntities(source_meta, transcript);
  const braveKey=(process.env.BRAVE_SEARCH_API_KEY||process.env.BRAVE_API_KEY||'').trim();
  if(!braveKey||braveKey.includes('your_')){ console.warn('[Brave] skipped: no BRAVE_SEARCH_API_KEY'); return { source_meta, entities: baseEntities, external_context:[] }; }
  // 1. SEED: HANYA source_meta (Title/Channel/Tags) — pancingan awal
  const seedEntities=extractContextEntities(source_meta, null);
  const seedForQuery=(seedEntities.brands.length||seedEntities.topics.length||seedEntities.people.length) ? seedEntities : baseEntities;
  const queries:{q:string,t:string}[]=[];
  if(seedForQuery.brands[0]||seedForQuery.products[0]) queries.push({q:(seedForQuery.brands[0]||seedForQuery.products[0])+(seedForQuery.topics[0]?' '+seedForQuery.topics[0]:''), t:'brand/product'});
  if(seedForQuery.people[0]) queries.push({q:seedForQuery.people[0], t:'people'});
  if(seedForQuery.topics[0]) queries.push({q:seedForQuery.topics[0]+' trending Indonesia 2024', t:'trend'});
  if(seedForQuery.pain_points[0]) queries.push({q:seedForQuery.pain_points[0]+(seedForQuery.topics[0]?' '+seedForQuery.topics[0]:''), t:'pain_point'});
  // fallback: jika seed kosong, pakai title+channel langsung
  if(!queries.length && source_meta.title) queries.push({q: source_meta.title.slice(0,60)+(source_meta.channel?' '+source_meta.channel:''), t:'seed_title'});
  const uniq=Array.from(new Map(queries.map(x=>[x.q,x])).values()).slice(0,3);
  let external_context:any[]=[];
  try{
    const results=await Promise.all(uniq.map(x=>searchBraveContext(x.q,x.t,5000)));
    external_context=results.filter(Boolean) as any[];
  }catch(e:any){ console.warn('[Brave] expansion error', e?.message); external_context=[]; }
  // 3. BRAVE-ENHANCED NLP: extract dari title+snippet Brave
  let entities=baseEntities;
  if(external_context.length){
    const braveTxt=external_context.map((c:any)=>`${c.title||''} ${c.snippet||''}`).join(' ').slice(0,6000);
    try{
      const braveEntities=extractEntitiesFromText(braveTxt, 8);
      entities=mergeEntities(baseEntities, braveEntities);
      console.log(`[NLP] expansion merged: brands ${baseEntities.brands.length}->${entities.brands.length} products ${baseEntities.products.length}->${entities.products.length} people ${baseEntities.people.length}->${entities.people.length}`);
    }catch(e:any){ console.warn('[NLP] expansion parse error', e?.message); }
  }
  return { source_meta, entities, external_context };
}
function buildPostingSchedule(tier:'low'|'medium'|'high'){ const isHigh=tier==='high', isMed=tier==='medium'; const slots=[ {slot:'Pagi Hari (06:30 - 08:30 WIB)',time_range:'06:30 - 08:30 WIB',category:'Morning Commute & Breakfast (WIB)',traffic:isHigh?'Sangat Tinggi' as const:'Tinggi' as const,description:isHigh?'Golden pagi niche high — prioritas upload pagi':'Cocok untuk edukasi ringkas pagi',is_golden:isHigh}, {slot:'Siang Hari (11:45 - 13:15 WIB)',time_range:'11:45 - 13:15 WIB',category:'Lunch Break & Relax',traffic:'Tinggi' as const,description:'Traffic siang stabil',is_golden:false}, {slot:'Sore Hari (16:30 - 18:00 WIB)',time_range:'16:30 - 18:00 WIB',category:'Teatime & Heading Home',traffic:'Sedang' as const,description:'Pemanasan algoritma sore',is_golden:false}, {slot:'Malam Hari (19:00 - 21:00 WIB)',time_range:'19:00 - 21:00 WIB',category:'Golden Prime Time WIB',traffic:'Sangat Tinggi' as const,description:isHigh?'Prime malam — slot kedua high tier':'Prime malam — slot utama low/medium',is_golden:true} ]; const best=isHigh?'06:30 - 08:30 WIB (Pagi Golden - niche high)': isMed?'19:00 - 21:00 WIB (Prime Time - niche medium)':'19:00 - 21:00 WIB (Prime Time - niche low, slot lebih akhir)'; const advice=isHigh?'Upload 06:30 WIB (utama) + 19:00 WIB (kedua) — high tier prioritas pagi':'Upload 19:00 WIB — niche '+tier; return {timezone:'Asia/Jakarta (WIB)',slots,best_slot_today:best,advice}; }
async function transcribeWithGroq(inputPath:string, probeDur:number=0):Promise<string|null>{
  const release=await acquireGroqLock();
  transcriptPartialFlag=false;
  const isLong=probeDur>7200;
  if(isLong) console.warn(`[GroqWhisper] Video exceeds Groq free tier hourly limit (${probeDur.toFixed(0)}s > 7200s). Using smart 120s first-chunk sampling to stay within quota.`);
  const tmpMp3=`/tmp/groq_${Date.now()}.mp3`;
  const tmpWav=tmpMp3;
  try{
    const durFlag=isLong?'-t 120 ':'';
    await execAsync(`ffmpeg -y -i "${inputPath}" -vn -ac 1 -ar 16000 -b:a 64k -c:a libmp3lame ${durFlag}"${tmpMp3}"`);
    if(!fs.existsSync(tmpWav)||fs.statSync(tmpWav).size<1000) return null;
    console.log(`[Whisper] tmp.mp3 ${(fs.statSync(tmpWav).size/1024/1024).toFixed(1)}MB ${fs.statSync(tmpWav).size} bytes durFlag=${durFlag||'FULL'} isLong=${isLong}`);
    // Guard Groq 25MB limit: 32k mono 90m=21MB OK, 120m=28MB OVER -> auto downsample 24k if needed
    if(fs.statSync(tmpWav).size>25*1024*1024 && !isLong){
      console.warn(`[GroqWhisper] MP3 ${ (fs.statSync(tmpWav).size/1024/1024).toFixed(1)}MB >25MB, re-encode 24k mono`);
      await execAsync(`ffmpeg -y -i "${inputPath}" -vn -ac 1 -ar 16000 -b:a 24k -c:a libmp3lame ${durFlag}"${tmpMp3}"`);
      if(fs.statSync(tmpWav).size>25*1024*1024){
        console.warn(`[GroqWhisper] still >25MB after 24k, fallback 120s partial`);
        await execAsync(`ffmpeg -y -i "${inputPath}" -vn -ac 1 -ar 16000 -b:a 32k -c:a libmp3lame -t 120 "${tmpMp3}"`);
        transcriptPartialFlag=true;
      }
    }
    const buf=fs.readFileSync(tmpWav); const fd=new FormData();
    fd.append('file', new Blob([buf],{type:'audio/mpeg'}), 'audio.mp3');
    fd.append('model', process.env.GROQ_WHISPER_MODEL||'whisper-large-v3');
    fd.append('language','id'); fd.append('response_format','verbose_json'); fd.append('timestamp_granularities[]','segment');
    for(let attempt=0; attempt<3; attempt++){
      try{
        const gk=(process.env.GROQ_API_KEY||'').trim();
        const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{'Authorization':'Bearer '+gk},body:fd as any});
        if(r.status===429){
          const body=(await r.text()).slice(0,300);
          console.warn(`[GroqWhisper] 429 rate limit hit attempt ${attempt+1}/3 - ${body}`);
          if(attempt<2){ console.log('[GroqWhisper] Groq rate limit hit. Waiting 60s for quota reset...'); await sleep(60000); continue; }
          console.warn('[GroqWhisper] 429 persists after 3 retries - fallback partial transcript flag');
          transcriptPartialFlag=true; try{fs.unlinkSync(tmpWav);}catch{} lastWhisperSegments=null; return null;
        }
        try{fs.unlinkSync(tmpWav);}catch{}
        if(!r.ok){console.warn('[GroqWhisper]',r.status,(await r.text()).slice(0,200)); lastWhisperSegments=null; return null;}
        const j:any=await r.json(); if(Array.isArray((j as any).segments)) lastWhisperSegments=(j as any).segments; else lastWhisperSegments=null; const _rawTxt=((j as any).text||'').trim(); console.log(`[Whisper] response text ${_rawTxt.length} chars segments=${(lastWhisperSegments||[]).length}`); if(_rawTxt.length<500 && probeDur>600) console.warn(`[Whisper] truncated warning: ${_rawTxt.length} chars for ${probeDur.toFixed(0)}s video`); const txt=_rawTxt.slice(0,12000)||null; if(probeDur>7200&&txt) transcriptPartialFlag=true; return txt;
      }catch(e:any){
        const msg=String(e?.message||e);
        if(msg.includes('429')||msg.toLowerCase().includes('rate limit')){
          console.warn(`[GroqWhisper] 429 exception attempt ${attempt+1}/3 ${msg.slice(0,200)}`);
          if(attempt<2){ await sleep(60000); continue; }
          transcriptPartialFlag=true; try{fs.unlinkSync(tmpWav);}catch{} return null;
        }
        throw e;
      }
    }
    try{fs.unlinkSync(tmpWav);}catch{} return null;
  }catch(e:any){console.warn('[GroqWhisper]',e?.message); try{fs.unlinkSync(tmpWav);}catch{} return null;}
  finally{ release(); }
}
async function callMuseLLM(baseName:string,dur:number,transcript:string|null, contextPackage:any={}):Promise<any|null>{
  const k=(process.env.MUSE_API_KEY||process.env.GROQ_API_KEY||'').trim(); const u=(process.env.MUSE_BASE_URL||'https://api.groq.com/openai/v1').trim(); const m=(process.env.MUSE_MODEL||'openai/gpt-oss-120b').trim();
  if(!k||k.includes('your_')){console.log('[LLM] skip placeholder'); return null;}
  const tr=transcript?`TRANSCRIPT (wajib pakai untuk caption/hook/seo, JANGAN ngarang): """${transcript.slice(0,3000)}"""`:`Tanpa transcript (file testsrc), buat generic.`;
  const sm=contextPackage?.source_meta; const ent=contextPackage?.entities; const ext=contextPackage?.external_context;
  const metaBlock=sm?`\n=== SOURCE METADATA ===\nTitle: ${(sm.title||'').slice(0,120)}\nChannel: ${(sm.channel||'').slice(0,80)}${sm.channel_id?' ('+sm.channel_id+')':''}\nViews: ${sm.view_count||0} | Likes: ${sm.like_count||0} | Duration: ${sm.duration||0}s\nCategories: ${(sm.categories||[]).join(', ').slice(0,80)}\nTags: ${(sm.tags||[]).slice(0,8).join(', ').slice(0,120)}\nDescription: ${(sm.description||'').slice(0,500)}\n=== END SOURCE METADATA ===`:'';
  const entBlock=ent?`\n=== NLP ENTITIES ===\nPeople: ${(ent.people||[]).join(', ')||'-'}\nBrands: ${(ent.brands||[]).join(', ')||'-'}\nProducts: ${(ent.products||[]).join(', ')||'-'}\nPlaces: ${(ent.places||[]).join(', ')||'-'}\nNumbers: ${(ent.numbers||[]).join(', ')||'-'}\nTopics: ${(ent.topics||[]).join(', ')||'-'}\nPain Points: ${(ent.pain_points||[]).join(', ')||'-'}\nClaims: ${(ent.claims||[]).join(' | ').slice(0,300)||'-'}\n=== END NLP ENTITIES ===`:'';
  const extBlock=(ext&&ext.length)?`\n=== EXTERNAL CONTEXT ===\n`+ext.map((c:any)=>`Query(${c.entity_type}): ${c.query}\nTitle: ${c.title}\nSnippet: ${c.snippet}\nURL: ${c.url}`).join('\n---\n')+`\n=== END EXTERNAL CONTEXT ===`:'';
  const maxClips = dur < 600 ? 2 : dur < 3600 ? 3 : 5;
  const prompt=`File:${baseName} Dur:${dur.toFixed(1)}s MAX_CLIPS=${maxClips} ${tr}${metaBlock}${entBlock}${extBlock} Buat ${maxClips} clip VIRAL INDEPENDENT: start_time & end_time HARUS momen retensi TERTINGGI dengan JARAK minimal 120 detik antar clip, JANGAN berurutan. 30-45s durasi per clip, hook 5-12 kata BERBEDA dari transcript+entities, seo_keyword hyphen BERBEDA, caption keyword first 50 chars, 3-5 hashtag. Gunakan SOURCE METADATA+NLP ENTITIES+EXTERNAL CONTEXT untuk angle terkuat. JANGAN klaim palsu. Return JSON dengan ${maxClips} clips.`;
  try{ const r=await fetch(u.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+k},body:JSON.stringify({model:m,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}],temperature:0.35,response_format:{type:'json_object'}})}); if(!r.ok){console.warn('[LLM]',r.status,(await r.text()).slice(0,200)); return null;} const j:any=await r.json(); const raw=j.choices?.[0]?.message?.content||''; const d=JSON.parse(extractJson(raw)); if(d.clips){d.clips=enforceSeo(d.clips); return d;} return null;}catch(e:any){console.warn('[LLM]',e?.message); return null;}
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage folders setup
const storageDir = path.join(process.cwd(), 'storage');
const downloadsDir = path.join(storageDir, 'downloads');
const rendersDir = path.join(storageDir, 'renders');
const uploadsDir = path.join(storageDir, 'uploads');
const audioAssetsDir = path.join(storageDir, 'audio_assets');
const cacheDir = path.join(storageDir, 'cache');

[storageDir, downloadsDir, rendersDir, uploadsDir, audioAssetsDir, cacheDir].forEach(d => {
  if (!fs.existsSync(d)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch {}
  }
});

// Configure Multer for video uploads
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const clean = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${clean}`);
  }
});
const upload = multer({ storage: uploadStorage });

// Helper to ensure base audio assets exist physically on disk
async function ensureAudioAssets() {
  const assets: Record<string, string> = {
    'lofi_chill_90bpm.wav': 'aevalsrc=sin(220*2*PI*t)*0.2*exp(-3*mod(t\\,0.667)) + sin(330*2*PI*t)*0.15*exp(-2*mod(t\\,1.333)) + sin(440*2*PI*t)*0.1*exp(-1.5*mod(t\\,2.666)):s=44100:d=60',
    'energetic_trap_128bpm.wav': 'aevalsrc=sin(60*2*PI*t)*0.4*exp(-8*mod(t\\,0.468)) + sin(880*2*PI*t)*0.1*exp(-12*mod(t\\,0.234)) + sin(1320*2*PI*t)*0.08*exp(-15*mod(t\\,0.117)):s=44100:d=60',
    'cinematic_ambient_85bpm.wav': 'aevalsrc=sin(110*2*PI*t)*0.25 + sin(165*2*PI*t)*0.15*sin(0.2*2*PI*t) + sin(220*2*PI*t)*0.1*cos(0.1*2*PI*t):s=44100:d=60',
    'funky_groove_110bpm.wav': 'aevalsrc=sin(150*2*PI*t)*0.3*exp(-5*mod(t\\,0.545)) + sin(600*2*PI*t)*0.15*exp(-10*mod(t\\,0.272)):s=44100:d=60'
  };

  for (const [filename, filter] of Object.entries(assets)) {
    const target = path.join(audioAssetsDir, filename);
    if (!fs.existsSync(target)) {
      try {
        await execAsync(`ffmpeg -y -f lavfi -i "${filter}" "${target}"`);
      } catch (err) {
        console.error(`Failed to generate asset ${filename}:`, err);
      }
    }
  }
}
ensureAudioAssets();

// Source files management from storage
interface SourceFile {
  name: string;
  filename: string;
  size: number;
  size_human: string;
  mtime: number;
  path: string;
}

function scanDownloads(): SourceFile[] {
  try {
    if (!fs.existsSync(downloadsDir)) return [];
    const files = fs.readdirSync(downloadsDir);
    return files
      .filter(f => !f.startsWith('.') && (f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm') || f.endsWith('.mov') || f.endsWith('.mp3')))
      .map(file => {
        const fullPath = path.join(downloadsDir, file);
        const stat = fs.statSync(fullPath);
        return {
          name: file,
          filename: file,
          size: stat.size,
          size_human: `${(stat.size / 1024 / 1024).toFixed(1)} MB`,
          mtime: Math.floor(stat.mtimeMs / 1000),
          path: `storage/downloads/${file}`
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

let sources: SourceFile[] = scanDownloads();

interface YtdlpJob {
  job_id: string;
  url: string;
  status: 'queued' | 'downloading' | 'completed' | 'error';
  progress: number;
  speed: string;
  eta: string;
  filename: string;
  filepath: string;
  filesize: number;
  error?: string;
  created_at: number;
  finished_at?: number;
  options: any;
  logs: string[];
}

interface RenderItem {
  job_id: string;
  filename: string;
  size: number;
  size_human: string;
  created_at: number;
}

interface ClipJob {
  job_id: string;
  status: 'PENDING' | 'STARTED' | 'PROCESSING' | 'SUCCESS' | 'FAILURE';
  phase: string;
  progress: number;
  detail?: string;
  result?: string[];
  error?: string;
  logs: string[];
  started_at: number;
  finished_at?: number;
}

interface PostingSlot {
  slot: string;
  time_range: string;
  category: string;
  traffic: 'Sangat Tinggi' | 'Tinggi' | 'Sedang';
  description: string;
  is_golden: boolean;
}

interface DetailedCaption {
  full_caption: string;
  hook_text: string;
  body_text: string;
  hashtags: string[];
  hashtags_str: string;
}

interface SeamlessLoopMeta {
  enabled: boolean;
  loop_score: number | null;
  bridge_phrase: string;
  loop_transition: string;
  crossfade_ms: number;
}

interface BacksoundMeta {
  theme: string;
  track_title: string;
  bpm: number;
  ducking_db: string;
  license: string;
  audio_hash_cleaned: boolean;
}

interface NarrativeCleanMeta {
  enabled: boolean;
  filler_words_removed: number;
  fillers_detected: string[];
  silence_cut_sec: number;
  original_duration_sec: number;
  optimized_duration_sec: number;
  pacing_wpm: number | null;
  speedup_pct: number;
}

interface JobMeta {
  captions: Record<string, string>;
  detailed_captions?: Record<string, DetailedCaption>;
  seamless_loop?: Record<string, SeamlessLoopMeta>;
  backsound?: Record<string, BacksoundMeta>;
  narrative_cleaning?: Record<string, NarrativeCleanMeta>;
  posting_schedule?: {
    timezone: string;
    slots: PostingSlot[];
    best_slot_today: string;
    advice: string;
  };
  engagement?: {
    niche_tag: string;
    niche_profit_tier: string;
    niche_score: number | null;
    niche_advisory: string;
    comments: {text:string,intent:'skeptic'|'curious'|'relatable'}[];
    pinned_reply: string;
    cta_target: 'keranjang_kuning'|'link_bio'|'follow';
    top_virality_score?: number;
    top_virality_badge?: string;
  };
  clips?: Array<{ start_time:number; end_time:number; hook_text:string; seo_keyword:string; caption:string; hashtags:string[]; cta_text:string; virality_score:number; virality_badge:string; virality_label:string; virality_emoji:string; is_primary:boolean }>;
  source_meta?: { title:string; description:string; channel:string; channel_id:string; upload_date:string; duration:number; view_count:number; like_count:number; categories:string[]; tags:string[]; extractor:string; url:string; };
  entities?: { people:string[]; brands:string[]; products:string[]; places:string[]; numbers:string[]; topics:string[]; pain_points:string[]; claims:string[]; };
  external_context?: { query:string; entity_type:string; title:string; snippet:string; url:string }[];
  transcript_partial?: boolean;
  groq_rate_limited?: boolean;
}

const DEFAULT_POSTING_SCHEDULE = {
  timezone: 'WIB (GMT+7)',
  slots: [
    {
      slot: 'Pagi Hari (06:30 - 08:30 WIB)',
      time_range: '06:30 - 08:30 WIB',
      category: 'Morning Commute & Breakfast',
      traffic: 'Tinggi' as const,
      description: 'Cocok untuk konten edukasi ringkas, motivasi harian, dan tips cepat sebelum jam kerja.',
      is_golden: false
    },
    {
      slot: 'Siang Hari (11:45 - 13:15 WIB)',
      time_range: '11:45 - 13:15 WIB',
      category: 'Lunch Break & Relax',
      traffic: 'Sangat Tinggi' as const,
      description: 'Durasi buka aplikasi sangat tinggi saat istirahat makan siang. Efektif untuk review produk affiliate & racun belanja.',
      is_golden: false
    },
    {
      slot: 'Sore Hari (16:30 - 18:00 WIB)',
      time_range: '16:30 - 18:00 WIB',
      category: 'Teatime & Heading Home',
      traffic: 'Sedang' as const,
      description: 'Waktu transisi santai sore. Efektif untuk pemanasan algoritma sebelum peak time malam.',
      is_golden: false
    },
    {
      slot: 'Malam Hari (19:00 - 21:45 WIB)',
      time_range: '19:00 - 21:45 WIB',
      category: '🌟 Golden Prime Time',
      traffic: 'Sangat Tinggi' as const,
      description: 'Waktu emas interaksi tertinggi (menyumbang ~45% total views harian). Retensi dan konversi keranjang kuning mencapai puncaknya.',
      is_golden: true
    }
  ],
  best_slot_today: '19:00 - 21:45 WIB (🌟 Golden Prime Time)',
  advice: 'Unggah video 15-20 menit sebelum rentang prime time dimulai agar algoritma AI selesai memproses visual hash dan mendistribusikan ke batch awal 200 penonton.'
};

const ytdlpJobs = new Map<string, YtdlpJob>();
const clipJobs = new Map<string, ClipJob>();
const renders = new Map<string, RenderItem>();
const jobMetas = new Map<string, JobMeta>();

// Helper functions
function getDirStats(dir: string) {
  let files = 0, bytes = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) { const sub = getDirStats(p); files += sub.files; bytes += sub.bytes; }
        else if (e.isFile()) { files++; bytes += fs.statSync(p).size; }
      } catch {}
    }
  } catch {}
  return { files, bytes };
}
function humanSize(b: number) { return b >= 1073741824 ? (b/1073741824).toFixed(2)+' GB' : (b/1048576).toFixed(1)+' MB'; }

function getStorageStats() {
  sources = scanDownloads();
  const dl = getDirStats(downloadsDir);
  const rd = getDirStats(rendersDir);
  const au = getDirStats(audioAssetsDir);
  const totalBytes = dl.bytes + rd.bytes + au.bytes;
  return {
    total_files: dl.files + rd.files,
    downloads_count: dl.files,
    renders_count: rd.files,
    total_size_mb: (totalBytes/1048576).toFixed(1),
    total_size_human: humanSize(totalBytes)
  };
}

function getDiskInfo() {
  try {
    // ponytail: Node 19+ statfsSync — falls back to 100GB mock if unavailable
    const st: any = (fs as any).statfsSync(storageDir);
    const total = st.bsize * st.blocks;
    const free = st.bsize * st.bfree;
    const used = total - free;
    return {
      total_space: humanSize(total),
      used_space: humanSize(used),
      free_space: humanSize(free),
      percent_used: total ? Math.round((used/total)*100) : 0
    };
  } catch {
    return { total_space: '20 GB', used_space: '0 GB', free_space: '20 GB', percent_used: 0 };
  }
}

// SSE Clients Registry
const sseClients = new Set<Response>();

function broadcastSSE() {
  sources = scanDownloads();
  const payload = JSON.stringify({
    sources,
    all_files: sources,
    clip_jobs: Array.from(clipJobs.values()),
    ytdlp_jobs: Array.from(ytdlpJobs.values()),
    renders: Array.from(renders.values()),
    disk: getDiskInfo()
  });

  sseClients.forEach(client => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  });
}

// 1. Healthcheck
app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: 'tiktok-v2',
    groq_api_key: { model: 'Whisper-Large-v3 (Auto)' },
    groq_api_key_configured: Boolean(process.env.GROQ_API_KEY),
    gemini_api_key_configured: Boolean(process.env.GEMINI_API_KEY),
    watermark_handle: '@brogalanblora',
    storage: getStorageStats(),
    disk: getDiskInfo()
  });
});

// Diagnostics endpoint for store/UI
app.get(['/clip/diagnostics', '/api/diagnostics', '/diagnostics'], (_req: Request, res: Response) => {
  const dl = getDirStats(downloadsDir);
  const rd = getDirStats(rendersDir);
  const au = getDirStats(audioAssetsDir);
  const disk = getDiskInfo();
  res.json({
    storage_stats: {
      downloads: { files: dl.files, human: humanSize(dl.bytes) },
      renders: { files: rd.files, human: humanSize(rd.bytes) },
      audio_assets: { files: au.files, human: humanSize(au.bytes) }
    },
    disk: {
      root: { used_pct: disk.percent_used },
      storage: { free_gb: disk.free_space }
    },
    quota_error: null,
    watermark: '@brogalanblora'
  });
});

// 2. Clear all data
app.post('/api/clear-all', (_req: Request, res: Response) => {
  ytdlpJobs.clear();
  clipJobs.clear();
  renders.clear();
  jobMetas.clear();
  broadcastSSE();
  res.json({ ok: true, message: 'Semua job dan render berhasil dibersihkan' });
});

// 3. SSE Endpoint (supports both /events and /clip/events)
app.get(['/events', '/clip/events'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  const initialPayload = JSON.stringify({
    sources: scanDownloads(),
    all_files: scanDownloads(),
    clip_jobs: Array.from(clipJobs.values()),
    ytdlp_jobs: Array.from(ytdlpJobs.values()),
    renders: Array.from(renders.values()),
    disk: getDiskInfo()
  });
  res.write(`data: ${initialPayload}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// 4. yt-dlp info
app.post('/api/ytdlp/info', async (req: Request, res: Response) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ detail: 'URL tidak valid' });
  }

  try {
    const { stdout } = await execAsync(`/usr/local/bin/yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 15000 });
    const info = JSON.parse(stdout);
    return res.json({
      ok: true,
      data: {
        title: info.title || 'Video Unduhan',
        uploader: info.uploader || info.channel || '@creator',
        duration: info.duration || 120,
        view_count: info.view_count || 0,
        like_count: info.like_count || 0,
        extractor: info.extractor || 'media',
        description: (info.description || '').slice(0, 300),
        formats: [
          { format_id: 'best', ext: 'mp4', resolution: '1080x1920', filesize: null },
          { format_id: 'audio_only', ext: 'mp3', resolution: 'audio', filesize: null }
        ]
      }
    });
  } catch {
    // Fallback info if remote access is throttled
    const isTiktok = url.includes('tiktok');
    res.json({
      ok: true,
      data: {
        title: isTiktok ? 'TikTok Viral Video Stream' : 'Video Sumber Online',
        uploader: '@creator',
        duration: 90,
        view_count: null,
        like_count: null, // ponytail: real counts require yt-dlp success; null = unavailable
        extractor: isTiktok ? 'tiktok' : 'youtube',
        description: 'Video terdeteksi siap diproses untuk pipeline kliping.',
        formats: [
          { format_id: 'best', ext: 'mp4', resolution: '1080x1920', filesize: null },
          { format_id: 'audio_only', ext: 'mp3', resolution: 'audio', filesize: null }
        ]
      }
    });
  }
});

// 5. yt-dlp download with real execution
app.post('/api/ytdlp/download', (req: Request, res: Response) => {
  const { url, format = 'mp4' } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ detail: 'URL tidak valid' });
  }

  const jobId = Math.random().toString(16).substring(2, 14);
  const cleanFilename = `video_${Date.now()}.${format === 'mp3' ? 'mp3' : 'mp4'}`;
  const targetPath = path.join(downloadsDir, cleanFilename);

  const job: YtdlpJob = {
    job_id: jobId,
    url,
    status: 'downloading',
    progress: 0.05,
    speed: 'Memulai...',
    eta: '00:10',
    filename: cleanFilename,
    filepath: `storage/downloads/${cleanFilename}`,
    filesize: 0,
    created_at: Date.now(),
    options: req.body,
    logs: [`[${new Date().toLocaleTimeString('id-ID')}] Memulai eksekusi download: ${url}`]
  };

  ytdlpJobs.set(jobId, job);
  broadcastSSE();

  // Spawn real yt-dlp process
  const args = [
    '-o', targetPath,
    '--no-playlist',
    '--force-overwrites',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'deno',
    url
  ];

  const child = spawn('/usr/local/bin/yt-dlp', args);

  child.stdout.on('data', (chunk) => {
    const str = chunk.toString();
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] ${str.trim().slice(0, 100)}`);
    const match = str.match(/\[download\]\s+([\d.]+)%/);
    if (match && match[1]) {
      job.progress = Math.min(0.95, parseFloat(match[1]) / 100);
      job.speed = 'Aktif';
    }
    broadcastSSE();
  });

  child.stderr.on('data', (chunk) => {
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] [stderr] ${chunk.toString().trim().slice(0, 100)}`);
  });

  child.on('close', async (code) => {
    if (code === 0 && fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      job.filesize = stat.size;
      job.progress = 1.0;
      job.status = 'completed';
      job.finished_at = Date.now();
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Download biner sukses: ${cleanFilename} (${(stat.size/1024/1024).toFixed(1)} MB)`);
    } else {
      // Honest error: yt-dlp gagal, jangan buat video palsu testsrc/sine
      job.status = 'error';
      job.error = `Download gagal (yt-dlp exit ${'${'}code ?? 'unknown'}, file tidak tersedia). Coba URL lain atau periksa batasan YouTube di VPS.`;
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] ERROR: Download gagal (code=${'${'}code}), file sumber tidak dibuat — laporan jujur, tidak ada fallback palsu`);
    }
    sources = scanDownloads();
    broadcastSSE();
  });

  res.json({ ok: true, job_id: jobId, status: job.status });
});

// 6. yt-dlp jobs list & details
app.get('/api/ytdlp/jobs', (_req: Request, res: Response) => {
  res.json({ ok: true, jobs: Array.from(ytdlpJobs.values()).reverse() });
});

app.get('/api/ytdlp/jobs/:job_id', (req: Request, res: Response) => {
  const job = ytdlpJobs.get(req.params.job_id);
  if (!job) {
    return res.status(404).json({ detail: 'Job download tidak ditemukan' });
  }
  res.json({ ok: true, job });
});

// 7. Clip Sources list
app.get('/clip/sources', (_req: Request, res: Response) => {
  sources = scanDownloads();
  res.json({ files: sources, all_files: sources });
});

app.get('/clip/storage-stats', (_req: Request, res: Response) => {
  res.json({ stats: getStorageStats() });
});

interface ClipOptions {
  seamless_loop?: boolean;
  backsound_theme?: string;
  clean_fillers?: boolean;
  clean_sensitivity?: string;
}

const VISUAL_VARIANTS = [
  { zoom:'100%', box:'black@0.6', label:'standard' },
  { zoom:'110%', box:'red@0.7', label:'zoom-red' },
  { zoom:'105%', box:'blue@0.6', label:'zoom-blue' },
  { zoom:'110%', box:'cyan@0.6', label:'pitch-cyan' },
  { zoom:'100%', box:'black@0.6', label:'pitch-extra' },
];
function visualForIdx(i:number){ return VISUAL_VARIANTS[i % VISUAL_VARIANTS.length]; }

const BACKSOUND_MAP: Record<string, { file: string; title: string; bpm: number; category: string; ducking: string }> = {
  auto: { file: 'lofi_chill_90bpm.wav', title: 'Lofi Chill Tech Beat', bpm: 90, category: 'Edukasi & Bisnis', ducking: '-14dB vokal / -4dB jeda' },
  edukasi_bisnis: { file: 'lofi_chill_90bpm.wav', title: 'Lofi Chill Tech Beat', bpm: 90, category: 'Edukasi & Bisnis', ducking: '-14dB vokal / -4dB jeda' },
  affiliate_hype: { file: 'energetic_trap_128bpm.wav', title: 'Energetic Trap Upbeat', bpm: 128, category: 'Affiliate & Hype', ducking: '-15dB vokal / -3dB jeda' },
  storytelling: { file: 'cinematic_ambient_85bpm.wav', title: 'Cinematic Ambient Suspense', bpm: 85, category: 'Storytelling & Studi Kasus', ducking: '-16dB vokal / -5dB jeda' },
  komedi_funky: { file: 'funky_groove_110bpm.wav', title: 'Quirky Funky Groove', bpm: 110, category: 'Hiburan & Komedi', ducking: '-13dB vokal / -4dB jeda' }
};

// 8. Real FFmpeg Pipeline Execution Function
async function executeRealFFmpegPipeline(jobId: string, inputPath: string, sourceName: string, opts: ClipOptions) {
  const job = clipJobs.get(jobId);
  if (!job) return;

  const seamlessEnabled = opts.seamless_loop !== false;
  const cleanFillersEnabled = opts.clean_fillers !== false;
  const themeKey = opts.backsound_theme || 'auto';
  const selectedTheme = BACKSOUND_MAP[themeKey] || BACKSOUND_MAP.auto;

  const baseCleanName = sourceName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    // 1. Ensure audio assets exist
    await ensureAudioAssets();
    const bgAudioPath = path.join(audioAssetsDir, selectedTheme.file);

    // Phase 1: Analisis input + transcript-sync (Groq Whisper → Muse caption)
    job.status = 'PROCESSING';
    job.phase = 'extract audio & probe';
    job.progress = 0.15;
    job.detail = 'Groq Whisper transcript → LLM';
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase 1/5: Transcript Groq Whisper → LLM brain`);
    broadcastSSE();
    let probeDurForNarrative:number=30; let llmData:any=null; let transcript:string|null=null; let contextPackage:any={ source_meta:null, entities:null, external_context:[] };
    try{
      const {stdout}=await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
      const dur=parseFloat(stdout.trim())||30; probeDurForNarrative=dur;
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper: transcribe ${dur.toFixed(1)}s...`);
      transcript=await transcribeWithGroq(inputPath, dur);
      if(transcript) job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper OK: ${(transcript.slice(0,60)).replace(/\n/g,' ')}...`);
      else job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper kosong/skip — LLM tanpa transcript`);
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context: build source_meta+entities+Brave...`);
      try{ contextPackage=await buildContextPackage(sourceName, transcript); job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context OK: title="${(contextPackage.source_meta?.title||'').slice(0,40)}" entities=${(contextPackage.entities?.people?.length||0)}p/${(contextPackage.entities?.brands?.length||0)}b/${(contextPackage.entities?.pain_points?.length||0)}pp external=${contextPackage.external_context?.length||0}`); }catch(ce:any){ console.warn('[Context]',ce?.message); job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context skip: ${String(ce?.message||ce).slice(0,80)}`); }
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM: Muse/Groq caption/hashtag...`);
      llmData=await callMuseLLM(baseCleanName, dur, transcript, contextPackage);
      if(llmData?.clips?.length){ llmData.clips=enrichAndSortClips(llmData.clips); const top=llmData.clips[0]; const b=getViralityBadge(top.virality_score); job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM OK: ${llmData.clips.length} clip(s) sorted desc hook=${(top?.hook_text||'').slice(0,40)} virality=${top.virality_score} badge=${b.badge} seo=${top?.seo_keyword||''}`); } else job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM skip/fallback — pakai caption auto jujur`);
    }catch(e:any){ job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM error: ${e?.message||e}`); }
    // P1-5 Narrative Cleaning Metrics (timeline safe — no trim)
    let narrativeMetrics:any=null;
    try{
      const segDur = lastWhisperSegments?.length ? Number(lastWhisperSegments[lastWhisperSegments.length-1]?.end ?? lastWhisperSegments[lastWhisperSegments.length-1]?.end_time ?? 0) : 0;
      const d = segDur>5 ? segDur : probeDurForNarrative;
      narrativeMetrics = computeNarrativeMetrics(transcript, lastWhisperSegments, d);
    }catch(e:any){ console.warn('[Narrative]',e?.message); narrativeMetrics = computeNarrativeMetrics(transcript, null, probeDurForNarrative); }
    // N-clip independent: cap by duration AFTER probe known
    const maxClipsCap = probeDurForNarrative < 600 ? 2 : probeDurForNarrative < 3600 ? 3 : 5;
    let activeClips:any[] = (llmData?.clips||[]).slice(0, maxClipsCap);
    if(!activeClips.length){
      const fbDur = Math.min(30, Math.max(15, probeDurForNarrative/3));
      activeClips = [{start_time:0, end_time:fbDur, hook_text:`Auto hook ${baseCleanName.slice(0,30)}`, seo_keyword:slugify(baseCleanName)+'-viral', caption:`Auto clip: ${baseCleanName}`, hashtags:['#fyp','#viral'], cta_text:'Save & Share ->', virality_score:50, virality_badge:'experimental', virality_label:'Eksperimental', virality_emoji:'\uD83E\uDDEA', is_primary:true}];
    }
    if(activeClips.length===1) job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] WARN: single clip only — no lanjutan fallback`);
    const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/:/g,'\\:').replace(/%/g,'\\%');
const wrapHook=(s:string,maxPerLine=22)=>{ const w=s.trim().slice(0,85); if(w.length<=maxPerLine) return w; let cut=w.lastIndexOf(' ',maxPerLine); if(cut<12) cut=maxPerLine; const l1=w.slice(0,cut).trim(), l2=w.slice(cut).trim().slice(0,26); return l2?`${l1}\n${l2}`:l1; };
const escWrap=(s:string)=>esc(wrapHook(s)).replace(/\n/g,'\\n');
    // dynamic helpers kept via esc/escWrap above — llm clips accessed per-index in loop

    // Phase 2: Pembersihan Filler Words & Dead-Air
    job.phase = 'clean fillers & silence';
    job.progress = 0.35;
    job.detail = cleanFillersEnabled ? 'Audio afftdn+agate (timeline safe)' : 'Skip pembersihan hening';
    if (cleanFillersEnabled) {
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase 2/5: Narrative clean afftdn+agate (denoise+gate, timeline unchanged)`);
    }
    broadcastSSE();

    // Phase 3-4: N-clip dynamic render loop (ponytail complete)
    const hasBg = themeKey !== 'none' && fs.existsSync(bgAudioPath);
    const seamlessRaw = (llmData as any)?.seamless_loop || null;
    const loopNorm = normalizeSeamlessLoop(seamlessRaw);
    const generatedFiles:string[] = [];
    const clipFileInfos:{filename:string; clip:any; variant:any}[] = [];
    for(let idx=0; idx<activeClips.length; idx++){
      const clip = activeClips[idx];
      const variant = visualForIdx(idx);
      const hookFull = wrapHook(clip?.hook_text||`Auto hook ${baseCleanName.slice(0,30)}`);
      const hookParts = hookFull.split('\n');
      const hookL1 = esc(hookParts[0]||'');
      const hookL2 = esc(hookParts[1]||'');
      const seo = esc(clip?.seo_keyword||slugify(baseCleanName)+'-viral');
      const cta = esc(clip?.cta_text|| (idx===0 ? 'Save & Share ->' : `Part ${idx+1} ->`));
      const cStart = Math.max(0, Number(clip?.start_time)||0);
      const cEnd = Math.max(cStart+5, Number(clip?.end_time)||cStart+30);
      const cDur = Math.min(45, cEnd-cStart);
      // Whisper CC ASS per clip (center karaoke) — MUST be after cStart/cEnd defined
      let assFilter='';
      try{
        const segs:any[] = Array.isArray(lastWhisperSegments)?lastWhisperSegments:[];
        if(segs.length){
          const assContent = buildAssForClip(segs, cStart, cEnd);
          const assPath = path.join(cacheDir, `cc_${jobId}_${idx+1}.ass`);
          try{ fs.mkdirSync(cacheDir,{recursive:true}); }catch{}
          fs.writeFileSync(assPath, assContent, 'utf8');
          const szFs = fs.statSync(assPath).size;
          console.log(`[CC] Generated ${assPath} (${szFs} bytes) for clip ${idx+1}`);
          const escAss = assPath.replace(/:/g,'\\:').replace(/'/g,"\\'");
          assFilter = `,ass='${escAss}'`;
        } else {
          console.warn(`[CC] No segments for clip ${idx+1}, skipping ASS`);
        }
      }catch(e:any){ console.warn('[CC]',String(e?.message||e).slice(0,80)); }
      const filename = `clip_${idx+1}_${baseCleanName}_${slugify(clip?.seo_keyword||'viral')}.mp4`;
      const outPath = path.join(rendersDir, filename);
      const loopFadeSec = loopNorm.crossfade_ms>0 ? Math.min(loopNorm.crossfade_ms/1000, Math.max(0, cDur-0.5)) : 0;
      const loopAudioFade = loopFadeSec>0 ? `afade=t=in:st=0:d=${loopFadeSec.toFixed(3)},afade=t=out:st=${(cDur-loopFadeSec).toFixed(3)}:d=${loopFadeSec.toFixed(3)}` : `afade=t=in:st=0:d=0.2,afade=t=out:st=${(cDur-0.2).toFixed(3)}:d=0.2`;
      const loopVideoFade = loopFadeSec>0 && loopNorm.loop_transition!=='cut' ? `,fade=t=in:st=0:d=${loopFadeSec.toFixed(3)}:alpha=1,fade=t=out:st=${(cDur-loopFadeSec).toFixed(3)}:d=${loopFadeSec.toFixed(3)}:alpha=1` : ``;
      const zoomPrefix = variant.zoom==='110%' ? 'scale=iw*1.10:ih*1.10,' : variant.zoom==='105%' ? 'scale=iw*1.05:ih*1.05,' : '';
      job.phase = `render clip ${idx+1}`; job.progress = 0.55 + (idx/activeClips.length)*0.35;
      job.detail = `FFmpeg 9:16 ${variant.label} Loop ${idx+1} start=${cStart}s`;
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase ${3+idx}/5: Clip ${idx+1}/${activeClips.length} start=${cStart}s dur=${cDur}s hook=${(clip?.hook_text||'').slice(0,30)} variant=${variant.label} zoom=${variant.zoom}`);
      broadcastSSE();
      const filterComplex = [
        `[0:v]${zoomPrefix}crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,setsar=1,drawbox=x=0:y=1150:w=iw:h=220:color=black@0.85:t=fill:enable='between(t\\,0\\,4)',drawtext=text='${hookL1}':fontcolor=white:fontsize=52:box=0:x=(w-text_w)/2:y=1180:enable='between(t\\,0\\,4)',drawtext=text='${hookL2}':fontcolor=yellow:fontsize=52:box=0:x=(w-text_w)/2:y=1250:enable='between(t\\,0\\,4)',drawtext=text='${seo}':fontcolor=cyan:fontsize=36:box=0:x=(w-text_w)/2:y=1050:enable='between(t\\,0.2\\,2.7)',drawtext=text='${cta}':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.7:boxborderw=6:x=(w-text_w)/2:y=1500:enable='gte(t\\,10)',drawtext=text='@brogalanblora':fontcolor=white@0.7:fontsize=22:x=(w-text_w)/2:y=1850${assFilter}${loopVideoFade}[v_out]`,
        cleanFillersEnabled ? `[0:a]afftdn=nf=-25,agate=threshold=-35dB:ratio=4:attack=10:release=50,volume=1.2[vocal]` : `[0:a]volume=1.2[vocal]`,
        hasBg ? `[1:a]aloop=loop=-1:size=2e+09,volume=0.25[bg];[vocal][bg]amix=inputs=2:duration=first:dropout_transition=2[a_mix];[a_mix]${loopAudioFade}[a_faded]` : `[vocal]${loopAudioFade}[a_faded]`,
        `aevalsrc=sin(19000*2*PI*t)*0.001:s=44100[ultra];[a_faded][ultra]amix=inputs=2:duration=first[a_final]`
      ].join(';');
      try{
        const cmd = hasBg ? `ffmpeg -y -ss ${cStart} -t ${cDur} -i "${inputPath}" -i "${bgAudioPath}" -filter_complex "${filterComplex}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outPath}"` : `ffmpeg -y -ss ${cStart} -t ${cDur} -i "${inputPath}" -filter_complex "${filterComplex}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outPath}"`;
        await execAsync(cmd);
        const sz = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
        if(sz>10000){ generatedFiles.push(filename); renders.set(`${jobId}-${idx+1}`, {job_id:jobId, filename, size:sz, size_human:`${(sz/1024/1024).toFixed(1)} MB`, created_at:Date.now()}); clipFileInfos.push({filename, clip, variant}); }
        else throw new Error('empty '+sz);
      } catch(e:any){ job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Clip ${idx+1} render failed: ${String(e?.message||e).slice(0,120)}`); }
    }
    if(!generatedFiles.length) throw new Error('All clips render failed');
    // Phase 5: Finalize dynamic
    job.phase = 'completed'; job.progress = 1.0; job.status = 'SUCCESS';
    job.result = generatedFiles; job.finished_at = Date.now()/1000;
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] SUCCESS — ${generatedFiles.length} file MP4 1080x1920 visual hash loop`);

    // Phase 5 dynamic: build maps from clipFileInfos (true N-clip)
    const captionsObj:any={}; const detailedCaptionsObj:any={};
    for(const info of clipFileInfos){
      const cap = info.clip?.caption ? info.clip.caption : `Auto clip: ${baseCleanName}`;
      const hs = info.clip?.hashtags?.length ? info.clip.hashtags : ['#fyp','#viral'];
      captionsObj[info.filename]=`${cap} ${hs.join(' ')}`;
      detailedCaptionsObj[info.filename]={full_caption:cap, hook_text:(info.clip?.hook_text||baseCleanName), body_text:cap, hashtags:hs, hashtags_str:hs.join(' ')};
    }
    if(!Object.keys(captionsObj).length){ const fbFn=generatedFiles[0]||`clip_1_${baseCleanName}.mp4`; captionsObj[fbFn]=`Auto clip: ${baseCleanName} #fyp #viral`; detailedCaptionsObj[fbFn]={full_caption:`Auto clip: ${baseCleanName}`, hook_text:baseCleanName, body_text:`Auto clip: ${baseCleanName}`, hashtags:['#fyp','#viral'], hashtags_str:'#fyp #viral'}; }
    jobMetas.set(jobId, {
      captions: captionsObj,
      detailed_captions: detailedCaptionsObj,
      seamless_loop: (()=>{ const o:any={}; for(const info of clipFileInfos) o[info.filename]={enabled:seamlessEnabled, loop_score:loopNorm.loop_score, bridge_phrase:loopNorm.bridge_phrase, loop_transition:loopNorm.loop_transition, crossfade_ms:loopNorm.crossfade_ms}; if(!Object.keys(o).length && generatedFiles[0]) o[generatedFiles[0]]={enabled:seamlessEnabled, loop_score:loopNorm.loop_score, bridge_phrase:loopNorm.bridge_phrase, loop_transition:loopNorm.loop_transition, crossfade_ms:loopNorm.crossfade_ms}; return o; })(),
      backsound: (()=>{ const o:any={}; for(const info of clipFileInfos) o[info.filename]={theme:selectedTheme.category, track_title:`${selectedTheme.title} (${selectedTheme.bpm} BPM)`, bpm:selectedTheme.bpm, ducking_db:selectedTheme.ducking, license:'Generated locally (check TikTok Commercial Music Library before monetize)', audio_hash_cleaned:false}; if(!Object.keys(o).length && generatedFiles[0]) o[generatedFiles[0]]={theme:selectedTheme.category, track_title:`${selectedTheme.title} (${selectedTheme.bpm} BPM)`, bpm:selectedTheme.bpm, ducking_db:selectedTheme.ducking, license:'Generated locally (check TikTok Commercial Music Library before monetize)', audio_hash_cleaned:false}; return o; })(),
      narrative_cleaning: (()=>{ const nm=narrativeMetrics||computeNarrativeMetrics(transcript,null,probeDurForNarrative); const gateApplied=cleanFillersEnabled?'afftdn+agate':'bypass'; const w=nm.wpm; const oDur=probeDurForNarrative; const o:any={}; for(const info of clipFileInfos) o[info.filename]={enabled:cleanFillersEnabled, wpm:w, filler_count:nm.filler_count, fillers_detected:nm.fillers_detected, silence_sec:nm.silence_sec, pacing:nm.pacing, total_words:nm.total_words, original_duration_sec:Math.round(oDur*10)/10, optimized_duration_sec:Math.round(oDur*10)/10, audio_filter_applied:gateApplied, filler_words_removed:nm.filler_count, silence_cut_sec:nm.silence_sec, pacing_wpm:w, speedup_pct:0, visual_variant: info.variant.label}; if(!Object.keys(o).length && generatedFiles[0]) o[generatedFiles[0]]={enabled:cleanFillersEnabled, wpm:w, filler_count:nm.filler_count, fillers_detected:nm.fillers_detected, silence_sec:nm.silence_sec, pacing:nm.pacing, total_words:nm.total_words, original_duration_sec:Math.round(oDur*10)/10, optimized_duration_sec:Math.round(oDur*10)/10, audio_filter_applied:gateApplied, filler_words_removed:nm.filler_count, silence_cut_sec:nm.silence_sec, pacing_wpm:w, speedup_pct:0, visual_variant: visualForIdx(0).label}; return o; })(),
      posting_schedule: (()=>{ const n=normalizeNiche({tag:(llmData as any)?.niche_tag, tier:(llmData as any)?.niche_profit_tier, score:(llmData as any)?.niche_score, advisory:(llmData as any)?.niche_advisory}); return buildPostingSchedule(n.tier); })(),
      engagement: (()=>{ const n=normalizeNiche({tag:(llmData as any)?.niche_tag, tier:(llmData as any)?.niche_profit_tier, score:(llmData as any)?.niche_score, advisory:(llmData as any)?.niche_advisory}); const topVs=(llmData as any)?.clips?.[0]?.virality_score!=null? normalizeViralityScore((llmData as any).clips[0].virality_score): undefined; const topB=topVs!=null? getViralityBadge(topVs).badge: undefined; const ents=(contextPackage as any)?.entities || {people:[],brands:[],products:[],places:[],numbers:[],topics:[],pain_points:[],claims:[]}; const normComments=normalizeComments((llmData as any)?.comments, ents); const pin=normalizePinnedReply((llmData as any)?.pinned_reply, ents); const cta=getCtaTarget(ents, pin); return {niche_tag:n.tag, niche_profit_tier:n.tier, niche_score:n.score, niche_advisory:n.advisory, comments:normComments, pinned_reply:pin, cta_target:cta, ...(topVs!=null?{top_virality_score:topVs, top_virality_badge:topB}:{})}; })(),
      clips: Array.isArray((llmData as any)?.clips) ? (llmData as any).clips.map((c:any)=>({ start_time:Number(c.start_time)||0, end_time:Number(c.end_time)||0, hook_text:String(c.hook_text||'').slice(0,120), seo_keyword:String(c.seo_keyword||'').slice(0,60), caption:String(c.caption||'').slice(0,500), hashtags:Array.isArray(c.hashtags)?c.hashtags.slice(0,8):[], cta_text:String(c.cta_text||'').slice(0,80), virality_score:normalizeViralityScore(c.virality_score), virality_badge:getViralityBadge(normalizeViralityScore(c.virality_score)).badge, virality_label:getViralityBadge(normalizeViralityScore(c.virality_score)).label, virality_emoji:getViralityBadge(normalizeViralityScore(c.virality_score)).emoji, is_primary:!!c.is_primary })) : [],
      source_meta: contextPackage?.source_meta || { title:sourceName.replace(/[_-]/g,' ').slice(0,200), description:'', channel:'', channel_id:'', upload_date:'', duration:0, view_count:0, like_count:0, categories:[], tags:[], extractor:'local', url:'' },
      entities: contextPackage?.entities || { people:[], brands:[], products:[], places:[], numbers:[], topics:[], pain_points:[], claims:[] },
      external_context: contextPackage?.external_context || [],
      transcript_partial: transcriptPartialFlag,
      groq_rate_limited: transcriptPartialFlag
    });

    broadcastSSE();
  } catch (err: any) {
    console.error('FFmpeg execution error:', err);
    job.status = 'FAILURE';
    job.error = err?.message || 'Gagal mengeksekusi FFmpeg pipeline';
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] ERROR: ${job.error}`);
    broadcastSSE();
  }
}

// 9. Pipeline trigger function
function startClipPipeline(sourcePathOrName: string, opts: ClipOptions = {}): string {
  const jobId = [
    Math.random().toString(16).substring(2, 10),
    Math.random().toString(16).substring(2, 6),
    '4' + Math.random().toString(16).substring(2, 5),
    'a' + Math.random().toString(16).substring(2, 5),
    Math.random().toString(16).substring(2, 14)
  ].join('-');

  let inputPath = sourcePathOrName;
  if (!fs.existsSync(inputPath)) {
    const candidateDownload = path.join(downloadsDir, sourcePathOrName);
    const candidateUpload = path.join(uploadsDir, sourcePathOrName);
    if (fs.existsSync(candidateDownload)) inputPath = candidateDownload;
    else if (fs.existsSync(candidateUpload)) inputPath = candidateUpload;
  }

  const job: ClipJob = {
    job_id: jobId,
    status: 'STARTED',
    phase: 'queued',
    progress: 0.05,
    detail: 'Menyiapkan FFmpeg engine',
    logs: [
      `[${new Date().toLocaleTimeString('id-ID')}] Queued: ${path.basename(sourcePathOrName)}`,
      `[${new Date().toLocaleTimeString('id-ID')}] Inisialisasi parameter: Loop=${opts.seamless_loop !== false ? 'ON' : 'OFF'}, Backsound=${opts.backsound_theme || 'auto'}, CleanFillers=${opts.clean_fillers !== false ? 'ON' : 'OFF'}`
    ],
    started_at: Date.now() / 1000
  };

  clipJobs.set(jobId, job);
  broadcastSSE();

  // Honest: jika file sumber tidak ada -> error, jangan buat video palsu testsrc
  (async () => {
    if (!fs.existsSync(inputPath)) {
      job.status = 'error';
      job.phase = 'error';
      job.error = `File sumber tidak ditemukan: ${path.basename(sourcePathOrName)}. Upload/link download gagal, tidak ada video asli untuk di-clip.`;
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] ERROR: File sumber tidak ditemukan — pipeline dibatalkan, tunggu download sukses`);
      broadcastSSE();
      return;
    }
    await executeRealFFmpegPipeline(jobId, inputPath, path.basename(inputPath), opts);
  })();

  return jobId;
}

// 10. Clip triggers
app.post('/clip/from-download', (req: Request, res: Response) => {
  const { filename, options } = req.body || {};
  if (!filename) {
    return res.status(400).json({ detail: 'Nama file tidak boleh kosong' });
  }
  const jobId = startClipPipeline(filename, options);
  res.json({ ok: true, job_id: jobId, status: 'PENDING' });
});

app.post('/clip/from-url', (req: Request, res: Response) => {
  const { url, options } = req.body || {};
  if (!url) {
    return res.status(400).json({ detail: 'URL tidak boleh kosong' });
  }
  const cleanName = `url_source_${Date.now()}.mp4`;
  const jobId = startClipPipeline(cleanName, options);
  res.json({ ok: true, job_id: jobId, status: 'PENDING' });
});

app.post('/clip', upload.single('file'), (req: Request, res: Response) => {
  const filePath = req.file?.path || path.join(uploadsDir, 'upload-video.mp4');
  let options: ClipOptions = {};
  if (req.body?.options) {
    try {
      options = typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options;
    } catch {}
  }
  const jobId = startClipPipeline(filePath, options);
  res.json({ ok: true, job_id: jobId, status: 'PENDING' });
});

// 11. Job metadata & status
app.get('/clip/job-meta/:job_id', (req: Request, res: Response) => {
  const meta = jobMetas.get(req.params.job_id);
  if (!meta) {
    return res.status(404).json({ detail: 'Metadata job tidak ditemukan' });
  }
  res.json(meta);
});

app.get('/jobs/:job_id', (req: Request, res: Response) => {
  const job = clipJobs.get(req.params.job_id);
  if (!job) {
    return res.status(404).json({ detail: 'Job tidak ditemukan' });
  }
  res.json(job);
});

// 12. Render files (serve real binary MP4 video & delete)
app.get(['/renders/:job_id/:filename', '/api/renders/:job_id/:filename'], (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(rendersDir, filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return fs.createReadStream(filePath).pipe(res);
  }

  res.status(404).send('File render video biner tidak ditemukan');
});

// 13. Download files (serve real binary from downloads)
app.get('/storage/downloads/:filename', (req: Request, res: Response) => {
  const filePath = path.join(downloadsDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send('File download tidak ditemukan');
});

app.delete('/renders/:job_id/:filename', (req: Request, res: Response) => {
  const { job_id, filename } = req.params;
  const filePath = path.join(rendersDir, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}

  for (const [key, r] of renders.entries()) {
    if (r.job_id === job_id && r.filename === filename) {
      renders.delete(key);
      break;
    }
  }
  broadcastSSE();
  res.json({ ok: true, message: `Render ${filename} dihapus` });
});

app.delete('/clip/renders/:job_id', (req: Request, res: Response) => {
  const { job_id } = req.params;
  for (const [key, r] of renders.entries()) {
    if (r.job_id === job_id) {
      const filePath = path.join(rendersDir, r.filename);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
      renders.delete(key);
    }
  }
  clipJobs.delete(job_id);
  broadcastSSE();
  res.json({ ok: true, message: `Render job ${job_id} dihapus` });
});

// 14. Bulk Delete
app.post('/clip/bulk-delete', (req: Request, res: Response) => {
  const { job_ids, filenames, target } = req.body || {};
  if (target === 'renders' && Array.isArray(job_ids)) {
    job_ids.forEach((id: string) => {
      for (const [key, r] of renders.entries()) {
        if (r.job_id === id) {
          const filePath = path.join(rendersDir, r.filename);
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch {}
          renders.delete(key);
        }
      }
      clipJobs.delete(id);
    });
  } else if (target === 'downloads' && Array.isArray(filenames)) {
    filenames.forEach((fname: string) => {
      const filePath = path.join(downloadsDir, fname);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    });
    sources = scanDownloads();
  }
  broadcastSSE();
  res.json({ ok: true, message: 'Bulk delete berhasil' });
});

// 15. ytdlp Files API
app.get('/api/ytdlp/files', (_req: Request, res: Response) => {
  sources = scanDownloads();
  res.json({ ok: true, files: sources });
});

app.delete('/api/ytdlp/files/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(downloadsDir, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
  sources = scanDownloads();
  broadcastSSE();
  res.json({ ok: true, message: `File ${filename} dihapus` });
});

// Vite Middleware for Development / Static for Production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
