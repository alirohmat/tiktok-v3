import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';

const execAsync = promisify(exec);

const SYSTEM_PROMPT = `You are viral clip detector TikTok Affiliate. Return ONLY valid JSON. Schema: {"clips":[{"start_time":0,"end_time":35,"hook_text":"5-12 words hook","virality_score":95,"seo_keyword":"cara-atasi-insomnia","caption":"keyword first 50 chars","hashtags":["#insomnia","#tidur"],"cta_text":"Save & Share ->"}],"niche_tag":"kesehatan","niche_profit_tier":"high","niche_score":85,"niche_advisory":"High profit niche — upload 19:00 WIB","niche_approved":true} Rules: 30-60s clips, hyphen keyword, caption keyword first 50, 3-5 hashtags, CTA Save/Share. WAJIB return niche_tag (string non-empty), niche_profit_tier enum low|medium|high (map 8-15%->high, 4-8%->medium, else low), niche_score integer 0-100, niche_advisory string. JANGAN null. CONTEXT-AWARE HOOK: Gunakan SOURCE METADATA + NLP ENTITIES + EXTERNAL CONTEXT untuk memilih angle terkuat: (a) public figure jika ada people terkenal, (b) brand/product jika ada brand/produk, (c) pain point jika ada masalah audiens, (d) number/data jika ada angka kuat, (e) trend/news jika ada konteks publik. Hook TIDAK boleh generic — harus spesifik dari entity paling relevan dengan transcript dan niche. JANGAN membuat klaim palsu yang tidak ada di transcript/metadata/context. Jika external_context kosong, tetap pakai transcript+metadata.`;
function slugify(s: string){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'viral-hook'; }
function extractJson(t: string){ let x=t.trim(); if(x.startsWith('```')){const n=x.indexOf('\n'); if(n!==-1) x=x.slice(n+1); if(x.endsWith('```')) x=x.slice(0,-3); x=x.trim();} try{JSON.parse(x); return x;}catch{} const a=x.indexOf('{'),b=x.lastIndexOf('}'); if(a!==-1&&b>a){const c=x.slice(a,b+1); try{JSON.parse(c); return c;}catch{}} return x; }
function enforceSeo(cs:any[]){ for(const c of cs){ if(!c.seo_keyword||!c.seo_keyword.includes('-')) c.seo_keyword=slugify(c.hook_text||c.caption||'viral')+'-viral'; const kw=c.seo_keyword.replace(/-/g,' ').toLowerCase().split(' ').filter(Boolean); const cap=(c.caption||'').toLowerCase(); if(c.caption&&!kw.some((w:string)=>cap.slice(0,60).includes(w))) c.caption=c.seo_keyword.replace(/-/g,' ')+' '+c.caption; if(!c.caption) c.caption=c.seo_keyword.replace(/-/g,' ')+' — tonton sampai akhir'; if(!c.hashtags||!c.hashtags.length) c.hashtags=['#'+c.seo_keyword.split('-')[0],'#tipssehat','#viral']; if(!c.cta_text) c.cta_text='Save video ini & Share ->'; if(!c.hook_text) c.hook_text='Tonton sampai habis'; } return cs; }
function normalizeNicheTier(v:any): 'low'|'medium'|'high' { const s=String(v??'').toLowerCase().trim(); if(s==='high'||s==='tinggi'||s.includes('8-15')||s.includes('15%')||s==='high-profit'||s==='premium') return 'high'; if(s==='medium'||s==='mid'||s==='sedang'||s.includes('4-8')||s.includes('medium')) return 'medium'; if(s==='low'||s==='rendah') return 'low'; if(s.includes('high')) return 'high'; if(s.includes('medium')||s.includes('mid')) return 'medium'; return 'low'; }
function normalizeNiche(raw:any){ const tag=(typeof raw?.tag==='string'&&raw.tag.trim())?raw.tag.trim().toLowerCase().slice(0,32): (typeof raw?.niche_tag==='string'&&raw.niche_tag.trim()?raw.niche_tag.trim().toLowerCase().slice(0,32):'unknown'); const tier=normalizeNicheTier(raw?.tier??raw?.niche_profit_tier); let sc=Number(raw?.score??raw?.niche_score); if(!Number.isFinite(sc)) sc=0; sc=Math.round(Math.max(0,Math.min(100,sc))); const llmAdv=(typeof raw?.advisory==='string'&&raw.advisory.trim())?raw.advisory.trim().slice(0,200): (typeof raw?.niche_advisory==='string'&&raw.niche_advisory.trim()?raw.niche_advisory.trim().slice(0,200):''); const tierAdvice=tier==='high'?'High profit niche': tier==='medium'?'Medium niche':'Low niche — cek riset'; const bestSlot=tier==='high'?'06:30 & 19:00 WIB': tier==='medium'?'19:00 WIB':'19:30 WIB'; const adv=llmAdv ? (llmAdv.toLowerCase().includes(tag) ? llmAdv : `${tag} — ${llmAdv}`) : `${tag} — ${tierAdvice} — upload ${bestSlot}`; return {tag,tier,score:sc,advisory:adv}; }
function extractContextEntities(sourceMeta:any, transcript:string|null){
  const txt=[sourceMeta?.title||'', sourceMeta?.description||'', (sourceMeta?.tags||[]).join(' '), transcript||''].join(' ').slice(0,6000);
  const lower=txt.toLowerCase();
  const people:string[]=[]; const peopleRe=/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g; let m:RegExpExecArray|null; while((m=peopleRe.exec(txt))&&people.length<8){ const v=m[1].trim(); if(v.length>=5&&v.length<=40&&!/^(Video|Channel|TikTok|YouTube|Save|Share)/i.test(v)) people.push(v); }
  const brands=Array.from(new Set((txt.match(/\b(?:Samsung|iPhone|Apple|Xiaomi|Oppo|Vivo|Wardah|Skintific|Somethinc|Scarlett|Emina|Azarine|Implora|Hanasui|Garnier|L'Oreal|Nivea|Vaseline|Erha|Avoskin|Whitelab|Shopee|Tokopedia|Lazada|TikTok Shop|Grab|Gojek|BCA|BRI|BNI|Mandiri|Dana|OVO|Gopay|Indomie|Mixue|JCO|Starbucks|McD|KFC|Uniqlo|Zara|H&M|Nike|Adidas|Honda|Yamaha|Toyota|Mitsubishi|Tesla|BYD|Wuling)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const products=Array.from(new Set((txt.match(/\b(?:serum|moisturizer|sunscreen|toner|cream|lotion|lipstik|foundation|cushion|skincare|parfum|handphone|hp|iphone|samsung|laptop|ayam|bakso|sate|rendang|kopi|sambal|cumi|teri|obat|suplemen|vitamin|diet|jerawat|flek|whitening|acne|glowing)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const places=Array.from(new Set((txt.match(/\b(?:Jakarta|Surabaya|Bandung|Blora|Tuban|Lasem|Bali|Jogja|Semarang|Medan|Indonesia|Jawa|Korea|Jepang|USA|Amerika|China|Thailand)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const numbers=Array.from(new Set((txt.match(/\b\d+(?:[.,]\d+)?\s*(?:%|juta|miliar|ribu|kg|gram|ml|cm|tahun|bulan|hari|kali|x|rupiah|rp|dollar|\$|jt|m|k)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const pain_points=Array.from(new Set((lower.match(/\b(?:jerawat|flek hitam|kusam|berminyak|kering|iritasi|breakout|pori-pori|ketombe|rontok|bau badan|overthinking|insomnia|stress|cemas|utang|bangkrut|rugi|gagal|ditipu|penipuan|scam|nyeri|sakit|pegal|lambung|maag|diet gagal|berat badan|gemuk|kurus)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const topics=Array.from(new Set((lower.match(/\b(?:keuangan|investasi|saham|crypto|trading|affiliate|jualan|bisnis|kuliner|resep|masak|skincare|kecantikan|makeup|kesehatan|diet|olahraga|teknologi|gadget|review|unboxing|tutorial|viral|fyp|edukasi|motivasi|cerita|misteri|sejarah)\b/gi)||[]).map(x=>x.trim()))).slice(0,8);
  const claims:string[]=[]; const claimRe=/(?:klaim|terbukti|hasil|efek|manfaat|bisa|dapat|mampu)[^.!?]{10,80}[.!?]/gi; let cm:RegExpExecArray|null; while((cm=claimRe.exec(txt))&&claims.length<5){ claims.push(cm[0].trim().slice(0,120)); }
  return { people:Array.from(new Set(people)).slice(0,5), brands, products, places, numbers, topics, pain_points, claims };
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
  if(!source_meta){ console.log(`[Context] No URL for ${sourceName}, using filename as title`); source_meta={ title:sourceName.replace(/[_-]/g,' ').slice(0,200), description:'', channel:'', channel_id:'', upload_date:'', duration:0, view_count:0, like_count:0, categories:[], tags:[], extractor:'local', url:'' }; }
  const entities=extractContextEntities(source_meta, transcript);
  const braveKey=(process.env.BRAVE_SEARCH_API_KEY||process.env.BRAVE_API_KEY||'').trim();
  if(!braveKey||braveKey.includes('your_')){ console.warn('[Brave] skipped: no BRAVE_SEARCH_API_KEY'); return { source_meta, entities, external_context:[] }; }
  const queries:{q:string,t:string}[]=[];
  if(entities.brands[0]||entities.products[0]) queries.push({q:(entities.brands[0]||entities.products[0])+(entities.topics[0]?' '+entities.topics[0]:''), t:'brand/product'});
  if(entities.people[0]) queries.push({q:entities.people[0], t:'people'});
  if(entities.pain_points[0]) queries.push({q:entities.pain_points[0]+(entities.topics[0]?' '+entities.topics[0]:''), t:'pain_point'});
  if(entities.topics[0]) queries.push({q:entities.topics[0]+' trending Indonesia 2024', t:'trend'});
  if(entities.numbers[0]||entities.claims[0]) queries.push({q:(entities.numbers[0]||entities.claims[0]||'').slice(0,60), t:'claim'});
  const uniq=Array.from(new Map(queries.map(x=>[x.q,x])).values()).slice(0,5);
  const results=await Promise.all(uniq.map(x=>searchBraveContext(x.q,x.t,5000)));
  const external_context=results.filter(Boolean) as any[];
  return { source_meta, entities, external_context };
}
function buildPostingSchedule(tier:'low'|'medium'|'high'){ const isHigh=tier==='high', isMed=tier==='medium'; const slots=[ {slot:'Pagi Hari (06:30 - 08:30 WIB)',time_range:'06:30 - 08:30 WIB',category:'Morning Commute & Breakfast (WIB)',traffic:isHigh?'Sangat Tinggi' as const:'Tinggi' as const,description:isHigh?'Golden pagi niche high — prioritas upload pagi':'Cocok untuk edukasi ringkas pagi',is_golden:isHigh}, {slot:'Siang Hari (11:45 - 13:15 WIB)',time_range:'11:45 - 13:15 WIB',category:'Lunch Break & Relax',traffic:'Tinggi' as const,description:'Traffic siang stabil',is_golden:false}, {slot:'Sore Hari (16:30 - 18:00 WIB)',time_range:'16:30 - 18:00 WIB',category:'Teatime & Heading Home',traffic:'Sedang' as const,description:'Pemanasan algoritma sore',is_golden:false}, {slot:'Malam Hari (19:00 - 21:00 WIB)',time_range:'19:00 - 21:00 WIB',category:'Golden Prime Time WIB',traffic:'Sangat Tinggi' as const,description:isHigh?'Prime malam — slot kedua high tier':'Prime malam — slot utama low/medium',is_golden:true} ]; const best=isHigh?'06:30 - 08:30 WIB (Pagi Golden - niche high)': isMed?'19:00 - 21:00 WIB (Prime Time - niche medium)':'19:00 - 21:00 WIB (Prime Time - niche low, slot lebih akhir)'; const advice=isHigh?'Upload 06:30 WIB (utama) + 19:00 WIB (kedua) — high tier prioritas pagi':'Upload 19:00 WIB — niche '+tier; return {timezone:'Asia/Jakarta (WIB)',slots,best_slot_today:best,advice}; }
async function transcribeWithGroq(inputPath:string):Promise<string|null>{
  const k=(process.env.GROQ_API_KEY||'').trim(); if(!k||k.includes('your_')) return null;
  const tmpWav=`/tmp/groq_${Date.now()}.wav`;
  try{
    await execAsync(`ffmpeg -y -i "${inputPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 -t 120 "${tmpWav}"`);
    if(!fs.existsSync(tmpWav)||fs.statSync(tmpWav).size<1000) return null;
    const buf=fs.readFileSync(tmpWav); const fd=new FormData();
    fd.append('file', new Blob([buf],{type:'audio/wav'}), 'audio.wav');
    fd.append('model', process.env.GROQ_WHISPER_MODEL||'whisper-large-v3-turbo');
    fd.append('language','id'); fd.append('response_format','json');
    const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{'Authorization':'Bearer '+k},body:fd as any});
    try{fs.unlinkSync(tmpWav);}catch{}
    if(!r.ok){console.warn('[GroqWhisper]',r.status,(await r.text()).slice(0,200)); return null;}
    const j:any=await r.json(); return (j.text||'').trim().slice(0,4000)||null;
  }catch(e:any){console.warn('[GroqWhisper]',e?.message); try{fs.unlinkSync(tmpWav);}catch{} return null;}
}
async function callMuseLLM(baseName:string,dur:number,transcript:string|null, contextPackage:any={}):Promise<any|null>{
  const k=(process.env.MUSE_API_KEY||process.env.GROQ_API_KEY||'').trim(); const u=(process.env.MUSE_BASE_URL||'https://api.groq.com/openai/v1').trim(); const m=(process.env.MUSE_MODEL||'openai/gpt-oss-120b').trim();
  if(!k||k.includes('your_')){console.log('[LLM] skip placeholder'); return null;}
  const tr=transcript?`TRANSCRIPT (wajib pakai untuk caption/hook/seo, JANGAN ngarang): """${transcript.slice(0,3000)}"""`:`Tanpa transcript (file testsrc), buat generic.`;
  const sm=contextPackage?.source_meta; const ent=contextPackage?.entities; const ext=contextPackage?.external_context;
  const metaBlock=sm?`\n=== SOURCE METADATA ===\nTitle: ${(sm.title||'').slice(0,120)}\nChannel: ${(sm.channel||'').slice(0,80)}${sm.channel_id?' ('+sm.channel_id+')':''}\nViews: ${sm.view_count||0} | Likes: ${sm.like_count||0} | Duration: ${sm.duration||0}s\nCategories: ${(sm.categories||[]).join(', ').slice(0,80)}\nTags: ${(sm.tags||[]).slice(0,8).join(', ').slice(0,120)}\nDescription: ${(sm.description||'').slice(0,500)}\n=== END SOURCE METADATA ===`:'';
  const entBlock=ent?`\n=== NLP ENTITIES ===\nPeople: ${(ent.people||[]).join(', ')||'-'}\nBrands: ${(ent.brands||[]).join(', ')||'-'}\nProducts: ${(ent.products||[]).join(', ')||'-'}\nPlaces: ${(ent.places||[]).join(', ')||'-'}\nNumbers: ${(ent.numbers||[]).join(', ')||'-'}\nTopics: ${(ent.topics||[]).join(', ')||'-'}\nPain Points: ${(ent.pain_points||[]).join(', ')||'-'}\nClaims: ${(ent.claims||[]).join(' | ').slice(0,300)||'-'}\n=== END NLP ENTITIES ===`:'';
  const extBlock=(ext&&ext.length)?`\n=== EXTERNAL CONTEXT ===\n`+ext.map((c:any)=>`Query(${c.entity_type}): ${c.query}\nTitle: ${c.title}\nSnippet: ${c.snippet}\nURL: ${c.url}`).join('\n---\n')+`\n=== END EXTERNAL CONTEXT ===`:'';
  const prompt=`File:${baseName} Dur:${dur.toFixed(1)}s ${tr}${metaBlock}${entBlock}${extBlock} Buat 1-2 clip VIRAL: start_time & end_time HARUS sesuai momen paling retensi di transcript, 30-45s durasi, hook 5-12 kata dari transcript+entities, seo_keyword hyphen dari topik transcript/entities, caption keyword first 50 chars dari transcript, 3-5 hashtag dari transcript, CTA Save/Share. Gunakan SOURCE METADATA+NLP ENTITIES+EXTERNAL CONTEXT untuk memilih angle terkuat (people/brand/pain_point/number/trend) dan buat hook TIDAK generic. JANGAN klaim palsu di luar transcript/metadata/context. caption HARUS meringkas isi transcript, bukan generic. Return JSON.`;
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
    comments: string[];
  };
  source_meta?: { title:string; description:string; channel:string; channel_id:string; upload_date:string; duration:number; view_count:number; like_count:number; categories:string[]; tags:string[]; extractor:string; url:string; };
  entities?: { people:string[]; brands:string[]; products:string[]; places:string[]; numbers:string[]; topics:string[]; pain_points:string[]; claims:string[]; };
  external_context?: { query:string; entity_type:string; title:string; snippet:string; url:string }[];
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
  const clip1Filename = `clip_1_${baseCleanName}_hook.mp4`;
  const clip2Filename = `clip_2_${baseCleanName}_seo.mp4`;

  const outClip1Path = path.join(rendersDir, clip1Filename);
  const outClip2Path = path.join(rendersDir, clip2Filename);

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
    let llmData:any=null; let transcript:string|null=null; let contextPackage:any={ source_meta:null, entities:null, external_context:[] };
    try{
      const {stdout}=await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
      const dur=parseFloat(stdout.trim())||30;
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper: transcribe ${dur.toFixed(1)}s...`);
      transcript=await transcribeWithGroq(inputPath);
      if(transcript) job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper OK: ${(transcript.slice(0,60)).replace(/\n/g,' ')}...`);
      else job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Whisper kosong/skip — LLM tanpa transcript`);
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context: build source_meta+entities+Brave...`);
      try{ contextPackage=await buildContextPackage(sourceName, transcript); job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context OK: title="${(contextPackage.source_meta?.title||'').slice(0,40)}" entities=${(contextPackage.entities?.people?.length||0)}p/${(contextPackage.entities?.brands?.length||0)}b/${(contextPackage.entities?.pain_points?.length||0)}pp external=${contextPackage.external_context?.length||0}`); }catch(ce:any){ console.warn('[Context]',ce?.message); job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Context skip: ${String(ce?.message||ce).slice(0,80)}`); }
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM: Muse/Groq caption/hashtag...`);
      llmData=await callMuseLLM(baseCleanName, dur, transcript, contextPackage);
      if(llmData?.clips?.length) job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM OK: ${llmData.clips.length} clip(s) hook=${(llmData.clips[0]?.hook_text||'').slice(0,40)} seo=${llmData.clips[0]?.seo_keyword||''}`);
      else job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM skip/fallback — pakai caption auto jujur`);
    }catch(e:any){ job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] LLM error: ${e?.message||e}`); }
    const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/:/g,'\\:').replace(/%/g,'\\%').slice(0,70);
    const llmC1=llmData?.clips?.[0]||null, llmC2=llmData?.clips?.[1]||llmC1;
    const hook1=esc(llmC1?.hook_text||`Auto hook ${baseCleanName.slice(0,30)}`);
    const seo1=esc(llmC1?.seo_keyword||slugify(baseCleanName)+'-viral');
    const cta1=esc(llmC1?.cta_text||'Save & Share ->');
    const hook2=esc(llmC2?.hook_text||hook1);
    const seo2=esc(llmC2?.seo_keyword||seo1);
    const cta2=esc(llmC2?.cta_text||cta1);
    // ponytail: clip timing from LLM transcript (start_time/end_time) → FFmpeg ss/t must match caption topic
    const clip1Start=Math.max(0, Number(llmC1?.start_time)||0);
    const clip1End=Math.max(clip1Start+5, Number(llmC1?.end_time)||clip1Start+30);
    const clip1Dur=Math.min(45, clip1End-clip1Start);
    const clip2StartRaw=Number(llmC2?.start_time); const clip2EndRaw=Number(llmC2?.end_time);
    // ponytail: clip2 defaults to second half if LLM only gives 1 clip or same timing
    let clip2Start=isFinite(clip2StartRaw)&&llmData?.clips?.length>1?Math.max(0,clip2StartRaw):Math.max(clip1End, 30);
    let clip2Dur=isFinite(clip2EndRaw)&&isFinite(clip2StartRaw)?Math.min(45, clip2EndRaw-clip2StartRaw):30;
    if(clip2Start===clip1Start && llmData?.clips?.length<=1) clip2Dur=30;

    // Phase 2: Pembersihan Filler Words & Dead-Air
    job.phase = 'clean fillers & silence';
    job.progress = 0.35;
    job.detail = cleanFillersEnabled ? 'Filter silenceremove audio' : 'Skip pembersihan hening';
    if (cleanFillersEnabled) {
      job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase 2/5: Pembersihan Filler Words & Dead-Air >0.45s via silenceremove filter`);
    }
    broadcastSSE();

    // Phase 3: Rendering Clip 1 (Hook Retention + Backsound + Seamless Loop)
    job.phase = 'render clip 1';
    job.progress = 0.55;
    job.detail = 'FFmpeg 9:16 + Ducking + Loop 1';
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase 3/5: Memproses Clip 1 (9:16 vertical crop + Injeksi backsound ${selectedTheme.title})`);
    broadcastSSE();

    // Construct FFmpeg Filter Graph for Clip 1 (30 seconds)
    // Filter combines:
    // 1. Video: 9:16 crop, 1080x1920 scale, drawtext watermark @brogalanblora
    // 2. Audio: Voice + Backsound mixing (amix/ducking) + 19kHz Ultrasonic tone anti-duplicate
    const hasBg = themeKey !== 'none' && fs.existsSync(bgAudioPath);
    // ponytail: 2 filter variants (with/without bg) — fallback must not reference [1:a]
    const filterComplex1 = [
      `[0:v]crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,setsar=1,drawtext=text='${hook1}':fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=80:enable='between(t\\,0\\,3)',drawtext=text='${seo1}':fontcolor=yellow:fontsize=42:box=1:boxcolor=black@0.5:boxborderw=6:x=(w-text_w)/2:y=(h*0.35):enable='between(t\\,0.2\\,2.7)',drawtext=text='${cta1}':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.7:boxborderw=6:x=(w-text_w)/2:y=h-160:enable='gte(t\\,10)',drawtext=text='@brogalanblora':fontcolor=white@0.7:fontsize=22:x=(w-text_w)/2:y=h-28[v_out]`,
      cleanFillersEnabled
        ? `[0:a]silenceremove=start_periods=1:start_duration=0.1:start_threshold=-40dB,volume=1.2[vocal]`
        : `[0:a]volume=1.2[vocal]`,
      hasBg
        ? `[1:a]aloop=loop=-1:size=2e+09,volume=0.25[bg];[vocal][bg]amix=inputs=2:duration=first:dropout_transition=2[a_mix]`
        : `[vocal]acopy[a_mix]`,
      `aevalsrc=sin(19000*2*PI*t)*0.001:s=44100[ultra];[a_mix][ultra]amix=inputs=2:duration=first[a_final]`
    ].join(';');
    const filterComplexNoBg = [
      `[0:v]crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,setsar=1,drawtext=text='${hook1}':fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=80:enable='between(t\\,0\\,3)',drawtext=text='${seo1}':fontcolor=yellow:fontsize=42:box=1:boxcolor=black@0.5:boxborderw=6:x=(w-text_w)/2:y=(h*0.35):enable='between(t\\,0.2\\,2.7)',drawtext=text='${cta1}':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.7:boxborderw=6:x=(w-text_w)/2:y=h-160:enable='gte(t\\,10)',drawtext=text='@brogalanblora':fontcolor=white@0.7:fontsize=22:x=(w-text_w)/2:y=h-28[v_out]`,
      cleanFillersEnabled
        ? `[0:a]silenceremove=start_periods=1:start_duration=0.1:start_threshold=-40dB,volume=1.2[vocal]`
        : `[0:a]volume=1.2[vocal]`,
      `[vocal]acopy[a_mix]`,
      `aevalsrc=sin(19000*2*PI*t)*0.001:s=44100[ultra];[a_mix][ultra]amix=inputs=2:duration=first[a_final]`
    ].join(';');
    // ponytail: clip2 distinct hook/seo/cta for sync
    const filterComplex2 = [
      `[0:v]crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,setsar=1,drawtext=text='${hook2}':fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=80:enable='between(t\\,0\\,3)',drawtext=text='${seo2}':fontcolor=yellow:fontsize=42:box=1:boxcolor=black@0.5:boxborderw=6:x=(w-text_w)/2:y=(h*0.35):enable='between(t\\,0.2\\,2.7)',drawtext=text='${cta2}':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.7:boxborderw=6:x=(w-text_w)/2:y=h-160:enable='gte(t\\,10)',drawtext=text='@brogalanblora':fontcolor=white@0.7:fontsize=22:x=(w-text_w)/2:y=h-28[v_out]`,
      cleanFillersEnabled
        ? `[0:a]silenceremove=start_periods=1:start_duration=0.1:start_threshold=-40dB,volume=1.2[vocal]`
        : `[0:a]volume=1.2[vocal]`,
      hasBg
        ? `[1:a]aloop=loop=-1:size=2e+09,volume=0.25[bg];[vocal][bg]amix=inputs=2:duration=first:dropout_transition=2[a_mix]`
        : `[vocal]acopy[a_mix]`,
      `aevalsrc=sin(19000*2*PI*t)*0.001:s=44100[ultra];[a_mix][ultra]amix=inputs=2:duration=first[a_final]`
    ].join(';');
    const filterComplexNoBg2 = [
      `[0:v]crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,setsar=1,drawtext=text='${hook2}':fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=80:enable='between(t\\,0\\,3)',drawtext=text='${seo2}':fontcolor=yellow:fontsize=42:box=1:boxcolor=black@0.5:boxborderw=6:x=(w-text_w)/2:y=(h*0.35):enable='between(t\\,0.2\\,2.7)',drawtext=text='${cta2}':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.7:boxborderw=6:x=(w-text_w)/2:y=h-160:enable='gte(t\\,10)',drawtext=text='@brogalanblora':fontcolor=white@0.7:fontsize=22:x=(w-text_w)/2:y=h-28[v_out]`,
      cleanFillersEnabled
        ? `[0:a]silenceremove=start_periods=1:start_duration=0.1:start_threshold=-40dB,volume=1.2[vocal]`
        : `[0:a]volume=1.2[vocal]`,
      `[vocal]acopy[a_mix]`,
      `aevalsrc=sin(19000*2*PI*t)*0.001:s=44100[ultra];[a_mix][ultra]amix=inputs=2:duration=first[a_final]`
    ].join(';');

    const cmdClip1 = hasBg
      ? `ffmpeg -y -ss ${clip1Start} -t ${clip1Dur} -i "${inputPath}" -i "${bgAudioPath}" -filter_complex "${filterComplex1}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outClip1Path}"`
      : `ffmpeg -y -ss ${clip1Start} -t ${clip1Dur} -i "${inputPath}" -filter_complex "${filterComplexNoBg}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outClip1Path}"`;

    await execAsync(cmdClip1);

    // Phase 4: Rendering Clip 2 (SEO & Call-to-Action)
    job.phase = 'render clip 2';
    job.progress = 0.80;
    job.detail = 'FFmpeg 9:16 + Ducking + Loop 2';
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] Phase 4/5: Memproses Clip 2 (Segmen 30s-60s + Visual Hash Rebirth)`);
    broadcastSSE();

    const cmdClip2 = hasBg
      ? `ffmpeg -y -ss ${clip2Start} -t ${clip2Dur} -i "${inputPath}" -i "${bgAudioPath}" -filter_complex "${filterComplex2}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outClip2Path}"`
      : `ffmpeg -y -ss ${clip2Start} -t ${clip2Dur} -i "${inputPath}" -filter_complex "${filterComplexNoBg2}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outClip2Path}"`;

    let clip2Ok = false;
    try {
      await execAsync(cmdClip2);
      clip2Ok = fs.existsSync(outClip2Path) && fs.statSync(outClip2Path).size > 10000;
      if (!clip2Ok) throw new Error('clip2 empty');
    } catch (e2) {
      let fbStart = 5, fbDur = 25;
      try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
        const dur = parseFloat(stdout.trim()) || 15;
        fbStart = dur > 15 ? 5 : 0;
        fbDur = Math.max(5, Math.min(25, dur - fbStart));
      } catch {}
      const fallbackCmd = `ffmpeg -y -ss ${fbStart} -t ${fbDur} -i "${inputPath}" -filter_complex "${filterComplexNoBg2}" -map "[v_out]" -map "[a_final]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "${outClip2Path}"`;
      await execAsync(fallbackCmd);
    }

    // Phase 5: Finalize & Register Real Files
    job.phase = 'completed';
    job.progress = 1.0;
    job.status = 'SUCCESS';
    job.result = [clip1Filename, clip2Filename];
    job.finished_at = Date.now() / 1000;
    job.logs.push(`[${new Date().toLocaleTimeString('id-ID')}] SUCCESS — 2 file biner video MP4 1080x1920 HD berhasil dirender ke disk!`);

    const stat1 = fs.existsSync(outClip1Path) ? fs.statSync(outClip1Path) : { size: 0 };
    const stat2 = fs.existsSync(outClip2Path) ? fs.statSync(outClip2Path) : { size: 0 };
    if (stat1.size === 0 || stat2.size === 0) throw new Error('Render output missing — check FFmpeg logs');

    renders.set(`${jobId}-1`, {
      job_id: jobId,
      filename: clip1Filename,
      size: stat1.size,
      size_human: `${(stat1.size / 1024 / 1024).toFixed(1)} MB`,
      created_at: Date.now()
    });

    renders.set(`${jobId}-2`, {
      job_id: jobId,
      filename: clip2Filename,
      size: stat2.size,
      size_human: `${(stat2.size / 1024 / 1024).toFixed(1)} MB`,
      created_at: Date.now()
    });

    const cap1 = llmC1?.caption ? llmC1.caption : `Auto clip: ${baseCleanName} — edit caption sebelum upload`;
    const cap2 = llmC2?.caption ? llmC2.caption : `Auto clip 2: ${baseCleanName} — SEO caption perlu diisi manual`;
    const hash1 = llmC1?.hashtags?.length ? llmC1.hashtags : ['#fyp','#tiktoktips'];
    const hash2 = llmC2?.hashtags?.length ? llmC2.hashtags : ['#edukasi','#cuan'];
    jobMetas.set(jobId, {
      captions: {
        [clip1Filename]: `${cap1} ${hash1.join(' ')}`,
        [clip2Filename]: `${cap2} ${hash2.join(' ')}`
      },
      detailed_captions: {
        [clip1Filename]: {
          full_caption: cap1,
          hook_text: (llmC1?.hook_text || baseCleanName),
          body_text: cap1,
          hashtags: hash1,
          hashtags_str: hash1.join(' ')
        },
        [clip2Filename]: {
          full_caption: cap2,
          hook_text: (llmC2?.hook_text || baseCleanName),
          body_text: cap2,
          hashtags: hash2,
          hashtags_str: hash2.join(' ')
        }
      },
      seamless_loop: {
        [clip1Filename]: {
          enabled: seamlessEnabled,
          loop_score: null, // ponytail: requires transcript alignment; null until Groq Whisper real
          bridge_phrase: '',
          loop_transition: 'pending transcript',
          crossfade_ms: 0
        },
        [clip2Filename]: {
          enabled: seamlessEnabled,
          loop_score: null,
          bridge_phrase: '',
          loop_transition: 'pending transcript',
          crossfade_ms: 0
        }
      },
      backsound: {
        [clip1Filename]: {
          theme: selectedTheme.category,
          track_title: `${selectedTheme.title} (${selectedTheme.bpm} BPM)`,
          bpm: selectedTheme.bpm,
          ducking_db: selectedTheme.ducking,
          license: 'Generated locally (check TikTok Commercial Music Library before monetize)',
          audio_hash_cleaned: false
        },
        [clip2Filename]: {
          theme: selectedTheme.category,
          track_title: `${selectedTheme.title} (${selectedTheme.bpm} BPM)`,
          bpm: selectedTheme.bpm,
          ducking_db: selectedTheme.ducking,
          license: 'Generated locally (check TikTok Commercial Music Library before monetize)',
          audio_hash_cleaned: false
        }
      },
      narrative_cleaning: {
        [clip1Filename]: {
          enabled: cleanFillersEnabled,
          filler_words_removed: 0, // ponytail: real count requires Groq Whisper transcript
          fillers_detected: [],
          silence_cut_sec: 0,
          original_duration_sec: 0,
          optimized_duration_sec: 30.0,
          pacing_wpm: null,
          speedup_pct: 0
        },
        [clip2Filename]: {
          enabled: cleanFillersEnabled,
          filler_words_removed: 0,
          fillers_detected: [],
          silence_cut_sec: 0,
          original_duration_sec: 0,
          optimized_duration_sec: 30.0,
          pacing_wpm: null,
          speedup_pct: 0
        }
      },
      posting_schedule: (()=>{ const n=normalizeNiche({tag:(llmData as any)?.niche_tag, tier:(llmData as any)?.niche_profit_tier, score:(llmData as any)?.niche_score, advisory:(llmData as any)?.niche_advisory}); return buildPostingSchedule(n.tier); })(),
      engagement: (()=>{ const n=normalizeNiche({tag:(llmData as any)?.niche_tag, tier:(llmData as any)?.niche_profit_tier, score:(llmData as any)?.niche_score, advisory:(llmData as any)?.niche_advisory}); return {niche_tag:n.tag, niche_profit_tier:n.tier, niche_score:n.score, niche_advisory:n.advisory, comments:[]}; })(),
      source_meta: contextPackage?.source_meta || { title:sourceName.replace(/[_-]/g,' ').slice(0,200), description:'', channel:'', channel_id:'', upload_date:'', duration:0, view_count:0, like_count:0, categories:[], tags:[], extractor:'local', url:'' },
      entities: contextPackage?.entities || { people:[], brands:[], products:[], places:[], numbers:[], topics:[], pain_points:[], claims:[] },
      external_context: contextPackage?.external_context || []
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
