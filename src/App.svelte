<script>
  import { onMount, onDestroy } from 'svelte';
  import { sseStatus, clipJobs, ytdlpJobs, renders, diagnostics, health, connectSSE, disconnectSSE, fetchHealth, fetchDiagnostics } from './lib/store.js';
  let tab='dl';
  let url='', fmt='mp4', qual='best', noPlaylist=true, info=null, infoLoading=false, dlBusy=false;
  let sse='connecting';
  let clipBusy=false;
  let sources=[], sourcesLoading=false, srcFilter='';
  let uploadFile=null, uploadBusy=false;
  let storageStats=null, storageLoading=false;
  let selectedRenders=new Set(), selectedDownloads=new Set();
  let bulkBusy=false;
  let metaCache={};
  let fromUrlBusy=false;
  let showScheduleModal=false;
  let showAdvAutomation=true;
  let optSeamlessLoop=true;
  let optBacksoundTheme='auto';
  let optCleanFillers=true;
  let optCleanSensitivity='seimbang';
  let openVideoPreview={};
  let toastMsg='';
  let toastTimer=null;
  const unsub=[];

  function getClipOptions(){
    return {
      seamless_loop: optSeamlessLoop,
      backsound_theme: optBacksoundTheme,
      clean_fillers: optCleanFillers,
      clean_sensitivity: optCleanSensitivity
    };
  }

  function showToast(msg){
    toastMsg = msg;
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ toastMsg = ''; }, 2500);
  }

  async function copyText(text, label='Teks'){
    if(!text) return;
    try {
      if(navigator && navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(`✓ ${label} tersalin!`);
    } catch(e) {
      showToast(`Gagal menyalin: ${e.message}`);
    }
  }

  function getHashtagsString(capObj, rawCap){
    if(capObj?.hashtags_str) return capObj.hashtags_str;
    if(capObj?.hashtags?.length) return capObj.hashtags.join(' ');
    if(typeof rawCap === 'string'){
      const matches = rawCap.match(/#\w+/g);
      if(matches && matches.length) return matches.join(' ');
    }
    return '#fyp #affiliatetiktok #tiktoktips #videoviral #digitaldna';
  }

  function getHashtagList(capObj, rawCap){
    if(capObj?.hashtags?.length) return capObj.hashtags;
    if(typeof rawCap === 'string'){
      const matches = rawCap.match(/#\w+/g);
      if(matches && matches.length) return matches;
    }
    return ['#fyp', '#affiliatetiktok', '#tiktoktips', '#videoviral', '#digitaldna'];
  }

  function getFullCaption(meta, fname){
    if(meta?.detailed_captions?.[fname]?.full_caption) return meta.detailed_captions[fname].full_caption;
    if(meta?.captions?.[fname]) return meta.captions[fname];
    const firstVal = Object.values(meta?.captions || {})[0];
    if(typeof firstVal === 'string') return firstVal;
    return 'Konten siap FYP TikTok! Terapkan trik hook 3 detik ini 🔥 #fyp #affiliatetiktok #videoviral';
  }

  function getHookText(meta, fname){
    if(meta?.detailed_captions?.[fname]?.hook_text) return meta.detailed_captions[fname].hook_text;
    const full = getFullCaption(meta, fname);
    const parts = full.split(/[!?.#]/);
    return (parts[0] || 'Trik rahasia FYP yang wajib dicoba!').trim();
  }

  function getWibInfo(){
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wib = new Date(utc + (3600000 * 7));
    const hours = wib.getHours();
    const minutes = wib.getMinutes();
    const timeNum = hours + (minutes / 60);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayName = days[wib.getDay()];
    
    let currentSlot = null;
    let nextSlot = 'Pagi (06:30 - 08:30 WIB)';
    let isGoldenNow = false;

    if (timeNum >= 6.5 && timeNum <= 8.5) {
      currentSlot = 'Pagi (06:30 - 08:30 WIB)';
      nextSlot = 'Siang (11:45 - 13:15 WIB)';
    } else if (timeNum >= 11.75 && timeNum <= 13.25) {
      currentSlot = 'Siang (11:45 - 13:15 WIB)';
      nextSlot = 'Sore (16:30 - 18:00 WIB)';
    } else if (timeNum >= 16.5 && timeNum <= 18.0) {
      currentSlot = 'Sore (16:30 - 18:00 WIB)';
      nextSlot = 'Malam (19:00 - 21:45 WIB)';
    } else if (timeNum >= 19.0 && timeNum <= 21.75) {
      currentSlot = 'Malam (19:00 - 21:45 WIB)';
      nextSlot = 'Pagi Besok (06:30 - 08:30 WIB)';
      isGoldenNow = true;
    } else {
      if (timeNum < 6.5) nextSlot = 'Pagi (06:30 - 08:30 WIB)';
      else if (timeNum < 11.75) nextSlot = 'Siang (11:45 - 13:15 WIB)';
      else if (timeNum < 16.5) nextSlot = 'Sore (16:30 - 18:00 WIB)';
      else if (timeNum < 19.0) nextSlot = 'Malam (19:00 - 21:45 WIB)';
      else nextSlot = 'Pagi Besok (06:30 - 08:30 WIB)';
    }

    const timeStr = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')} WIB`;
    return { dayName, timeStr, currentSlot, nextSlot, isGoldenNow };
  }

  $: wibNow = getWibInfo();

  onMount(()=>{
    unsub.push(sseStatus.subscribe(v=>sse=v));
    connectSSE('');
    fetchHealth(''); fetchDiagnostics('');
    loadSources(); loadStorageStats();
    const t=setInterval(()=>{ if(!document.hidden) { fetchHealth(''); } }, 30000);
    const t2=setInterval(()=>{ if(!document.hidden && tab==='manage') loadStorageStats(); if(!document.hidden && tab==='clip') loadSources(); }, 15000);
    const t3=setInterval(()=>{ wibNow = getWibInfo(); }, 60000);
    try{ const s=localStorage.getItem('activeTab'); if(s && ['dl','clip','manage'].includes(s)) tab=s; }catch{}
    return ()=>{ clearInterval(t); clearInterval(t2); clearInterval(t3); };
  });
  onDestroy(()=>{ disconnectSSE(); unsub.forEach(fn=>fn()); });
  function switchTab(which){ tab=which; try{localStorage.setItem('activeTab', which);}catch{} if(which==='clip') loadSources(); if(which==='manage') loadStorageStats(); }
  async function doInfo(){
    if(!url) return;
    infoLoading=true;
    try{
      const r=await fetch('/api/ytdlp/info', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||j.error||'gagal');
      info=j.info||j.data||j;
    } catch(e){ alert(e.message); }
    finally{ infoLoading=false; }
  }
  async function doDownload(){
    if(!url) return;
    dlBusy=true;
    try{
      const r=await fetch('/api/ytdlp/download', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url, format: fmt, quality: qual, no_playlist: noPlaylist})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||j.error||'gagal');
      url='';
      setTimeout(loadSources, 1200);
    } catch(e){ alert(e.message); }
    finally{ dlBusy=false; }
  }
  async function doFromUrl(){
    if(!url) return;
    fromUrlBusy=true;
    try{
      const r=await fetch('/clip/from-url', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url, quality: qual, format: fmt, no_playlist: noPlaylist, options: getClipOptions()})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||j.error||'gagal');
      switchTab('clip');
    } catch(e){ alert(e.message); }
    finally{ fromUrlBusy=false; }
  }
  async function loadSources(){
    sourcesLoading=true;
    try{
      const r=await fetch('/clip/sources');
      const j=await r.json();
      if(r.ok) sources=j.files||j.video_files||j.all_files||[];
    }catch(e){} finally{ sourcesLoading=false; }
  }
  async function loadStorageStats(){
    storageLoading=true;
    try{
      const r=await fetch('/clip/storage-stats');
      const j=await r.json();
      if(r.ok) storageStats=j.stats||j;
      fetchDiagnostics('');
    }catch(e){} finally{ storageLoading=false; }
  }
  async function clipFromFile(name){
    try{
      const r=await fetch('/clip/from-download', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({filename: name, options: getClipOptions()})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||j.error||'gagal');
      switchTab('clip');
    } catch(e){ alert(e.message); }
  }
  async function doUpload(){
    if(!uploadFile) return alert('Pilih file dulu');
    uploadBusy=true;
    try{
      const fd=new FormData();
      fd.append('file', uploadFile);
      fd.append('options', JSON.stringify(getClipOptions()));
      const r=await fetch('/clip', {method:'POST', body: fd});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||j.error||'gagal');
      uploadFile=null;
      const el=document.getElementById('upload-input'); if(el) el.value='';
      switchTab('clip');
    }catch(e){ alert(e.message); } finally{ uploadBusy=false; }
  }
  async function delRender(job_id, filename){
    if(!confirm(`Hapus ${filename}?`)) return;
    try{
      const r=await fetch(`/renders/${job_id}/${encodeURIComponent(filename)}`, {method:'DELETE'});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||'gagal');
    }catch(e){ alert(e.message); }
  }
  async function delJobFolder(job_id){
    if(!confirm(`Hapus semua render job ${job_id.slice(0,8)}?`)) return;
    try{
      const r=await fetch(`/clip/renders/${job_id}`, {method:'DELETE'});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||'gagal');
    }catch(e){ alert(e.message); }
  }
  async function bulkDeleteRenders(){
    const ids=[...selectedRenders];
    if(ids.length===0) return alert('Pilih renders dulu');
    if(!confirm(`Hapus ${ids.length} job renders?`)) return;
    bulkBusy=true;
    try{
      const r=await fetch('/clip/bulk-delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({job_ids: ids, target:'renders'})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||'gagal');
      selectedRenders=new Set();
      loadStorageStats();
    }catch(e){ alert(e.message); } finally{ bulkBusy=false; }
  }
  async function bulkDeleteDownloads(){
    const names=[...selectedDownloads];
    if(names.length===0) return alert('Pilih downloads dulu');
    if(!confirm(`Hapus ${names.length} file downloads?`)) return;
    bulkBusy=true;
    try{
      const r=await fetch('/clip/bulk-delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({filenames: names, target:'downloads'})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||'gagal');
      selectedDownloads=new Set();
      loadSources(); loadStorageStats();
    }catch(e){ alert(e.message); } finally{ bulkBusy=false; }
  }
  let fetchingMeta=new Set();
  async function fetchMetaSilent(job_id){
    if(metaCache[job_id] || fetchingMeta.has(job_id)) return;
    fetchingMeta.add(job_id);
    try{
      const r=await fetch(`/clip/job-meta/${job_id}`);
      const j=await r.json();
      if(r.ok){ metaCache[job_id]=j; metaCache={...metaCache}; }
    }catch(e){} finally{ fetchingMeta.delete(job_id); }
  }
  function prefetchClipMeta(list){ for(const j of (list||[])){ if(j.status==='SUCCESS' || j.status==='FAILURE' || j.progress>=0.9) fetchMetaSilent(j.job_id); } }
  function prefetchRenderMeta(list){ for(const r of (list||[])) fetchMetaSilent(r.job_id); }
  $: prefetchClipMeta(clipList)
  $: prefetchRenderMeta(rendList)
  async function viewMeta(job_id){
    if(metaCache[job_id]) { metaCache[job_id]=null; return; }
    try{
      const r=await fetch(`/clip/job-meta/${job_id}`);
      const j=await r.json();
      if(!r.ok) throw new Error(j.detail||'gagal');
      metaCache[job_id]=j;
      metaCache={...metaCache};
    }catch(e){ alert(e.message); }
  }
  function toggleRender(id){ if(selectedRenders.has(id)){ selectedRenders.delete(id);} else selectedRenders.add(id); selectedRenders=new Set(selectedRenders); }
  function toggleDownload(name){ if(selectedDownloads.has(name)){ selectedDownloads.delete(name);} else selectedDownloads.add(name); selectedDownloads=new Set(selectedDownloads); }
  function pct(j){ return Math.min(100, Math.round((j.progress||0)*100)); }
  function clipPhaseLabel(j){
    if(j.status==='SUCCESS') return 'selesai';
    if(j.status==='FAILURE') return 'gagal';
    const ph=(j.phase||'').toLowerCase();
    const d=(j.detail||'').toString();
    if(ph.includes('transcribe')||d.includes('/')) return `transcribe ${d||''}`.trim();
    if(ph) return ph;
    if(j.progress>0 && j.progress<1) return `proses ${pct(j)}%`;
    return 'menunggu worker';
  }
  $: clipList=$clipJobs
  $: ytdList=$ytdlpJobs
  $: rendList=$renders
  $: diag=$diagnostics
  $: hlth=$health
  $: filteredSources = srcFilter ? sources.filter(s=> (s.name||'').toLowerCase().includes(srcFilter.toLowerCase())) : sources
  $: diskPct = diag?.disk?.storage?.used_pct ?? diag?.disk?.root?.used_pct ?? null
  $: diskFree = diag?.disk?.storage?.free_gb ?? null
</script>

<style>
  :global(body){font-family: ui-sans-system, -apple-system, sans-serif}
</style>

<!-- Floating Toast Notification -->
{#if toastMsg}
  <div class="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm shadow-xl flex items-center gap-2 animate-bounce">
    <span>{toastMsg}</span>
  </div>
{/if}

<header class="sticky top-0 z-30 bg-zinc-900/90 backdrop-blur border-b border-zinc-800">
  <div class="max-w-[1320px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
    <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 grid place-items-center font-black shrink-0 shadow-lg shadow-violet-600/20">t2</div>
    <div class="min-w-0">
      <div class="font-extrabold leading-none flex items-center gap-2">
        <span>tiktok-v2</span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-violet-950 border border-violet-800 text-violet-300">AI Clipper</span>
      </div>
      <div class="text-[11px] text-zinc-500 truncate">Digital DNA Rebirth Engine • Groq Whisper 300s • Rekomendasi Waktu FYP</div>
    </div>
    <div class="ml-auto flex items-center gap-2 text-xs shrink-0">
      <button on:click={()=> showScheduleModal = !showScheduleModal} class="px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-600/30 to-amber-700/30 border border-amber-600/50 text-amber-200 text-xs font-bold hover:bg-amber-600/40 flex items-center gap-1.5">
        <span>🕒</span>
        <span class="hidden md:inline">Waktu Posting:</span>
        <span>{wibNow.timeStr}</span>
        {#if wibNow.isGoldenNow}<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>{/if}
      </button>
      <span class="px-2.5 py-1 rounded-full border text-[11px] font-bold {sse==='open' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : sse==='connecting' ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-red-950 border-red-900 text-red-200'}">{sse==='open' ? '● live' : sse==='connecting' ? '… hubung' : '✕ putus'}</span>
    </div>
  </div>

  <!-- Prime Time Bar Notice -->
  <div class="max-w-[1320px] mx-auto px-4 sm:px-6 pb-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px] bg-zinc-950/60 border-t border-zinc-800/80 pt-2">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="font-bold text-zinc-300">🇮🇩 Prime Time Hari Ini ({wibNow.dayName}):</span>
      {#if wibNow.currentSlot}
        <span class="px-2.5 py-0.5 rounded-full font-bold bg-emerald-950 border border-emerald-700 text-emerald-200 animate-pulse">🔥 Aktif: {wibNow.currentSlot}</span>
      {:else}
        <span class="px-2.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">⏳ Slot Berikutnya: {wibNow.nextSlot}</span>
      {/if}
      <span class="text-zinc-500 hidden lg:inline">• Golden Peak Malam: 19:00 - 21:45 WIB</span>
    </div>
    <button on:click={()=> showScheduleModal = true} class="text-[11px] text-amber-300 hover:text-amber-200 underline font-medium">Buka Panduan Jadwal Lengkap →</button>
  </div>

  <!-- top stats bar -->
  {#if diag?.disk}
    <div class="max-w-[1320px] mx-auto px-4 sm:px-6 pb-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span class="px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700">💾 {diskPct!==null ? `${diskPct}% pakai` : ''} {diskFree!==null ? `• ${diskFree} GB sisa` : ''}</span>
      {#if hlth?.groq_api_key}<span class="px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 hidden sm:inline">🎙 {hlth.groq_api_key.model}</span>{/if}
      {#if diag?.quota_error}<span class="px-2 py-1 rounded-full bg-amber-950 border border-amber-800 text-amber-200 truncate max-w-[220px]">{diag.quota_error}</span>{/if}
      {#if diskPct!==null}
        <div class="flex-1 min-w-[120px] max-w-[200px] h-1.5 rounded-full bg-zinc-800 overflow-hidden hidden sm:block"><div class="h-full {diskPct>80 ? 'bg-red-600' : diskPct>65 ? 'bg-amber-600' : 'bg-emerald-600'}" style="width:{Math.min(100,diskPct)}%"></div></div>
      {/if}
      <button on:click={()=>{fetchDiagnostics(''); fetchHealth(''); loadStorageStats();}} class="ml-auto text-[11px] px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 hover:bg-zinc-700">↻</button>
    </div>
  {/if}
  <!-- desktop tabs -->
  <div class="max-w-[1320px] mx-auto px-4 sm:px-6 pb-3 hidden sm:flex gap-2">
    <button on:click={()=>switchTab('dl')} class="px-5 py-2.5 rounded-full border text-sm font-bold {tab==='dl' ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'}">⬇ Download</button>
    <button on:click={()=>switchTab('clip')} class="px-5 py-2.5 rounded-full border text-sm font-bold {tab==='clip' ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'}">✂ Clipper <span class="opacity-60 text-xs">{clipList.length ? `(${clipList.length})` : ''}</span></button>
    <button on:click={()=>switchTab('manage')} class="px-5 py-2.5 rounded-full border text-sm font-bold {tab==='manage' ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'}">🗂 Kelola</button>
  </div>
</header>

<!-- Modal Jadwal Waktu Posting -->
{#if showScheduleModal}
  <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto shadow-2xl">
      <div class="flex items-center justify-between pb-4 border-b border-zinc-800">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">🕒</span>
          <div>
            <h3 class="font-extrabold text-lg text-white">Matriks Waktu Posting Prime Time TikTok</h3>
            <p class="text-xs text-zinc-400">Dikalibrasi untuk algoritma Indonesia (WIB / GMT+7)</p>
          </div>
        </div>
        <button on:click={()=> showScheduleModal = false} class="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold grid place-items-center text-sm">✕</button>
      </div>

      <div class="mt-4 p-4 rounded-2xl bg-amber-950/30 border border-amber-800/80 flex items-center justify-between gap-3">
        <div>
          <div class="text-xs text-amber-300 font-bold uppercase tracking-wider">Status Waktu Sekarang</div>
          <div class="text-base font-black text-amber-100">{wibNow.dayName}, {wibNow.timeStr}</div>
          <div class="text-xs text-amber-200/80 mt-0.5">
            {#if wibNow.currentSlot}
              🔥 Slot Aktif: <strong>{wibNow.currentSlot}</strong>
            {:else}
              ⏳ Menuju slot berikutnya: <strong>{wibNow.nextSlot}</strong>
            {/if}
          </div>
        </div>
        <div class="text-right">
          <span class="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-bold inline-block">
            {wibNow.isGoldenNow ? '🌟 GOLDEN PEAK' : 'Rekomendasi Siap'}
          </span>
        </div>
      </div>

      <div class="mt-5 space-y-3">
        <h4 class="font-bold text-sm text-zinc-300">4 Slot Prime Time Harian (Algoritma FYP)</h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div class="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-bold text-zinc-200">1. Pagi (Sarapan & Commute)</span>
              <span class="px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 text-[10px] font-bold">Tinggi</span>
            </div>
            <div class="text-amber-400 font-mono font-bold mt-1">06:30 - 08:30 WIB</div>
            <p class="text-zinc-400 text-[11px] mt-1">Pengguna bangun tidur & berangkat. Cocok untuk tips cepat, motivasi, & video edukasi ringkas.</p>
          </div>

          <div class="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-bold text-zinc-200">2. Siang (Istirahat & Makan)</span>
              <span class="px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 text-[10px] font-bold">Tinggi</span>
            </div>
            <div class="text-amber-400 font-mono font-bold mt-1">11:45 - 13:15 WIB</div>
            <p class="text-zinc-400 text-[11px] mt-1">Durasi sesi rata-rata 18 menit. Sangat baik untuk review produk affiliate, racun belanja, dan unboxing.</p>
          </div>

          <div class="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-bold text-zinc-200">3. Sore (Pulang Kerja)</span>
              <span class="px-2 py-0.5 rounded bg-zinc-800 text-amber-400 text-[10px] font-bold">Sedang</span>
            </div>
            <div class="text-amber-400 font-mono font-bold mt-1">16:30 - 18:00 WIB</div>
            <p class="text-zinc-400 text-[11px] mt-1">Pemanasan sebelum malam. Bagus untuk memancing komentar dan menguji respons awal video.</p>
          </div>

          <div class="p-3.5 rounded-2xl bg-zinc-950 border border-amber-900/60 bg-gradient-to-b from-amber-950/20 to-zinc-950">
            <div class="flex items-center justify-between">
              <span class="font-bold text-amber-200">4. Malam (Golden Prime Peak)</span>
              <span class="px-2 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-bold">Puncak 45%</span>
            </div>
            <div class="text-amber-300 font-mono font-bold mt-1">19:00 - 21:45 WIB</div>
            <p class="text-zinc-300 text-[11px] mt-1">Traffic tertinggi & sesi terlama. Konversi keranjang kuning dan completion rate tertinggi di slot ini.</p>
          </div>
        </div>
      </div>

      <div class="mt-5">
        <h4 class="font-bold text-sm text-zinc-300 mb-2.5">Jadwal Jam Emas Spesifik Hari Ini & Mingguan</h4>
        <div class="space-y-1.5 text-xs">
          {#each [
            { day: 'Senin', hours: '12:00 & 19:30 WIB', desc: 'Edukasi praktis, mindset & motivasi awal pekan' },
            { day: 'Selasa', hours: '12:30 & 20:00 WIB', desc: 'Tutorial detail & komparasi produk affiliate' },
            { day: 'Rabu', hours: '11:30 & 19:00 WIB', desc: 'Spill affiliate komisi tinggi & tips cuan' },
            { day: 'Kamis', hours: '12:00, 16:30 & 20:00 WIB', desc: 'Storytelling & studi kasus viral' },
            { day: 'Jumat', hours: '13:30 & 19:00 - 22:00 WIB', desc: 'Persiapan belanja weekend, flash sale & diskon' },
            { day: 'Sabtu', hours: '10:00, 15:00 & 20:00 WIB', desc: 'Hiburan, review santai, lifestyle & shopping' },
            { day: 'Minggu', hours: '08:00, 13:00 & 19:00 WIB', desc: 'Recap mingguan, curhat interaktif, lifehack santai' }
          ] as d}
            <div class="p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 {d.day === wibNow.dayName ? 'bg-amber-950/40 border-amber-700 text-white font-medium' : 'bg-zinc-950 border-zinc-800 text-zinc-300'}">
              <div class="flex items-center gap-2">
                <span class="w-16 shrink-0 font-bold {d.day === wibNow.dayName ? 'text-amber-300' : 'text-zinc-400'}">{d.day} {d.day === wibNow.dayName ? '★' : ''}</span>
                <span class="font-mono text-amber-400 font-bold shrink-0">{d.hours}</span>
              </div>
              <span class="text-zinc-400 text-[11px] break-words flex-1 sm:text-right">{d.desc}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="mt-6 flex justify-end">
        <button on:click={()=> showScheduleModal = false} class="px-5 py-2.5 rounded-full bg-white text-zinc-900 text-xs font-bold hover:bg-zinc-200">Tutup Jadwal</button>
      </div>
    </div>
  </div>
{/if}

<main class="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 pb-24 sm:pb-6">
  {#if sse==='error'}<div class="mb-4 p-3 rounded-xl bg-red-950/30 border border-red-900 text-sm">SSE putus — reconnect otomatis. Jika terus, refresh hard.</div>{/if}
  {#if diag && diag.quota_error}<div class="mb-4 p-3 rounded-xl bg-amber-950/30 border border-amber-900 text-sm">Quota: {diag.quota_error}</div>{/if}

  {#if tab==='dl'}
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h2 class="font-bold text-[15px]">Download sumber — yt-dlp</h2>
      <p class="text-xs text-zinc-500 mt-1">Paste YouTube/TikTok URL, Info dulu cek metadata, Download simpan ke /downloads.</p>
      <div class="mt-3 flex flex-col gap-2">
        <input bind:value={url} placeholder="https://youtube.com/watch?v=... " class="w-full px-3 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm focus:border-violet-600 outline-none" />
        <div class="flex flex-wrap gap-2">
          <button on:click={doInfo} disabled={infoLoading||!url} class="flex-1 sm:flex-none px-4 py-3 rounded-xl bg-zinc-800 text-sm font-bold disabled:opacity-50 min-h-[44px] hover:bg-zinc-700"> {infoLoading ? '...' : 'Info'} </button>
          <button on:click={doDownload} disabled={dlBusy||!url} class="flex-1 sm:flex-none px-5 py-3 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-50 min-h-[44px] hover:bg-violet-500">{dlBusy ? '…' : '⬇ Download'}</button>
          <button on:click={doFromUrl} disabled={fromUrlBusy||!url} title="Download lalu langsung clip" class="flex-1 sm:flex-none px-5 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 min-h-[44px] hover:bg-emerald-500">{fromUrlBusy ? '…' : '⬇+✂ Auto Clip'}</button>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700"><input type="checkbox" bind:checked={noPlaylist} /> no-playlist</label>
        <select bind:value={fmt} class="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 min-h-[40px]"><option value="mp4">mp4</option><option value="webm">webm</option><option value="mp3">mp3</option><option value="m4a">m4a</option></select>
        <select bind:value={qual} class="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 min-h-[40px]"><option value="best">best</option><option value="worst">worst</option><option value="720">720p</option></select>
      </div>
      {#if info}
        <div class="mt-4 p-3.5 sm:p-4 rounded-xl bg-zinc-950 border border-violet-900/60 space-y-2.5">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <span class="text-[10px] uppercase tracking-wider font-bold text-violet-400">Metadata Video Terdeteksi</span>
              <h4 class="text-sm sm:text-base font-bold text-white mt-1 break-words break-all sm:break-normal leading-snug">{info.title || 'Video Tanpa Judul'}</h4>
              <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                {#if info.uploader}<span class="text-zinc-300 font-medium">👤 {info.uploader}</span>{/if}
                {#if info.duration}<span>⏱ {Math.floor(info.duration/60)}m {info.duration%60}s</span>{/if}
                {#if info.view_count}<span>👁 {info.view_count.toLocaleString('id-ID')} views</span>{/if}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button on:click={doDownload} disabled={dlBusy} class="px-3.5 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 min-h-[38px]">
                {dlBusy ? '…' : '⬇ Download'}
              </button>
              <button on:click={doFromUrl} disabled={fromUrlBusy} class="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 min-h-[38px]">
                {fromUrlBusy ? '…' : '✂ Auto Clip'}
              </button>
            </div>
          </div>
          {#if info.description}
            <p class="text-xs text-zinc-400 break-words line-clamp-3 font-sans leading-relaxed">{info.description}</p>
          {/if}
          <details class="text-[11px] text-zinc-500">
            <summary class="cursor-pointer hover:text-zinc-400">Lihat raw JSON info</summary>
            <pre class="mt-1 p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] overflow-auto max-h-[140px] whitespace-pre-wrap break-all">{JSON.stringify(info,null,2)}</pre>
          </details>
        </div>
      {/if}
    </section>
    <section class="mt-6">
      <div class="flex items-center justify-between gap-2"><h3 class="font-bold text-sm">Jobs download — live <span class="text-zinc-500 font-normal">SSE {ytdList.length}</span></h3><span class="text-[11px] text-zinc-500 hidden sm:inline">yt-dlp → /downloads</span></div>
      {#if ytdList.length===0}<p class="text-sm text-zinc-500 mt-3 py-4 text-center border border-dashed border-zinc-800 rounded-2xl">Belum ada job. Download di atas untuk lihat progress live.</p>
      {:else}
        <div class="mt-3 grid gap-3">
          {#each ytdList as j (j.job_id)}
            <div class="p-4 rounded-2xl border {j.status==='error' ? 'border-red-900 bg-red-950/20' : j.status==='completed' ? 'border-emerald-900 bg-emerald-950/10' : 'border-zinc-800 bg-zinc-900'}">
              <div class="flex items-start gap-3">
                <div class="w-11 h-11 rounded-xl {j.status==='completed' ? 'bg-emerald-900' : j.status==='error' ? 'bg-red-900' : 'bg-violet-900/50 border border-violet-800'} grid place-items-center text-sm shrink-0">{j.status==='completed' ? '✓' : j.status==='error' ? '!' : '⬇'}</div>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold break-words break-all sm:break-normal leading-snug text-white">{j.filename||j.url}</div>
                  <div class="text-xs text-zinc-500 break-all mt-0.5">{j.url}</div>
                  <div class="mt-2 flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
                    <span class="px-2 py-0.5 rounded-full {j.status==='completed' ? 'bg-emerald-950 border border-emerald-800 text-emerald-200' : j.status==='error' ? 'bg-red-950 border border-red-800 text-red-200' : 'bg-zinc-800 border border-zinc-700'}">{j.status} {pct(j)}%</span>
                    {#if j.speed}<span class="inline-block">{j.speed}</span>{/if}
                    {#if j.eta}<span class="inline-block">ETA {j.eta}</span>{/if}
                  </div>
                  <div class="mt-2 h-2.5 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full bg-violet-600 transition-all" style="width: {pct(j)}%"></div></div>
                  {#if j.error}<div class="mt-2 p-2 rounded-xl bg-red-950/30 border border-red-900 text-xs break-all">{j.error}</div>{/if}
                  {#if j.logs && j.logs.length}
                    <details class="mt-2"><summary class="text-xs text-zinc-400 cursor-pointer">log {j.logs.length}</summary><pre class="mt-1 p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] overflow-auto max-h-[140px] whitespace-pre-wrap break-words">{j.logs.slice(-40).join('\n')}</pre></details>
                  {/if}
                  {#if j.filename && j.status==='completed'}<button on:click={()=>clipFromFile(j.filename)} class="mt-3 w-full sm:w-auto px-4 py-2.5 rounded-full bg-white text-zinc-900 text-xs font-bold min-h-[40px]">✂ Jadikan Clipper</button>{/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
    <section class="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div class="flex items-center justify-between gap-2"><h3 class="font-bold text-sm">Sumber siap clip — {sources.length} file</h3><button on:click={loadSources} class="text-xs px-3 py-2 rounded-full bg-zinc-800 border border-zinc-700 min-h-[36px]">{sourcesLoading ? '…' : '↻'}</button></div>
      <input bind:value={srcFilter} placeholder="filter nama…" class="mt-3 w-full px-3 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm focus:border-violet-600 outline-none" />
      {#if filteredSources.length===0}<p class="text-sm text-zinc-500 mt-3 text-center py-3">{sourcesLoading ? 'Memuat…' : 'Belum ada file video di downloads.'}</p>
      {:else}
        <div class="mt-3 grid gap-2">
          {#each filteredSources as f}
            <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-mono break-words break-all leading-snug text-white font-medium">{f.name||f.filename||f.path}</div>
                <div class="text-xs text-zinc-500 mt-0.5">{f.size_human||''} {f.mtime ? new Date(f.mtime*1000).toLocaleDateString('id-ID') : ''}</div>
              </div>
              <button on:click={()=>clipFromFile(f.name||f.filename)} class="w-full sm:w-auto px-4 py-2.5 rounded-full bg-violet-600 text-white text-xs font-bold shrink-0 min-h-[40px] hover:bg-violet-500 text-center">✂ Clip</button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else if tab==='clip'}
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h2 class="font-bold text-[15px]">Upload lalu Clip — POST /clip</h2>
      <p class="text-xs text-zinc-500 mt-1">Pilih dari Sumber atau upload baru — hook+SEO+CTA auto, watermark @brogalanblora.</p>
      
      <!-- AI Automation Engine Suite Box -->
      <div class="mt-4 p-4 rounded-2xl bg-zinc-950 border border-violet-900/60 bg-gradient-to-b from-violet-950/20 to-zinc-950 space-y-3.5">
        <div class="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
          <div class="flex items-center gap-2">
            <span class="text-base">⚙️</span>
            <span class="font-bold text-xs sm:text-sm text-white">AI Automation Suite (Standar FYP 2026)</span>
          </div>
          <button on:click={()=> showAdvAutomation = !showAdvAutomation} class="text-[11px] text-violet-300 hover:underline">
            {showAdvAutomation ? 'Sembunyikan Opsi' : 'Tampilkan Opsi'}
          </button>
        </div>

        {#if showAdvAutomation}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <!-- 1. Seamless Loop -->
            <div class="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-1.5">
              <label class="flex items-center gap-2 font-bold text-zinc-200 cursor-pointer">
                <input type="checkbox" bind:checked={optSeamlessLoop} class="rounded text-violet-600 focus:ring-0" />
                <span>🔁 Seamless Loop 200%</span>
              </label>
              <p class="text-[11px] text-zinc-400 leading-tight">
                Potong kalimat penutup agar menyatu langsung ke detik ke-0 (frame pertama) + audio crossfade 120ms.
              </p>
              <span class="inline-block px-2 py-0.5 rounded bg-violet-950 border border-violet-800 text-violet-300 text-[10px] font-mono">
                Re-watch Maximizer
              </span>
            </div>

            <!-- 2. Stock Backsound Sesuai Tema -->
            <div class="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-1.5">
              <div class="font-bold text-zinc-200 flex items-center justify-between">
                <span>🎵 Stock Backsound</span>
                <span class="text-[10px] text-emerald-400 font-bold">TikTok Safe</span>
              </div>
              <select bind:value={optBacksoundTheme} class="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 outline-none">
                <option value="auto">✨ Auto AI Match Tema</option>
                <option value="edukasi_bisnis">💼 Lofi Chill (Edukasi/Bisnis)</option>
                <option value="affiliate_hype">🔥 Energetic Trap (Affiliate/Hype)</option>
                <option value="storytelling">🎬 Cinematic Ambient (Kasus/Story)</option>
                <option value="komedi_funky">🎉 Funky Groove (Santai/Komedi)</option>
                <option value="none">🚫 Tanpa Backsound (Audio Asli)</option>
              </select>
              <p class="text-[10px] text-zinc-400 leading-tight">Auto-ducking -14dB saat vokal berbicara • 100% Bebas Royalti.</p>
            </div>

            <!-- 3. Pembersihan Filler Words & Dead-Air -->
            <div class="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-1.5">
              <label class="flex items-center gap-2 font-bold text-zinc-200 cursor-pointer">
                <input type="checkbox" bind:checked={optCleanFillers} class="rounded text-violet-600 focus:ring-0" />
                <span>⚡ Pembersihan Filler Words</span>
              </label>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-zinc-400">Sensitivitas:</span>
                <select bind:value={optCleanSensitivity} class="flex-1 px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-[11px] text-zinc-200 outline-none">
                  <option value="seimbang">Seimbang (Cut >0.45s)</option>
                  <option value="agresif">Agresif (Hiper-kinetik)</option>
                  <option value="natural">Natural (>0.8s)</option>
                </select>
              </div>
              <p class="text-[10px] text-zinc-400 leading-tight">Eliminasi "ehm", "aa", & jeda hening untuk narasi padat 160 WPM.</p>
            </div>
          </div>
        {/if}
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <input id="upload-input" type="file" accept=".mp4,.mov,.mkv,.avi,.webm,.m4v,.mp3,.m4a,.opus,.wav" on:change={(e)=> uploadFile=e.target.files[0]} class="w-full text-sm file:mr-3 file:px-4 file:py-2.5 file:rounded-full file:border-0 file:bg-zinc-800 file:text-white file:font-bold" />
        <button on:click={doUpload} disabled={uploadBusy||!uploadFile} class="w-full sm:w-auto px-5 py-3 rounded-xl bg-white text-zinc-900 text-sm font-bold disabled:opacity-50 min-h-[44px] hover:bg-zinc-200">{uploadBusy ? 'Upload & Memproses…' : 'Upload & Jalankan Auto-Clip'}</button>
      </div>
      <div class="mt-4">
        <div class="flex items-center justify-between gap-2"><h3 class="font-bold text-sm">Sumber — pilih file</h3><button on:click={loadSources} class="text-xs px-3 py-2 rounded-full bg-zinc-800 border border-zinc-700 min-h-[36px]">{sourcesLoading ? '…' : '↻'}</button></div>
        <input bind:value={srcFilter} placeholder="filter…" class="mt-2 w-full px-3 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm focus:border-violet-600 outline-none" />
        {#if filteredSources.length===0}<p class="text-sm text-zinc-500 mt-2 text-center py-3">{sourcesLoading ? 'Memuat…' : 'Kosong'}</p>
        {:else}<div class="mt-2 grid gap-2 max-h-[320px] overflow-auto pr-1">{#each filteredSources as f}<div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"><span class="text-xs font-mono break-words break-all leading-snug flex-1 min-w-0 text-white">{f.name||f.filename}</span><button on:click={()=>clipFromFile(f.name||f.filename)} class="w-full sm:w-auto px-4 py-2 rounded-full bg-violet-600 text-white text-xs font-bold shrink-0 min-h-[36px] hover:bg-violet-500 text-center" title="Clip dengan AI Automation Engine">✂ Clip</button></div>{/each}</div>{/if}
      </div>
    </section>
    <section class="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div class="flex items-center justify-between gap-2"><h2 class="font-bold text-[15px]">Clip jobs — live</h2><span class="text-xs px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700">{clipList.length} job</span></div>
      <p class="text-xs text-zinc-500 mt-1">SSE 1.5s • transcribe 0.15→0.65 • 9:16 DNA Rebirth • Auto Copy Caption & Hashtags</p>
      {#if clipList.length===0}<p class="text-sm text-zinc-500 mt-3 text-center py-6 border border-dashed border-zinc-800 rounded-2xl">Belum ada clip. Upload atau pilih sumber lalu Clip.</p>
      {:else}
        <div class="mt-4 grid gap-4">
          {#each clipList as j (j.job_id)}
            <div class="p-4 sm:p-5 rounded-2xl border {j.status==='FAILURE' ? 'border-red-900 bg-red-950/20' : j.status==='SUCCESS' ? 'border-emerald-900/60 bg-emerald-950/10' : 'border-zinc-800 bg-zinc-900'}">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-mono truncate text-zinc-300 font-bold">{j.job_id.slice(0,8)}…{j.job_id.slice(-4)}</span>
                <span class="text-xs px-2.5 py-1 rounded-full font-bold shrink-0 {j.status==='SUCCESS' ? 'bg-emerald-900 text-emerald-200' : j.status==='FAILURE' ? 'bg-red-900 text-red-200' : 'bg-violet-900/40 border border-violet-800 text-violet-200'}">{j.status} {pct(j)}%</span>
              </div>
              <div class="mt-2 h-2.5 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full {j.status==='SUCCESS' ? 'bg-emerald-600' : j.status==='FAILURE' ? 'bg-red-600' : 'bg-violet-600'} transition-all" style="width: {pct(j)}%;"></div></div>
              <div class="mt-1.5 flex items-center gap-2 text-xs">
                <span class="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700">{clipPhaseLabel(j)}</span>
                {#if j.status!=='SUCCESS' && j.status!=='FAILURE' && pct(j)>0 && pct(j)<100}<span class="text-zinc-500 text-[11px]">{pct(j)}% — {j.progress>=0.7 ? 'stitch/analyze/broll/render' : 'tunggu Groq Whisper'}</span>{/if}
              </div>
              {#if j.error}<div class="mt-2 p-2.5 rounded-xl bg-red-950/30 border border-red-900 text-xs break-all">{j.error}</div>{/if}
              {#if j.result}<div class="mt-2 text-xs text-emerald-300 font-medium">✓ {j.result.length} clip DNA Rebirth jadi — siap unggah ke TikTok</div>{/if}
              {#if j.logs && j.logs.length}<details class="mt-2"><summary class="text-xs text-zinc-400 cursor-pointer select-none">logs {j.logs.length} — tap buka</summary><pre class="mt-1 p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] overflow-auto max-h-[180px] whitespace-pre-wrap break-words">{j.logs.slice(-80).join('\n')}</pre></details>{/if}

              <!-- Rich Metadata & Copy Caption & Hashtags -->
              {#if metaCache[j.job_id]}
                {@const meta = metaCache[j.job_id]}
                <div class="mt-4 p-4 rounded-2xl bg-zinc-950 border border-zinc-800/90 space-y-3.5">
                  <!-- Rekomendasi Waktu Posting Card -->
                  <div class="p-3 rounded-xl bg-amber-950/20 border border-amber-800/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div class="flex items-center gap-2">
                      <span class="text-base">🕒</span>
                      <div>
                        <span class="font-bold text-amber-300">Rekomendasi Waktu Posting:</span>
                        <span class="text-zinc-300 ml-1">{meta.posting_schedule?.best_time_today || '19:00 - 21:45 WIB (Puncak FYP)'}</span>
                      </div>
                    </div>
                    <button on:click={()=> showScheduleModal = true} class="px-2.5 py-1 rounded-full bg-amber-900/40 border border-amber-700/60 text-amber-200 text-[11px] font-bold hover:bg-amber-800/50">Cek Kalender Harian →</button>
                  </div>

                  <!-- Captions, Loops, Backsounds & Hashtags Box for Each Output File -->
                  {#each Object.entries(meta.captions || {}) as [fname, rawCap]}
                    {@const capObj = meta.detailed_captions?.[fname]}
                    {@const fullCap = getFullCaption(meta, fname)}
                    {@const hookText = getHookText(meta, fname)}
                    {@const hashStr = getHashtagsString(capObj, rawCap)}
                    {@const hashList = getHashtagList(capObj, rawCap)}
                    {@const loopData = meta.seamless_loop?.[fname]}
                    {@const bgData = meta.backsound?.[fname]}
                    {@const cleanData = meta.narrative_cleaning?.[fname]}

                    <div class="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3">
                      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span class="text-xs font-mono font-bold text-violet-300 break-words break-all leading-snug min-w-0 flex-1">{fname}</span>
                        <div class="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                          {#if loopData?.enabled}
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold flex items-center gap-1">
                              <span>🔁</span>
                              <span>Loop {loopData.loop_score}%</span>
                            </span>
                          {/if}
                          <span class="text-[10px] px-2 py-0.5 rounded-full bg-violet-950 border border-violet-800 text-violet-300 font-bold">SEO Calibrated</span>
                        </div>
                      </div>

                      <!-- 1. Seamless Loop Bridge Alert Box -->
                      {#if loopData?.enabled}
                        <div class="p-2.5 rounded-xl bg-zinc-950/90 border border-emerald-900/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                              <span>🔁 Re-watch Maximizer (Seamless Loop)</span>
                              <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300">Crossfade {loopData.crossfade_ms}ms</span>
                            </div>
                            <p class="text-zinc-300 italic text-[11px] mt-0.5 font-sans">
                              "{loopData.bridge_phrase}" <span class="text-emerald-400 font-bold">→ [Kembali ke Detik 0]</span>
                            </p>
                          </div>
                          <button on:click={()=> copyText(loopData.bridge_phrase, 'Kalimat Bridge Loop')} class="px-2.5 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-200 text-[11px] font-bold shrink-0">
                            Copy Bridge
                          </button>
                        </div>
                      {/if}

                      <!-- 2. Stock Backsound & Narrative Density Telemetry Row -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {#if bgData}
                          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                            <div class="flex items-center justify-between text-[11px]">
                              <span class="font-bold text-zinc-300 flex items-center gap-1">
                                <span>🎵</span>
                                <span>{bgData.track_title}</span>
                              </span>
                              <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 font-bold">Safe</span>
                            </div>
                            <p class="text-[10px] text-zinc-400">
                              Ducking: <strong class="text-zinc-300">{bgData.ducking_db}</strong> • Bebas Mute UU No.28
                            </p>
                          </div>
                        {/if}

                        {#if cleanData?.enabled}
                          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                            <div class="flex items-center justify-between text-[11px]">
                              <span class="font-bold text-zinc-300 flex items-center gap-1">
                                <span>⚡</span>
                                <span>Narasi: {cleanData.pacing_wpm} WPM</span>
                              </span>
                              <span class="text-[10px] px-1.5 py-0.2 rounded bg-violet-950 text-violet-300 font-bold">+{cleanData.speedup_pct}% Kinetik</span>
                            </div>
                            <p class="text-[10px] text-zinc-400">
                              {cleanData.filler_words_removed} filler dibersihkan • {cleanData.silence_cut_sec}s dead-air dipotong
                            </p>
                          </div>
                        {/if}
                      </div>

                      <!-- Caption Box -->
                      <div class="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 leading-relaxed font-sans select-all">
                        {fullCap}
                      </div>

                      <!-- Interactive Hashtag Chips -->
                      <div class="flex flex-wrap gap-1.5 items-center">
                        <span class="text-[11px] text-zinc-500 font-bold">Hashtags:</span>
                        {#each hashList as tag}
                          <button on:click={()=> copyText(tag, `Hashtag ${tag}`)} class="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[11px] text-violet-300 font-mono" title="Klik untuk salin tag ini">
                            {tag}
                          </button>
                        {/each}
                      </div>

                      <!-- Action Copy Buttons Grid -->
                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                        <button on:click={()=> copyText(fullCap, 'Caption Lengkap')} class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 min-h-[38px] shadow-sm">
                          <span>📋</span>
                          <span>Copy Caption</span>
                        </button>
                        <button on:click={()=> copyText(hashStr, 'Daftar Hashtags')} class="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-1.5 min-h-[38px]">
                          <span>#️⃣</span>
                          <span>Copy Hashtag</span>
                        </button>
                        <button on:click={()=> copyText(hookText, 'Hook 3 Detik')} class="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-1.5 min-h-[38px]">
                          <span>💡</span>
                          <span>Copy Hook</span>
                        </button>
                        {#if (meta.engagement?.comments || []).length}
                          <button on:click={()=> copyText(meta.engagement.comments[0], 'Komen Pancingan')} class="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-1.5 min-h-[38px]">
                            <span>💬</span>
                            <span>Copy Komen</span>
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}

                  <!-- Niche Advisory & Pinned Comments -->
                  {#if meta.engagement}
                    <div class="pt-2 border-t border-zinc-800/80 space-y-2">
                      <div class="flex flex-wrap gap-2 items-center text-xs">
                        <span class="px-2.5 py-1 rounded-full font-bold border {meta.engagement.niche_score>=80 ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-amber-950 border-amber-800 text-amber-200'}">
                          {meta.engagement.niche_tag || 'Affiliate'} • Skor Kelayakan {meta.engagement.niche_score ?? 90}/100
                        </span>
                        <span class="px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold">
                          {meta.engagement.niche_profit_tier || 'Tier A (Komisi 15-25%)'}
                        </span>
                      </div>
                      {#if meta.engagement.niche_advisory}
                        <p class="text-[11px] text-zinc-400 italic">💡 {meta.engagement.niche_advisory}</p>
                      {/if}
                      {#if (meta.engagement.comments || []).length}
                        <div class="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-2 text-xs">
                          <div class="min-w-0 flex-1">
                            <span class="text-zinc-500 font-bold block text-[10px]">📌 Rekomendasi Pin Komentar Pertama (Pemicu Interaksi):</span>
                            <span class="text-zinc-200 italic font-sans">{meta.engagement.comments[0]}</span>
                          </div>
                          <button on:click={()=> copyText(meta.engagement.comments[0], 'Komentar Pin')} class="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-[11px] shrink-0">
                            Salin
                          </button>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}

              <div class="mt-3 flex flex-wrap gap-2">
                <button on:click={()=>viewMeta(j.job_id)} class="flex-1 sm:flex-none px-4 py-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-bold min-h-[40px] hover:bg-zinc-700">
                  {metaCache[j.job_id] ? 'Tutup Detail Meta' : 'Buka Caption & Hashtag'}
                </button>
                <a href="/jobs/{j.job_id}" target="_blank" class="px-4 py-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-center min-h-[40px] grid place-items-center hover:bg-zinc-700">/jobs/{j.job_id.slice(0,8)}</a>
              </div>
              {#if metaCache[j.job_id]}<details class="mt-2"><summary class="text-[11px] text-zinc-500 cursor-pointer">raw JSON</summary><pre class="mt-1 p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] overflow-auto max-h-[200px] whitespace-pre-wrap break-words">{JSON.stringify(metaCache[j.job_id], null, 2)}</pre></details>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Renders Grid -->
    <section class="mt-6">
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-bold text-sm">Renders Siap Unggah — dengan Caption & Hashtag</h3>
        <span class="text-xs text-zinc-500">{rendList.length} file</span>
      </div>
      {#if rendList.length===0}<p class="text-sm text-zinc-500 mt-2 text-center py-6 border border-dashed border-zinc-800 rounded-2xl">Belum ada renders. Clip dulu.</p>
      {:else}
        <div class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {#each rendList as r}
            {@const meta = metaCache[r.job_id]}
            {@const capObj = meta?.detailed_captions?.[r.filename]}
            {@const fullCap = getFullCaption(meta, r.filename)}
            {@const hashStr = getHashtagsString(capObj, meta?.captions?.[r.filename])}

            <div class="p-4 rounded-2xl border border-zinc-800 bg-zinc-900 space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="text-xs sm:text-sm font-mono break-words break-all leading-snug font-bold text-white">{r.filename}</div>
                  <div class="text-xs text-zinc-500 mt-1">{r.job_id.slice(0,8)} • {(r.size/1024/1024).toFixed(1)} MB • 9:16 HD</div>
                </div>
                <div class="flex items-center gap-1 shrink-0 self-start sm:self-auto">
                  {#if meta?.seamless_loop?.[r.filename]?.enabled}
                    <span class="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 text-[10px] font-bold" title="Seamless Loop Active">🔁 Loop</span>
                  {/if}
                  <span class="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-200 text-[10px] font-bold">DNA Clean</span>
                </div>
              </div>

              <!-- Loop bridge indicator if active -->
              {#if meta?.seamless_loop?.[r.filename]?.enabled}
                <div class="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px]">
                  <span class="text-emerald-300 break-words leading-relaxed flex-1">🔁 Bridge: "{meta.seamless_loop[r.filename].bridge_phrase}"</span>
                  <button on:click={()=> copyText(meta.seamless_loop[r.filename].bridge_phrase, 'Bridge Loop')} class="text-[10px] text-emerald-200 hover:underline shrink-0 font-bold self-end sm:self-auto">Salin</button>
                </div>
              {/if}

              <!-- Quick Caption Preview Box -->
              <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 leading-relaxed font-sans">
                {fullCap}
              </div>

              <!-- Inline Video Player Preview -->
              {#if openVideoPreview[r.filename]}
                <div class="p-3 rounded-xl bg-black border border-violet-900/60 flex flex-col items-center gap-2">
                  <div class="w-full max-w-[240px] aspect-[9/16] rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl relative">
                    <video
                      src="/renders/{r.job_id}/{r.filename}"
                      controls
                      playsinline
                      preload="metadata"
                      class="w-full h-full object-cover"
                    >
                      <track kind="captions" />
                    </video>
                  </div>
                  <span class="text-[11px] text-zinc-400">9:16 Vertical HD • Watermark @brogalanblora</span>
                </div>
              {/if}

              <!-- Action Buttons -->
              <div class="flex gap-2 flex-wrap items-center">
                <button
                  on:click={()=> openVideoPreview[r.filename] = !openVideoPreview[r.filename]}
                  class="px-3.5 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-bold text-white min-h-[40px] flex items-center gap-1.5"
                >
                  <span>{openVideoPreview[r.filename] ? '✕ Tutup Player' : '▶ Putar Video'}</span>
                </button>
                <a href="/renders/{r.job_id}/{r.filename}" class="flex-1 px-4 py-2.5 rounded-full bg-violet-600 text-white text-xs font-bold text-center min-h-[40px] grid place-items-center hover:bg-violet-500 shadow-md">
                  ⬇ Download Video
                </a>
                <button on:click={()=> copyText(fullCap, 'Caption Lengkap')} class="px-3.5 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-bold text-zinc-200 min-h-[40px] flex items-center gap-1.5" title="Copy caption lengkap">
                  <span>📋</span>
                  <span>Caption</span>
                </button>
                <button on:click={()=> copyText(hashStr, 'Hashtags')} class="px-3.5 py-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-bold text-zinc-200 min-h-[40px] flex items-center gap-1.5" title="Copy hashtags">
                  <span>#️⃣</span>
                  <span>Hashtag</span>
                </button>
                <button on:click={()=>delRender(r.job_id, r.filename)} class="px-3 py-2.5 rounded-full bg-red-900/30 border border-red-900 text-red-300 text-xs min-h-[40px] hover:bg-red-900/50">
                  Hapus
                </button>
              </div>

              <!-- Prime Time Quick Badge -->
              <div class="pt-1 flex items-center justify-between text-[11px] text-zinc-400">
                <span>🕒 Rekomendasi: <strong class="text-amber-300">19:00 - 21:45 WIB</strong></span>
                <button on:click={()=> showScheduleModal = true} class="text-violet-400 hover:underline">Jadwal FYP →</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h2 class="font-bold text-[15px]">Kelola File — storage & renders</h2>
      {#if diag}
        <div class="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {#each Object.entries(diag.storage_stats||{}) as [k,v]}
            <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800"><div class="font-bold capitalize">{k}</div><div class="text-zinc-400">{v?.human||''} • {v?.files||0} file</div></div>
          {/each}
        </div>
        {#if diag.disk}<div class="mt-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"><div class="flex justify-between"><span>Disk {diag.disk.root?.used_pct||'?'}% terpakai</span><span class="text-zinc-500">{diag.disk.storage?.free_gb||'?'} GB sisa</span></div><div class="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full {diag.disk.root?.used_pct>80 ? 'bg-red-600' : 'bg-violet-600'}" style="width:{diag.disk.root?.used_pct||0}%"></div></div></div>{/if}
        {#if diag.quota_error}<div class="mt-2 p-2 rounded-xl bg-amber-950/30 border border-amber-900 text-xs">{diag.quota_error}</div>{/if}
      {:else}<p class="text-sm text-zinc-500 mt-3">Memuat diagnostics…</p>{/if}
      {#if storageStats}
        <div class="mt-4 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
          <div class="font-bold">/clip/storage-stats</div>
          <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">{#each Object.entries(storageStats) as [k,v]}<div class="flex justify-between border-b border-zinc-800 py-1"><span>{k}</span><span class="text-zinc-400">{v.human||v.bytes} ({v.files})</span></div>{/each}</div>
        </div>
      {/if}
      <div class="mt-4 flex flex-wrap gap-2"><button on:click={loadStorageStats} class="px-4 py-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-bold min-h-[40px] hover:bg-zinc-700">{storageLoading ? '…' : '↻ Refresh'}</button><button on:click={bulkDeleteRenders} disabled={bulkBusy||selectedRenders.size===0} class="px-4 py-2.5 rounded-full bg-red-900 border border-red-800 text-red-200 text-xs font-bold disabled:opacity-50 min-h-[40px] hover:bg-red-800">Hapus {selectedRenders.size} renders</button></div>
      <h3 class="font-bold text-sm mt-6">Renders — pilih hapus</h3>
      {#if rendList.length===0}<p class="text-sm text-zinc-500 mt-2">Belum ada renders.</p>
      {:else}
        <div class="mt-3 grid gap-2">
          {#each rendList as r}
            <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
              <input type="checkbox" checked={selectedRenders.has(r.job_id)} on:change={()=>toggleRender(r.job_id)} class="w-5 h-5 shrink-0 accent-violet-600" />
              <div class="min-w-0 flex-1"><div class="text-sm font-mono break-words break-all leading-snug text-white">{r.filename}</div><div class="text-xs text-zinc-500 mt-0.5">{r.job_id.slice(0,8)} • {(r.size/1024/1024).toFixed(1)} MB</div></div>
              <a href="/renders/{r.job_id}/{r.filename}" class="px-3 py-2 rounded-full bg-zinc-800 border border-zinc-700 text-xs shrink-0 hover:bg-zinc-700">Unduh</a>
            </div>
          {/each}
        </div>
      {/if}
      <h3 class="font-bold text-sm mt-6">Downloads — pilih hapus</h3>
      <div class="flex gap-2 mt-2 flex-wrap"><button on:click={bulkDeleteDownloads} disabled={bulkBusy||selectedDownloads.size===0} class="px-4 py-2.5 rounded-full bg-red-900 border border-red-800 text-red-200 text-xs font-bold disabled:opacity-50 min-h-[40px] hover:bg-red-800">Hapus {selectedDownloads.size} downloads</button><button on:click={loadSources} class="px-4 py-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-bold min-h-[40px] hover:bg-zinc-700">↻ Sources</button></div>
      {#if sources.length===0}<p class="text-sm text-zinc-500 mt-3">Tidak ada downloads.</p>
      {:else}
        <div class="mt-3 grid gap-2">
          {#each sources as f}
            <div class="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
              <input type="checkbox" checked={selectedDownloads.has(f.name||f.filename)} on:change={()=>toggleDownload(f.name||f.filename)} class="w-5 h-5 shrink-0 accent-violet-600" />
              <div class="min-w-0 flex-1"><div class="text-sm font-mono break-words break-all leading-snug text-white">{f.name||f.filename}</div><div class="text-xs text-zinc-500 mt-0.5">{f.size_human||''}</div></div>
              <button on:click={()=>clipFromFile(f.name||f.filename)} class="px-3 py-2 rounded-full bg-violet-600 text-white text-xs font-bold shrink-0 min-h-[40px] hover:bg-violet-500">✂</button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</main>

<!-- mobile bottom nav -->
<nav class="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex">
  <button on:click={()=>switchTab('dl')} class="flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-bold {tab==='dl' ? 'text-white bg-zinc-800' : 'text-zinc-500'}"><span class="text-base">⬇</span>Download</button>
  <button on:click={()=>switchTab('clip')} class="flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-bold {tab==='clip' ? 'text-white bg-zinc-800' : 'text-zinc-500'}"><span class="text-base">✂</span>Clipper {#if clipList.length}<span class="text-[10px] px-1 rounded bg-violet-600 text-white">{clipList.length}</span>{/if}</button>
  <button on:click={()=>switchTab('manage')} class="flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-bold {tab==='manage' ? 'text-white bg-zinc-800' : 'text-zinc-500'}"><span class="text-base">🗂</span>Kelola</button>
</nav>

