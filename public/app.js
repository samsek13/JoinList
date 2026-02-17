const form = document.getElementById("mix-form");
const statusText = document.getElementById("status-text");
const progressText = document.getElementById("progress-text");
const resultLink = document.getElementById("result-link");
const distribution = document.getElementById("distribution");
const errorText = document.getElementById("error-text");
const qrButton = document.getElementById("qr-button");
const qrImage = document.getElementById("qr-image");
const qrStatus = document.getElementById("qr-status");

let qrTimer = null;
let qrKey = "";

const setStatus = (text) => {
  statusText.textContent = text;
};

const setProgress = (progress) => {
  progressText.textContent = progress ? `进度：${progress}%` : "";
};

const renderDistribution = (items) => {
  distribution.innerHTML = "";
  if (!items || !items.length) {
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    const minutes = (item.contributedTime / 60).toFixed(1);
    row.textContent = `${item.sourceName}：${minutes} 分钟，${item.songCount} 首`;
    distribution.appendChild(row);
  });
};

const pollTask = async (taskId) => {
  const response = await fetch(`/api/task/${taskId}`);
  if (!response.ok) {
    setStatus("任务查询失败");
    return;
  }
  const data = await response.json();
  setStatus(data.status);
  setProgress(data.progress);
  renderDistribution(data.distribution);
  if (data.errorMessage) {
    errorText.textContent = data.errorMessage;
  }
  if (data.resultUrl) {
    resultLink.innerHTML = `<a href="${data.resultUrl}" target="_blank">打开新歌单</a>`;
  }
  if (data.status === "Completed" || data.status === "Failed") {
    return;
  }
  setTimeout(() => pollTask(taskId), 2000);
};

const setQrStatus = (text) => {
  qrStatus.textContent = text;
};

const stopQrTimer = () => {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
};

const startQrPolling = () => {
  stopQrTimer();
  qrTimer = setInterval(async () => {
    if (!qrKey) {
      stopQrTimer();
      return;
    }
    const response = await fetch(
      `/api/netease/qr/check?key=${encodeURIComponent(qrKey)}`
    );
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.code === 803 && data.cookie) {
      document.getElementById("cookie").value = data.cookie;
      setQrStatus("登录成功，Cookie 已自动填入");
      stopQrTimer();
      return;
    }
    if (data.code === 800) {
      setQrStatus("二维码已过期，请重新生成");
      stopQrTimer();
      return;
    }
    if (data.code === 802) {
      setQrStatus("已扫码，请在手机确认登录");
      return;
    }
    if (data.code === 801) {
      setQrStatus("等待扫码");
      return;
    }
    setQrStatus("等待扫码");
  }, 2000);
};

qrButton.addEventListener("click", async () => {
  setQrStatus("正在生成二维码...");
  const response = await fetch("/api/netease/qr");
  if (!response.ok) {
    setQrStatus("二维码生成失败");
    return;
  }
  const data = await response.json();
  qrKey = data.key || "";
  if (data.qrimg) {
    qrImage.src = data.qrimg;
    qrImage.style.display = "block";
  }
  setQrStatus("请使用网易云 App 扫码");
  startQrPolling();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultLink.innerHTML = "";
  distribution.innerHTML = "";
  errorText.textContent = "";
  setStatus("提交中");
  const cookie = document.getElementById("cookie").value.trim();
  const sources = document
    .getElementById("sources")
    .value.split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const weightLines = document
    .getElementById("weights")
    .value.split(/\n/)
    .map((item) => item.trim());
  const weights = sources.map((_, index) => {
    const raw = weightLines[index] ?? "";
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
  const hasWeights = weights.some((value) => value !== null);
  const minutes = Number(document.getElementById("duration").value || 0);
  const maxTotalDuration = Math.floor(minutes * 60);

  const payload = {
    cookie,
    sourceUrls: sources,
    maxTotalDuration
  };
  if (hasWeights) {
    payload.weights = weights;
  }

  const response = await fetch("/api/mix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    setStatus("提交失败");
    const data = await response.json().catch(() => null);
    if (data?.error === "weights_invalid") {
      errorText.textContent = "混合百分比无效，请检查总和是否为 100 或留空行";
      return;
    }
    if (data?.error === "sourceUrls_invalid") {
      errorText.textContent = "歌单链接无效或存在重复";
      return;
    }
    return;
  }

  const data = await response.json();
  setStatus("任务已创建");
  pollTask(data.taskId);
});
