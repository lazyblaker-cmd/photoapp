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

  const badgeStep1 = document.getElementById('badge-step-1');
  const badgeStep2 = document.getElementById('badge-step-2');
  const badgeStep3 = document.getElementById('badge-step-3');

  const btnReset = document.getElementById('btn-reset');
  const btnShutter = document.getElementById('btn-shutter');
  const btnSwitchCam = document.getElementById('btn-switch-cam');
  const fileBeforeInput = document.getElementById('file-before-input');
  const btnChangeBefore = document.getElementById('btn-change-before');
  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  const btnBlinkBefore = document.getElementById('btn-blink-before');

  const cameraSection = document.getElementById('camera-section');
  const resultSection = document.getElementById('result-section');
  const segButtons = document.querySelectorAll('.seg-btn');
  const chkShowLabels = document.getElementById('chk-show-labels');

  const combinedPreviewBox = document.getElementById('combined-preview-box');
  const combinedResultImg = document.getElementById('combined-result-img');
  const singlePreviewBox = document.getElementById('single-preview-box');
  const singleBeforeImg = document.getElementById('single-before-img');
  const singleAfterImg = document.getElementById('single-after-img');

  const btnSaveBefore = document.getElementById('btn-save-before');
  const btnSaveAfter = document.getElementById('btn-save-after');
  const btnRetakeAfter = document.getElementById('btn-retake-after');
  const btnShareCombined = document.getElementById('btn-share-combined');

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
  let facingMode = 'environment'; // 預設使用後鏡頭
  let step = 1; // 1: 拍事前照, 2: 對齊拍事後照, 3: 預覽與合成
  let beforeImage = null; // HTMLImageElement
  let afterImage = null;  // HTMLImageElement
  let targetAspect = 3 / 4; // 觀景窗與拍攝裁切比例 (width / height)
  let currentLayout = 'horizontal'; // 'horizontal' | 'vertical' | 'single'
  let combinedDataUrl = '';
  let filePickTarget = 'auto'; // 'auto' | 'before'

  // 陀螺儀狀態
  let gyroEnabled = false;
  let currentGyro = null; // { beta, gamma, heading }
  let beforeGyro = null;  // 拍事前照時記錄的 { beta, gamma, heading }
  const STORAGE_KEY = 'photoapp_before_session_v1';

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
      modeBanner.textContent = '無法開啟相機，請確認已允許相機權限或改由相簿載入';
    }
  }

  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }
  }

  // 將 DataURL 轉為 HTMLImageElement
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // 依照觀景窗比例 (object-fit: cover) 擷取目前相機畫面，確保與疊圖 100% 對齊
  function captureVideoFrame(aspect) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const videoAspect = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;

    if (videoAspect > aspect) {
      // 影片較寬，左右置中裁切
      sw = Math.round(vh * aspect);
      sx = Math.round((vw - sw) / 2);
    } else if (videoAspect < aspect) {
      // 影片較高，上下置中裁切
      sh = Math.round(vw / aspect);
      sy = Math.round((vh - sh) / 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  // 角度最短差值 (-180 ~ 180)
  function angleDiff(current, target) {
    return ((current - target + 540) % 360) - 180;
  }

  // 啟用 iPhone / 行動裝置陀螺儀權限
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
      console.error('陀螺儀啟用失敗:', err);
      btnEnableGyro.textContent = '⚠️ 無法讀取陀螺儀（需使用 HTTPS 網址）';
    }
  }

  function handleOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    const beta = Math.round(e.beta || 0);   // 前後俯仰 (-180 ~ 180)
    const gamma = Math.round(e.gamma || 0); // 左右傾斜 (-90 ~ 90)
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') {
      heading = Math.round(e.webkitCompassHeading);
    } else if (typeof e.alpha === 'number') {
      heading = Math.round((360 - e.alpha) % 360);
    }
    currentGyro = { beta, gamma, heading };
    updateGyroHUD();
  }

  // 更新陀螺儀數值與步驟 2 對準準星
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
      if (!beforeGyro) {
        // 相簿載入的事前照（無當時陀螺儀紀錄），提供水平儀與點一下鎖定目前角度功能
        gyroTargetBox.classList.add('hidden');
        gyroReadout.classList.remove('aligned');
        gyroText.textContent = `🧭 目前：俯仰 ${beta}° ｜ 水平 ${gamma}°（點此設為目標角度）`;
        return;
      }

      gyroTargetBox.classList.remove('hidden');

      const dBeta = angleDiff(beta, beforeGyro.beta);
      const dGamma = gamma - beforeGyro.gamma;
      const dHeading =
        heading !== null && beforeGyro.heading !== null
          ? angleDiff(heading, beforeGyro.heading)
          : null;

      // 將角度誤差對應到準星圓點偏移 (最大偏移 ±30px)
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
        gyroDeltaBadge.textContent = '✓ 拍攝角度已對齊';
        gyroText.textContent = `✓ 與事前照角度一致（俯仰 ${beta}° ｜ 水平 ${gamma}°）`;
      } else {
        gyroDeltaBadge.textContent = `俯仰差 ${sign(dBeta)} ｜ 水平差 ${sign(dGamma)}${headingDeltaStr}`;
        gyroText.textContent = `目標：俯仰 ${beforeGyro.beta}° / 水平 ${beforeGyro.gamma}°${
          beforeGyro.heading !== null ? ` / 方位 ${beforeGyro.heading}°` : ''
        }`;
      }
    }
  }

  // 儲存事前照與陀螺儀角度到本機，避免關掉網頁後遺忘
  function saveBeforeSession(dataUrl, gyroData) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dataUrl,
          gyro: gyroData || null,
          savedAt: Date.now()
        })
      );
    } catch (e) {
      // 忽略空間不足錯誤
    }
  }

  function clearBeforeSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // 設定「事前照」並進入步驟 2
  async function setBeforePhoto(dataUrl, recordedGyro = null, persist = true) {
    beforeImage = await loadImage(dataUrl);
    beforeGyro = recordedGyro ? { ...recordedGyro } : null;
    if (persist) {
      saveBeforeSession(dataUrl, beforeGyro);
    }

    targetAspect = beforeImage.naturalWidth / beforeImage.naturalHeight;
    viewfinder.style.aspectRatio = `${beforeImage.naturalWidth} / ${beforeImage.naturalHeight}`;

    beforeOverlay.src = dataUrl;
    beforeOverlay.classList.remove('hidden');
    applyOverlayOpacity(opacitySlider.value);

    step = 2;
    updateUIForStep();
    updateGyroHUD();
  }

  // 設定「事後照」並進入步驟 3
  async function setAfterPhoto(dataUrl) {
    afterImage = await loadImage(dataUrl);
    step = 3;
    updateUIForStep();
    await renderComparison();
  }

  function applyOverlayOpacity(val) {
    const num = Number(val);
    opacityValue.textContent = `${num}%`;
    beforeOverlay.style.opacity = (num / 100).toFixed(2);
  }

  // 更新步驟 UI
  function updateUIForStep() {
    badgeStep1.className = 'step-badge' + (step === 1 ? ' active' : ' done');
    badgeStep2.className = 'step-badge' + (step === 2 ? ' active' : step > 2 ? ' done' : '');
    badgeStep3.className = 'step-badge' + (step === 3 ? ' active' : '');

    if (step === 1) {
      cameraSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
      beforeOverlay.classList.add('hidden');
      overlayControls.classList.add('hidden');
      btnShutter.classList.remove('after-mode');
      targetAspect = 3 / 4;
      viewfinder.style.aspectRatio = '3 / 4';
      modeBanner.textContent = '步驟 1：請拍攝或從相簿選擇「事前照」';
      if (!currentStream) startCamera();
    } else if (step === 2) {
      cameraSection.classList.remove('hidden');
      resultSection.classList.add('hidden');
      beforeOverlay.classList.remove('hidden');
      overlayControls.classList.remove('hidden');
      btnShutter.classList.add('after-mode');
      modeBanner.textContent = '步驟 2：對齊畫面中的事前照，按下藍色快門拍「事後照」';
      if (!currentStream) startCamera();
    } else if (step === 3) {
      cameraSection.classList.add('hidden');
      resultSection.classList.remove('hidden');
      stopCamera();
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

  // 合成事前與事後對比照
  async function renderComparison() {
    if (!beforeImage || !afterImage) return;

    singleBeforeImg.src = beforeImage.src;
    singleAfterImg.src = afterImage.src;

    if (currentLayout === 'single') {
      combinedPreviewBox.classList.add('hidden');
      singlePreviewBox.classList.remove('hidden');
      btnShareCombined.classList.add('hidden');
      return;
    }

    combinedPreviewBox.classList.remove('hidden');
    singlePreviewBox.classList.add('hidden');
    btnShareCombined.classList.remove('hidden');

    // 以事前照尺寸為基準，將事後照等比縮放對齊
    const w = beforeImage.naturalWidth;
    const h = beforeImage.naturalHeight;
    const gap = Math.max(8, Math.round(Math.min(w, h) * 0.012));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (currentLayout === 'horizontal') {
      canvas.width = w * 2 + gap;
      canvas.height = h;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(beforeImage, 0, 0, w, h);
      ctx.drawImage(afterImage, w + gap, 0, w, h);

      if (chkShowLabels.checked) {
        const margin = Math.round(Math.min(w, h) * 0.03);
        drawLabel(ctx, '事前 Before', margin, margin, h, false);
        drawLabel(ctx, '事後 After', w + gap + margin, margin, h, true);
      }
    } else {
      // 上下並排
      canvas.width = w;
      canvas.height = h * 2 + gap;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(beforeImage, 0, 0, w, h);
      ctx.drawImage(afterImage, 0, h + gap, w, h);

      if (chkShowLabels.checked) {
        const margin = Math.round(Math.min(w, h) * 0.03);
        drawLabel(ctx, '事前 Before', margin, margin, h, false);
        drawLabel(ctx, '事後 After', margin, h + gap + margin, h, true);
      }
    }

    combinedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    combinedResultImg.src = combinedDataUrl;
  }

  // 分享或下載圖片（支援 iPhone Safari 原生分享選單「儲存影像」）
  async function shareOrDownloadImage(dataUrl, filename) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'image/jpeg' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: '事前事後對比照'
        });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }

    // 備援下載
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // 事件綁定
  btnEnableGyro.addEventListener('click', () => {
    enableGyroscope();
  });

  // 若事前照從相簿載入沒有當時角度，點一下讀數列可將目前角度設為目標角度
  gyroReadout.addEventListener('click', () => {
    if (step === 2 && !beforeGyro && currentGyro && beforeImage) {
      beforeGyro = { ...currentGyro };
      saveBeforeSession(beforeImage.src, beforeGyro);
      updateGyroHUD();
    }
  });

  btnShutter.addEventListener('click', async () => {
    const frameDataUrl = captureVideoFrame(targetAspect);
    if (!frameDataUrl) return;

    if (step === 1) {
      await setBeforePhoto(frameDataUrl, currentGyro);
    } else if (step === 2) {
      await setAfterPhoto(frameDataUrl);
    }
  });

  // 從相簿載入（步驟 1 或點「重選事前照」載入為事前照；步驟 2 點左下「相簿載入」可載入事後照）
  fileBeforeInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const target = filePickTarget;
    filePickTarget = 'auto';
    const reader = new FileReader();
    reader.onload = async (ev) => {
      if (target === 'before' || step === 1) {
        await setBeforePhoto(ev.target.result);
      } else {
        await setAfterPhoto(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
    fileBeforeInput.value = '';
  });

  btnChangeBefore.addEventListener('click', () => {
    filePickTarget = 'before';
    fileBeforeInput.click();
  });

  btnSwitchCam.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  opacitySlider.addEventListener('input', (e) => {
    applyOverlayOpacity(e.target.value);
  });

  btnToggleGrid.addEventListener('click', () => {
    gridOverlay.classList.toggle('hidden');
    btnToggleGrid.classList.toggle('active');
  });

  // 按住只看事前照，放開恢復設定透明度
  const showFullBefore = () => { beforeOverlay.style.opacity = '1'; };
  const restoreBeforeOpacity = () => { applyOverlayOpacity(opacitySlider.value); };
  btnBlinkBefore.addEventListener('pointerdown', showFullBefore);
  btnBlinkBefore.addEventListener('pointerup', restoreBeforeOpacity);
  btnBlinkBefore.addEventListener('pointerleave', restoreBeforeOpacity);
  btnBlinkBefore.addEventListener('pointercancel', restoreBeforeOpacity);

  // 切換合成版面
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
    afterImage = null;
    step = 2;
    updateUIForStep();
  });

  btnReset.addEventListener('click', () => {
    beforeImage = null;
    afterImage = null;
    beforeGyro = null;
    clearBeforeSession();
    step = 1;
    updateUIForStep();
  });

  btnShareCombined.addEventListener('click', () => {
    if (!combinedDataUrl) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    shareOrDownloadImage(combinedDataUrl, `事前事後對比_${stamp}.jpg`);
  });

  btnSaveBefore.addEventListener('click', () => {
    if (!beforeImage) return;
    shareOrDownloadImage(beforeImage.src, '事前照_before.jpg');
  });

  btnSaveAfter.addEventListener('click', () => {
    if (!afterImage) return;
    shareOrDownloadImage(afterImage.src, '事後照_after.jpg');
  });

  // 自動還原上次尚未拍完事後照的「事前照 + 陀螺儀角度」
  async function restoreBeforeSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.dataUrl) {
        await setBeforePhoto(parsed.dataUrl, parsed.gyro || null, false);
      }
    } catch (e) {}
  }

  // 初始化
  startCamera();
  restoreBeforeSession();
})();
