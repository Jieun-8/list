(() => {
  "use strict";
  const KEY = "card-management-manual-coordinates-v1";
  const assetBase = new URL(".", document.currentScript.src);
  const $ = (sel, root=document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const read = () => {
    try {
      const x = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(x) ? x.filter(v => v && typeof v.id==="string" && typeof v.name==="string") : [];
    } catch { return []; }
  };
  const write = (rows) => localStorage.setItem(KEY, JSON.stringify(rows));
  const makeId = () => "manual-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
  let editId = null, pendingQr = "", stream = null, scanFrame = 0, libs = null;
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "manual-coordinate-launcher";
  launcher.textContent = "自分のコーデ";
  launcher.setAttribute("aria-haspopup","dialog");
  document.body.append(launcher);
  const dlg = document.createElement("dialog");
  dlg.className = "manual-coordinate-dialog";
  dlg.setAttribute("aria-labelledby","manual-coordinate-title");
  dlg.innerHTML = `
    <div class="manual-coordinate-heading"><h2 id="manual-coordinate-title">自分のコーデ</h2><button type="button" data-close aria-label="閉じる">×</button></div>
    <p class="manual-coordinate-note">自分で登録したコーデを、このブラウザ内に保存します。公式カタログや他の端末とは同期しません。</p>
    <div class="manual-coordinate-actions"><button type="button" data-add>＋ コーデを登録</button><button type="button" data-export>バックアップを書き出す</button><button type="button" data-import>バックアップを読み込む</button><input type="file" accept="application/json,.json" data-import-file hidden></div>
    <p data-status role="status" aria-live="polite"></p>
    <div data-list class="manual-coordinate-list"></div>
    <section data-form hidden>
      <h3 data-form-title>コーデを登録</h3>
      <label>コーデ名 <input data-name maxlength="100" required autocomplete="off" placeholder="例：お気に入りコーデ"></label>
      <label>メモ・情報（任意） <textarea data-memo maxlength="1500" rows="3" placeholder="シリーズ、入手場所など"></textarea></label>
      <label>画像（任意） <input data-image type="file" accept="image/*"></label>
      <div data-image-preview class="manual-coordinate-preview"></div>
      <div class="manual-coordinate-qr-row"><button type="button" data-scan>カメラでQRコードを読み取る</button><span data-qr-status>QRコード未登録</span></div>
      <button type="button" data-clear-qr>QR情報を外す</button>
      <div class="manual-coordinate-form-actions"><button type="button" data-cancel>キャンセル</button><button type="button" data-save>保存する</button></div>
    </section>
    <section data-scanner hidden>
      <p>QRコードをカメラに映してください。</p>
      <div class="manual-coordinate-camera"><video autoplay playsinline muted></video><span></span></div>
      <p data-scan-status role="status">カメラを起動しています…</p>
      <button type="button" data-stop-scan>読み取りをやめる</button>
    </section>`;
  document.body.append(dlg);
  const status = $("[data-status]",dlg), list = $("[data-list]",dlg), form = $("[data-form]",dlg), scanner = $("[data-scanner]",dlg);
  const imageInput = $("[data-image]",dlg), imagePreview = $("[data-image-preview]",dlg);
  const nameInput = $("[data-name]",dlg), memoInput = $("[data-memo]",dlg), qrStatus = $("[data-qr-status]",dlg);
  function stopCamera() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    if (stream) stream.getTracks().forEach(t=>t.stop());
    stream = null;
    const video = $("video",scanner);
    if (video) video.srcObject = null;
  }
  function showList(message="") {
    stopCamera(); scanner.hidden = true; form.hidden = true; list.hidden = false;
    status.textContent = message;
    const rows = read();
    list.replaceChildren();
    if (!rows.length) {
      const p = document.createElement("p"); p.className="manual-coordinate-empty";
      p.textContent="まだコーデが登録されていません。"; list.append(p);
    }
    rows.forEach(row => {
      const item=document.createElement("article"); item.className="manual-coordinate-item";
      if (row.image) { const img=document.createElement("img"); img.src=row.image; img.alt=row.name; item.append(img); }
      const info=document.createElement("div"); info.className="manual-coordinate-item-info";
      const title=document.createElement("strong"); title.textContent=row.name; info.append(title);
      if (row.memo) { const p=document.createElement("p"); p.textContent=row.memo; info.append(p); }
      const qr=document.createElement("small"); qr.textContent=row.qrPayload ? "QRコード登録済み" : "QRコード未登録"; info.append(qr);
      const actions=document.createElement("div"); actions.className="manual-coordinate-item-actions";
      const scan=document.createElement("button"); scan.type="button"; scan.textContent=row.qrPayload?"QRを読み直す":"QRを読み取る"; scan.onclick=()=>startScan(row.id);
      if(row.qrPayload){const qrShow=document.createElement("button");qrShow.type="button";qrShow.textContent="QRを表示";qrShow.onclick=()=>showQr(row);actions.append(qrShow);}
      const show=document.createElement("button"); show.type="button"; show.textContent="詳細・編集"; show.onclick=()=>openForm(row.id);
      const del=document.createElement("button"); del.type="button"; del.textContent="削除"; del.onclick=()=>{if(confirm("「"+row.name+"」を削除しますか？")){write(read().filter(x=>x.id!==row.id));showList("コーデを削除しました。");}};
      actions.append(scan,show,del); item.append(info,actions); list.append(item);
    });
  }
  async function showQr(row) {
    try {
      await loadQrLibs();
      const box=document.createElement("dialog");box.className="manual-coordinate-dialog manual-coordinate-qr-dialog";
      box.innerHTML='<div class="manual-coordinate-heading"><h2></h2><button type="button" aria-label="閉じる">×</button></div><div class="manual-coordinate-generated-qr"></div><p class="manual-coordinate-note">読み取ったQRコードの内容を再表示しています。</p>';
      $("h2",box).textContent=row.name;$("button",box).onclick=()=>box.close();
      const q=qrcode(0,"M");q.addData(row.qrPayload,"Byte");q.make();$(".manual-coordinate-generated-qr",box).innerHTML=q.createSvgTag({cellSize:5,margin:20,scalable:true});
      document.body.append(box);box.addEventListener("close",()=>box.remove(),{once:true});box.showModal();
    } catch { status.textContent="QRコードを表示できませんでした。"; }
  }
  function openForm(id=null) {
    stopCamera(); scanner.hidden=true; list.hidden=true; form.hidden=false; status.textContent="";
    editId=id; pendingQr=""; imageInput.value=""; imagePreview.replaceChildren(); imagePreview.dataset.newImage="";
    const row=id ? read().find(x=>x.id===id) : null;
    nameInput.value=row?.name||""; memoInput.value=row?.memo||"";
    pendingQr=row?.qrPayload||"";
    if(row?.image){const img=document.createElement("img");img.src=row.image;img.alt="画像プレビュー";imagePreview.append(img);}
    qrStatus.textContent=pendingQr?"QRコード登録済み":"QRコード未登録";
    $("[data-form-title]",dlg).textContent=row?"コーデを編集":"コーデを登録";
    $("[data-save]",dlg).textContent=row?"変更を保存":"登録する";
  }
  async function imageData(file) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw Error("画像ファイルを選択してください。");
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error("画像を読み込めませんでした。"));r.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error("画像を開けませんでした。"));i.src=data;});
    const scale=Math.min(1,720/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/jpeg",0.72);
  }
  imageInput.addEventListener("change",async()=>{imagePreview.replaceChildren();const file=imageInput.files?.[0];if(!file)return;try{const src=await imageData(file);const img=document.createElement("img");img.src=src;img.alt="画像プレビュー";imagePreview.append(img);imagePreview.dataset.newImage=src;}catch(e){status.textContent=e.message;}});
  async function loadQrLibs() {
    if(libs)return libs;
    libs=(async()=>{
      for(const src of ["vendor/qr-reader.js","vendor/qr-encoder.js"])
        await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=new URL(src,assetBase).href;s.onload=resolve;s.onerror=()=>reject(Error("QR読み取り機能を読み込めませんでした。"));document.head.append(s);});
    })().catch(e=>{libs=null;throw e;});
    return libs;
  }
  async function startScan(id) {
    stopCamera(); form.hidden=true; list.hidden=true; scanner.hidden=false; status.textContent="";
    $("[data-scan-status]",dlg).textContent="カメラを起動しています…";
    try {
      await loadQrLibs();
      if(!navigator.mediaDevices?.getUserMedia)throw Error("このブラウザではカメラを利用できません。HTTPSで開いてください。");
      const incoming=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      stream=incoming; const video=$("video",scanner); video.srcObject=stream; await video.play();
      const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
      let last=0;
      const tick=(time)=>{
        if(!stream||scanner.hidden)return;
        if(time-last<160||!video.videoWidth){scanFrame=requestAnimationFrame(tick);return;}
        last=time;const scale=Math.min(1,1000/video.videoWidth);canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
        const result=window.jsQR?.(pixels.data,canvas.width,canvas.height,{inversionAttempts:"attemptBoth"});
        if(result?.data){
          stopCamera();
          const rows=read(),index=rows.findIndex(x=>x.id===id);
          if(index>=0){rows[index].qrPayload=result.data;rows[index].updatedAt=new Date().toISOString();write(rows);showList("QRコードを登録しました。");}
          else {pendingQr=result.data;qrStatus.textContent="QRコード読み取り済み";scanner.hidden=true;form.hidden=false;list.hidden=true;}
          return;
        }
        scanFrame=requestAnimationFrame(tick);
      };
      scanFrame=requestAnimationFrame(tick);
      $("[data-scan-status]",dlg).textContent="QRコードを枠内に映してください。";
    } catch(e) {
      stopCamera();$("[data-scan-status]",dlg).textContent=e.message||"カメラを起動できませんでした。";
    }
  }
  launcher.addEventListener("click",()=>{dlg.showModal();showList();});
  $("[data-close]",dlg).onclick=()=>dlg.close();
  dlg.addEventListener("close",stopCamera);
  $("[data-add]",dlg).onclick=()=>openForm();
  $("[data-cancel]",dlg).onclick=()=>showList();
  $("[data-scan]",dlg).onclick=()=>startScan(editId);
  $("[data-stop-scan]",dlg).onclick=()=>showList("QRコードの読み取りを中止しました。");
  $("[data-clear-qr]",dlg).onclick=()=>{pendingQr="";qrStatus.textContent="QRコード未登録";};
  $("[data-save]",dlg).onclick=async()=>{
    const name=nameInput.value.trim(); if(!name){status.textContent="コーデ名を入力してください。";nameInput.focus();return;}
    const rows=read(),old=rows.find(x=>x.id===editId);
    let img=old?.image||"";
    try {
      if(imageInput.files?.[0])img=await imageData(imageInput.files[0]);
      else if(imagePreview.dataset.newImage)img=imagePreview.dataset.newImage;
      const row={id:editId||makeId(),name,memo:memoInput.value.trim(),image:img,qrPayload:pendingQr,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
      const next=rows.filter(x=>x.id!==row.id);next.unshift(row);write(next);
      imagePreview.dataset.newImage="";
      showList("コーデを保存しました。");
    } catch(e) {status.textContent=e?.name==="QuotaExceededError"?"保存容量が不足しています。画像を小さくして再度お試しください。":(e.message||"保存できませんでした。");}
  };
  $("[data-export]",dlg).onclick=()=>{
    const blob=new Blob([JSON.stringify({format:"card-management-manual-coordinates-v1",items:read()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="my-coordinates-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $("[data-import]",dlg).onclick=()=> $("[data-import-file]",dlg).click();
  $("[data-import-file]",dlg).onchange=async(e)=>{
    const file=e.target.files?.[0];e.target.value="";if(!file)return;
    try {
      const parsed=JSON.parse(await file.text()),items=Array.isArray(parsed)?parsed:parsed.items;
      if(!Array.isArray(items))throw Error("バックアップ形式を確認できません。");
      const current=read(),map=new Map(current.map(x=>[x.id,x]));
      items.forEach(x=>{if(x&&typeof x.name==="string"&&typeof x.id==="string")map.set(x.id,x);});
      write([...map.values()]);showList("バックアップを読み込みました。");
    } catch(err){status.textContent=err.message||"バックアップを読み込めませんでした.";}
  };
})();
