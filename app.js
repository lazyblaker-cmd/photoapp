(() => {
  // DOM 元素
  const video = document.getElementById('camera-video');
  const viewfinder = document.getElementById('viewfinder');
  const beforeOverlay = document.getElementById('before-overlay');
  const gridOverlay = document.getElementById('grid-overlay');
  const modeBanner = document.getElementById('mode-banner');
  const overlayControls = document.getElementById('overlay-controls');
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');

  const tabStep1 = document.getElementById('tab-step-1');
  const tabStep2 = document.getElementById('tab-step-2');
  const tabStep3 = document.getElementById('tab-step-3');
  const countBeforeEl = document.getElementById('count-before');
  const countAfterEl = document.getElementById('count-after');
  const slotListEl = document.getElementById('slot-list');

  const btnReset = document.getElementById('btn-reset');
  const btnShutter = document.getElementById('btn-shutter');
  const btnNextPhase = document.getElementById('btn-next-phase');
  const btnSwitchCam = document.getElementById('btn-switch-cam');
  const fileBeforeInput = document.getElementById('file-before-input');
  const lblAlbumBtn = document.getElementById('lbl-album-btn');
  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  const btnBlinkBefore = document.getElementById('btn-blink-before');
  const btnToResult = document.getElementById('btn-to-result');

  const cameraSection = document.getElementById('camera-section');
  const resultSection = document.getElementById('result-section');
  const segButtons = document.querySelectorAll('.seg-btn');
  const chkShowLabels = document.getElementById('chk-show-labels');

  const combinedPreviewBox = document.getElementById('combined-preview-box');
  const combinedResultImg = document.getElementById('combined-result-img');
  const resultStatusText = document.getElementById('result-status-text');
  const singlePreviewBox = document.getElementById('single-preview-box');
  const singleBeforeImg = document.getElementById('single-before-img');
  const singleAfterImg = document.getElementById('single-after-img');

  const btnSaveBefore = document.getElementById('btn-save-before');
  const btnSaveAfter = document.getElementById('btn-save-after');
  const btnRetakeAfter = document.getElementById('btn-retake-after');
  const btnShareCombined = document.getElementById('btn-share-combined');
  const btnShareAll = document.getElementById('btn-share-all');

  // 陀螺儀 DOM
  const btnEnableGyro = document.getElementById('btn-enable-gyro');
  const gyroReadout = document.getElementById('gyro-readout');
  const gyroText = document.getElementById('gyro-text');
  const gyroTargetBox = document.getElementById('gyro-target-box');
  const gyroRing = gyroTargetBox.querySelector('.gyro-ring');
  const gyroDot = document.getElementById('gyro-dot');
  const gyroDeltaBadge = document.getElementById('gyro-delta-badge');

  // 狀態
  let currentStream = null;
  let facingMode = 'environment';
  let step = 1; // 1: 連續拍事前照, 2: 依序對齊拍事後照, 3: 合成對比與批次匯出
  /**
   * slots: Array<{
   *   id: string,
   *   beforeDataUrl: string,
   *   afterDataUrl: string | null,
   *   gyro: { beta: number, gamma: number, heading: number | null } | null,
   *   width: number,
   *   height: number
   * }>
   */
  let slots = [];
  let selectedIndex = -1;
  let targetAspect = 3 / 4;
  let currentLayout = 'horizontal';
  let combinedDataUrl = '';

  // 陀螺儀狀態
  let gyroEnabled = false;
  let currentGyro = null;

  // IndexedDB 儲存（支援多張高畫質照片離線保存，關掉 Safari 也不會遺失）
  const DB_NAME = 'PhotoAppBatchDB';
  const STORE_NAME = 'slots_store';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSlotsToDB() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(slots, 'all_slots');
    } catch (e) {
      console.warn('無法寫入 IndexedDB:', e);
    }
  }

  async function loadSlotsFromDB() {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('all_slots');
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
  }

  // 啟動相機
  async function startCamera() {
    stopCamera();
    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 }
        }
      };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = currentStream;
      await video.play();
    } catch (err) {
      console.error('無法開啟相機:', err);
      modeBanner.textContent = '無法開啟相機，請確認相機權限或使用相簿匯入';
    }
  }

  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function captureVideoFrame(aspect) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const videoAspect = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;

    if (videoAspect > aspect) {
      sw = Math.round(vh * aspect);
      sx = Math.round((vw - sw) / 2);
    } else if (videoAspect < aspect) {
      sh = Math.round(vw / aspect);
      sy = Math.round((vh - sh) / 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  // 角度最短差值 (-180 ~ 180)
  function angleDiff(current, target) {
    return ((current - target + 540) % 360) - 180;
  }

  // 啟用陀螺儀
  async function enableGyroscope() {
    if (gyroEnabled) return;
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state !== 'granted') {
          btnEnableGyro.textContent = '⚠️ 請在 Safari 設定允許動作與方向權限';
          return;
        }
      }
      window.addEventListener('deviceorientation', handleOrientation, true);
      gyroEnabled = true;
      btnEnableGyro.classList.add('hidden');
      gyroReadout.classList.remove('hidden');
      updateGyroHUD();
    } catch (err) {
      btnEnableGyro.textContent = '⚠️ 無法讀取陀螺儀（需使用 HTTPS 網址）';
    }
  }

  function handleOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    const beta = Math.round(e.beta || 0);
    const gamma = Math.round(e.gamma || 0);
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') {
      heading = Math.round(e.webkitCompassHeading);
    } else if (typeof e.alpha === 'number') {
      heading = Math.round((360 - e.alpha) % 360);
    }
    currentGyro = { beta, gamma, heading };
    updateGyroHUD();
  }

  function getSelectedSlot() {
    if (selectedIndex >= 0 && selectedIndex < slots.length) {
      return slots[selectedIndex];
    }
    return null;
  }

  function updateGyroHUD() {
    if (!gyroEnabled || !currentGyro) {
      gyroTargetBox.classList.add('hidden');
      return;
    }

    const { beta, gamma, heading } = currentGyro;
    const headingStr = heading !== null ? ` ｜ 方位 ${heading}°` : '';

    if (step === 1) {
      gyroTargetBox.classList.add('hidden');
      gyroReadout.classList.remove('aligned');
      gyroText.textContent = `🧭 目前角度：俯仰 ${beta}° ｜ 水平 ${gamma}°${headingStr}`;
      return;
    }

    if (step === 2) {
      const slot = getSelectedSlot();
      const targetGyro = slot ? slot.gyro : null;

      if (!targetGyro) {
        gyroTargetBox.classList.add('hidden');
        gyroReadout.classList.remove('aligned');
        gyroText.textContent = `🧭 目前：俯仰 ${beta}° ｜ 水平 ${gamma}°（點此設為此組目標角度）`;
        return;
      }

      gyroTargetBox.classList.remove('hidden');

      const dBeta = angleDiff(beta, targetGyro.beta);
      const dGamma = gamma - targetGyro.gamma;
      const dHeading =
        heading !== null && targetGyro.heading !== null
          ? angleDiff(heading, targetGyro.heading)
          : null;

      const clamp = (v, max) => Math.max(-max, Math.min(max, v));
      const offsetX = clamp(dGamma * 2.2, 30);
      const offsetY = clamp(dBeta * 2.2, 30);
      gyroDot.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;

      const pitchRollAligned = Math.abs(dBeta) <= 2 && Math.abs(dGamma) <= 2;
      const headingAligned = dHeading === null || Math.abs(dHeading) <= 8;
      const isAligned = pitchRollAligned && headingAligned;

      gyroRing.classList.toggle('aligned', isAligned);
      gyroDeltaBadge.classList.toggle('aligned', isAligned);
      gyroReadout.classList.toggle('aligned', isAligned);

      const sign = (n) => (n > 0 ? `+${n}°` : `${n}°`);
      const headingDeltaStr = dHeading !== null ? ` ｜ 方位差 ${sign(dHeading)}` : '';

      if (isAligned) {
        gyroDeltaBadge.textContent = `✓ 第 #${selectedIndex + 1} 組角度已對齊`;
        gyroText.textContent = `✓ 與 #${selectedIndex + 1} 事前照角度一致（俯仰 ${beta}° ｜ 水平 ${gamma}°）`;
      } else {
        gyroDeltaBadge.textContent = `俯仰差 ${sign(dBeta)} ｜ 水平差 ${sign(dGamma)}${headingDeltaStr}`;
        gyroText.textContent = `#${selectedIndex + 1} 目標：俯仰 ${targetGyro.beta}° / 水平 ${targetGyro.gamma}°${
          targetGyro.heading !== null ? ` / 方位 ${targetGyro.heading}°` : ''
        }`;
      }
    }
  }

  // 新增一張「事前照」到清單（保持在模式 1 可連續拍）
  async function addBeforeSlot(dataUrl, recordedGyro = null) {
    const img = await loadImage(dataUrl);
    const newSlot = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      beforeDataUrl: dataUrl,
      afterDataUrl: null,
      gyro: recordedGyro ? { ...recordedGyro } : null,
      width: img.naturalWidth,
      height: img.naturalHeight
    };
    slots.push(newSlot);
    selectedIndex = slots.length - 1;
    await saveSlotsToDB();
    renderSlotStrip();
    updateUIForStep();
  }

  // 為目前選中的組別儲存「事後照」，並自動跳到下一張尚未拍事後照的組別
  async function setAfterForCurrentSlot(dataUrl) {
    const slot = getSelectedSlot();
    if (!slot) return;

    slot.afterDataUrl = dataUrl;
    await saveSlotsToDB();

    // 尋找下一組還沒拍事後照的索引
    const nextPendingIdx = slots.findIndex((s, idx) => idx > selectedIndex && !s.afterDataUrl);
    const anyPendingIdx = nextPendingIdx !== -1 ? nextPendingIdx : slots.findIndex((s) => !s.afterDataUrl);

    if (anyPendingIdx !== -1) {
      selectedIndex = anyPendingIdx;
      renderSlotStrip();
      updateUIForStep();
    } else {
      // 全部組別的事後照都拍完了，自動進入模式 3 檢視對比
      renderSlotStrip();
      step = 3;
      updateUIForStep();
    }
  }

  function applyOverlayOpacity(val) {
    const num = Number(val);
    opacityValue.textContent = `${num}%`;
    beforeOverlay.style.opacity = (num / 100).toFixed(2);
  }

  // 渲染上方多組縮圖清單列
  function renderSlotStrip() {
    const totalBefore = slots.length;
    const totalAfter = slots.filter((s) => Boolean(s.afterDataUrl)).length;
    countBeforeEl.textContent = String(totalBefore);
    countAfterEl.textContent = `${totalAfter}/${totalBefore}`;

    slotListEl.innerHTML = '';

    if (slots.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'slot-empty-hint';
      hint.textContent = '尚未拍攝事前照，請按下方白色快門連續拍攝所有位置';
      slotListEl.appendChild(hint);
      return;
    }

    slots.forEach((slot, idx) => {
      const item = document.createElement('div');
      item.className =
        'slot-item' +
        (idx === selectedIndex ? ' selected' : '') +
        (slot.afterDataUrl ? ' done' : '');

      const thumb = document.createElement('img');
      thumb.src = slot.beforeDataUrl;
      thumb.alt = `#${idx + 1}`;

      const numBadge = document.createElement('span');
      numBadge.className = 'slot-num';
      numBadge.textContent = `#${idx + 1}`;

      const statusBadge = document.createElement('span');
      statusBadge.className = 'slot-status';
      statusBadge.textContent = slot.afterDataUrl ? '✓完成' : slot.gyro ? '🧭待拍' : '待拍';

      const delBtn = document.createElement('button');
      delBtn.className = 'slot-del';
      delBtn.type = 'button';
      delBtn.textContent = '×';
      delBtn.title = '刪除此組';
      delBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        slots.splice(idx, 1);
        if (selectedIndex >= slots.length) {
          selectedIndex = slots.length - 1;
        }
        await saveSlotsToDB();
        if (slots.length === 0) {
          step = 1;
        }
        renderSlotStrip();
        updateUIForStep();
      });

      item.addEventListener('click', () => {
        selectedIndex = idx;
        renderSlotStrip();
        updateUIForStep();
      });

      item.appendChild(thumb);
      item.appendChild(numBadge);
      item.appendChild(statusBadge);
      item.appendChild(delBtn);
      slotListEl.appendChild(item);
    });
  }

  // 更新三個模式的畫面與疊圖
  function updateUIForStep() {
    tabStep1.classList.toggle('active', step === 1);
    tabStep2.classList.toggle('active', step === 2);
    tabStep3.classList.toggle('active', step === 3);

    if (step === 1) {
      cameraSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
      beforeOverlay.classList.add('hidden');
      overlayControls.classList.add('hidden');
      btnShutter.classList.remove('after-mode');
      fileBeforeInput.multiple = true;
      lblAlbumBtn.textContent = '📁 批次匯入';
      btnNextPhase.innerHTML = '<span>去拍事後照 →</span>';

      targetAspect = 3 / 4;
      viewfinder.style.aspectRatio = '3 / 4';
      modeBanner.textContent = `模式 1：連續拍事前照（目前已拍 ${slots.length} 張）`;
      if (!currentStream) startCamera();
    } else if (step === 2) {
      if (slots.length === 0) {
        step = 1;
        updateUIForStep();
        return;
      }
      if (selectedIndex < 0 || selectedIndex >= slots.length) {
        selectedIndex = 0;
      }

      const slot = getSelectedSlot();
      cameraSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
      overlayControls.classList.remove('hidden');
      btnShutter.classList.add('after-mode');
      fileBeforeInput.multiple = false;
      lblAlbumBtn.textContent = '📁 載入事後';
      btnNextPhase.innerHTML = '<span>看合成對比 →</span>';

      targetAspect = slot.width / slot.height;
      viewfinder.style.aspectRatio = `${slot.width} / ${slot.height}`;
      beforeOverlay.src = slot.beforeDataUrl;
      beforeOverlay.classList.remove('hidden');
      applyOverlayOpacity(opacitySlider.value);

      const statusStr = slot.afterDataUrl ? '（已完成，按快門可重拍）' : '（請對齊畫面與陀螺儀按快門）';
      modeBanner.textContent = `正在拍 #${selectedIndex + 1} 事後照 ${statusStr}`;
      if (!currentStream) startCamera();
    } else if (step === 3) {
      if (slots.length === 0) {
        step = 1;
        updateUIForStep();
        return;
      }
      if (selectedIndex < 0 || selectedIndex >= slots.length) {
        selectedIndex = 0;
      }
      cameraSection.classList.add('hidden');
      resultSection.classList.remove('hidden');
      stopCamera();
      renderComparison();
    }

    updateGyroHUD();
  }

  // 繪製標籤膠囊
  function drawLabel(ctx, text, x, y, height, isAfter) {
    const fontSize = Math.max(20, Math.round(height * 0.036));
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif`;
    const paddingX = Math.round(fontSize * 0.8);
    const paddingY = Math.round(fontSize * 0.45);
    const textMetrics = ctx.measureText(text);
    const boxW = textMetrics.width + paddingX * 2;
    const boxH = fontSize + paddingY * 2;
    const radius = Math.round(boxH / 2);

    ctx.save();
    ctx.fillStyle = isAfter ? 'rgba(37, 99, 235, 0.85)' : 'rgba(17, 24, 39, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, radius);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + paddingX, y + boxH / 2);
    ctx.restore();
  }

  // 產生單組合成圖片 DataURL
  async function buildCombinedDataUrl(slot, layout, showLabels) {
    const bImg = await loadImage(slot.beforeDataUrl);
    const aImg = await loadImage(slot.afterDataUrl);

    const w = bImg.naturalWidth;
    const h = bImg.naturalHeight;
    const gap = Math.max(8, Math.round(Math.min(w, h) * 0.012));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (layout === 'vertical') {
      canvas.width = w;
      canvas.height = h * 2 + gap;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(bImg, 0, 0, w, h);
      ctx.drawImage(aImg, 0, h + gap, w, h);

      if (showLabels) {
        const margin = Math.round(Math.min(w, h) * 0.03);
        drawLabel(ctx, '事前 Before', margin, margin, h, false);
        drawLabel(ctx, '事後 After', margin, h + gap + margin, h, true);
      }
    } else {
      // 預設左右並排
      canvas.width = w * 2 + gap;
      canvas.height = h;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(bImg, 0, 0, w, h);
      ctx.drawImage(aImg, w + gap, 0, w, h);

      if (showLabels) {
        const margin = Math.round(Math.min(w, h) * 0.03);
        drawLabel(ctx, '事前 Before', margin, margin, h, false);
        drawLabel(ctx, '事後 After', w + gap + margin, margin, h, true);
      }
    }

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  // 渲染目前選中組別的對比結果
  async function renderComparison() {
    const slot = getSelectedSlot();
    if (!slot) return;

    singleBeforeImg.src = slot.beforeDataUrl;

    if (!slot.afterDataUrl) {
      combinedPreviewBox.classList.remove('hidden');
      singlePreviewBox.classList.add('hidden');
      combinedResultImg.src = slot.beforeDataUrl;
      combinedDataUrl = '';
      resultStatusText.textContent = `第 #${selectedIndex + 1} 組尚未拍攝事後照，請點左下方「重拍此組事後」補拍`;
      btnShareCombined.disabled = true;
      return;
    }

    btnShareCombined.disabled = false;
    singleAfterImg.src = slot.afterDataUrl;
    resultStatusText.textContent = `目前檢視：第 #${selectedIndex + 1} 組對比照（點上方縮圖可切換組別）`;

    if (currentLayout === 'single') {
      combinedPreviewBox.classList.add('hidden');
      singlePreviewBox.classList.remove('hidden');
      btnShareCombined.classList.add('hidden');
      return;
    }

    combinedPreviewBox.classList.remove('hidden');
    singlePreviewBox.classList.add('hidden');
    btnShareCombined.classList.remove('hidden');

    combinedDataUrl = await buildCombinedDataUrl(slot, currentLayout, chkShowLabels.checked);
    combinedResultImg.src = combinedDataUrl;
  }

  async function dataUrlToFile(dataUrl, filename) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/jpeg' });
  }

  async function shareOrDownloadImage(dataUrl, filename) {
    try {
      const file = await dataUrlToFile(dataUrl, filename);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename
        });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // 一鍵批次分享所有已完成組別的對比照
  async function shareAllCompletedComparisons() {
    const completed = slots
      .map((s, idx) => ({ slot: s, num: idx + 1 }))
      .filter((item) => Boolean(item.slot.afterDataUrl));

    if (completed.length === 0) {
      alert('目前還沒有已完成事後照的組別');
      return;
    }

    const layoutForBatch = currentLayout === 'vertical' ? 'vertical' : 'horizontal';
    const files = [];

    for (const item of completed) {
      const url = await buildCombinedDataUrl(item.slot, layoutForBatch, chkShowLabels.checked);
      const file = await dataUrlToFile(url, `事前事後對比_第${item.num}組.jpg`);
      files.push(file);
    }

    try {
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          files,
          title: `事前事後對比照（共 ${files.length} 組）`
        });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }

    // 備援：逐張觸發下載
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // 事件綁定
  btnEnableGyro.addEventListener('click', () => {
    enableGyroscope();
  });

  // 若事前照從相簿匯入無陀螺儀角度，點一下讀數列可將目前角度設為此組目標角度
  gyroReadout.addEventListener('click', async () => {
    const slot = getSelectedSlot();
    if (step === 2 && slot && !slot.gyro && currentGyro) {
      slot.gyro = { ...currentGyro };
      await saveSlotsToDB();
      renderSlotStrip();
      updateGyroHUD();
    }
  });

  tabStep1.addEventListener('click', () => {
    step = 1;
    updateUIForStep();
  });

  tabStep2.addEventListener('click', () => {
    if (slots.length === 0) return;
    const firstPending = slots.findIndex((s) => !s.afterDataUrl);
    if (firstPending !== -1) selectedIndex = firstPending;
    step = 2;
    renderSlotStrip();
    updateUIForStep();
  });

  tabStep3.addEventListener('click', () => {
    if (slots.length === 0) return;
    step = 3;
    updateUIForStep();
  });

  btnNextPhase.addEventListener('click', () => {
    if (step === 1) {
      if (slots.length === 0) return;
      const firstPending = slots.findIndex((s) => !s.afterDataUrl);
      selectedIndex = firstPending !== -1 ? firstPending : 0;
      step = 2;
      renderSlotStrip();
      updateUIForStep();
    } else if (step === 2) {
      step = 3;
      updateUIForStep();
    }
  });

  btnToResult.addEventListener('click', () => {
    step = 3;
    updateUIForStep();
  });

  btnShutter.addEventListener('click', async () => {
    const frameDataUrl = captureVideoFrame(targetAspect);
    if (!frameDataUrl) return;

    if (step === 1) {
      await addBeforeSlot(frameDataUrl, currentGyro);
    } else if (step === 2) {
      await setAfterForCurrentSlot(frameDataUrl);
    }
  });

  // 相簿匯入：模式 1 可一次選多張事前照；模式 2 為目前選中組別匯入事後照
  fileBeforeInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const readFileAsDataUrl = (file) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
      });

    if (step === 1) {
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        await addBeforeSlot(dataUrl, null);
      }
    } else if (step === 2) {
      const dataUrl = await readFileAsDataUrl(files[0]);
      await setAfterForCurrentSlot(dataUrl);
    }

    fileBeforeInput.value = '';
  });

  btnSwitchCam.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    if (step !== 3) startCamera();
  });

  opacitySlider.addEventListener('input', (e) => {
    applyOverlayOpacity(e.target.value);
  });

  btnToggleGrid.addEventListener('click', () => {
    gridOverlay.classList.toggle('hidden');
    btnToggleGrid.classList.toggle('active');
  });

  const showFullBefore = () => { beforeOverlay.style.opacity = '1'; };
  const restoreBeforeOpacity = () => { applyOverlayOpacity(opacitySlider.value); };
  btnBlinkBefore.addEventListener('pointerdown', showFullBefore);
  btnBlinkBefore.addEventListener('pointerup', restoreBeforeOpacity);
  btnBlinkBefore.addEventListener('pointerleave', restoreBeforeOpacity);
  btnBlinkBefore.addEventListener('pointercancel', restoreBeforeOpacity);

  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      segButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayout = btn.dataset.layout;
      renderComparison();
    });
  });

  chkShowLabels.addEventListener('change', () => {
    renderComparison();
  });

  btnRetakeAfter.addEventListener('click', () => {
    step = 2;
    updateUIForStep();
  });

  btnReset.addEventListener('click', async () => {
    if (slots.length > 0 && !confirm('確定要清空目前所有已拍的事前／事後照嗎？')) {
      return;
    }
    slots = [];
    selectedIndex = -1;
    await saveSlotsToDB();
    step = 1;
    renderSlotStrip();
    updateUIForStep();
  });

  btnShareCombined.addEventListener('click', () => {
    if (!combinedDataUrl) return;
    shareOrDownloadImage(combinedDataUrl, `事前事後對比_第${selectedIndex + 1}組.jpg`);
  });

  btnShareAll.addEventListener('click', () => {
    shareAllCompletedComparisons();
  });

  btnSaveBefore.addEventListener('click', () => {
    const slot = getSelectedSlot();
    if (!slot) return;
    shareOrDownloadImage(slot.beforeDataUrl, `事前照_第${selectedIndex + 1}組.jpg`);
  });

  btnSaveAfter.addEventListener('click', () => {
    const slot = getSelectedSlot();
    if (!slot || !slot.afterDataUrl) return;
    shareOrDownloadImage(slot.afterDataUrl, `事後照_第${selectedIndex + 1}組.jpg`);
  });

  // 初始化：載入先前保存的多組拍攝進度
  async function init() {
    startCamera();
    slots = await loadSlotsFromDB();
    if (slots.length > 0) {
      const firstPending = slots.findIndex((s) => !s.afterDataUrl);
      selectedIndex = firstPending !== -1 ? firstPending : 0;
    }
    renderSlotStrip();
    updateUIForStep();
  }

  init();
})();
