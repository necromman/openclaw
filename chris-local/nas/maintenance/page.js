const status = document.getElementById("status");
const retry = document.getElementById("retry");
const startedAt = Date.now();
let checking = false;
let timer;

async function checkReady() {
  if (checking) return;
  clearTimeout(timer);
  checking = true;
  retry.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/__system-update/status?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.ok && (await response.json()).ready === true) {
      status.textContent = "반영이 완료되었습니다. 이전 화면으로 이동합니다.";
      location.reload();
      return;
    }
    status.textContent =
      Date.now() - startedAt > 120000
        ? "반영에 시간이 조금 더 필요합니다. 자동으로 계속 확인합니다. 오래 지속되면 관리자에게 문의해 주세요."
        : "변경 사항을 반영하고 있습니다. 잠시만 기다려 주세요.";
  } catch {
    status.textContent = navigator.onLine
      ? "아직 연결을 준비하고 있습니다. 잠시 후 자동으로 다시 확인합니다."
      : "인터넷 연결이 끊겼습니다. 연결되면 자동으로 다시 확인합니다.";
  } finally {
    clearTimeout(timeout);
    checking = false;
    retry.disabled = false;
  }
  timer = setTimeout(checkReady, 5000);
}

retry.addEventListener("click", checkReady);
window.addEventListener("online", checkReady);
void checkReady();
