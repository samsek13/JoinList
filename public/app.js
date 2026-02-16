const form = document.getElementById("mix-form");
const statusText = document.getElementById("status-text");
const progressText = document.getElementById("progress-text");
const resultLink = document.getElementById("result-link");
const distribution = document.getElementById("distribution");
const errorText = document.getElementById("error-text");

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
    row.textContent = `${item.sourceName}：${Math.floor(
      item.contributedTime / 60
    )} 分钟，${item.songCount} 首`;
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
  const minutes = Number(document.getElementById("duration").value || 0);
  const maxTotalDuration = Math.floor(minutes * 60);

  const response = await fetch("/api/mix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      cookie,
      sourceUrls: sources,
      maxTotalDuration
    })
  });

  if (!response.ok) {
    setStatus("提交失败");
    return;
  }

  const data = await response.json();
  setStatus("任务已创建");
  pollTask(data.taskId);
});
