// 배포 안내 페이지의 첫 프레임 테마.
// 게이트웨이 UI 와 같은 오리진이라 같은 localStorage 를 읽는다. 값 해석은
// ui/index.html 의 시작 스크립트, ui/src/app/theme-boot.ts 와 같게 유지한다.
// 여기서는 팔레트 계열은 쓰지 않고 밝기(light/dark)만 정한다.
(function () {
  var MODES = { system: 1, light: 1, dark: 1 };
  var mode = "system";
  try {
    var keys = Object.keys(localStorage);
    var raw;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("openclaw.control.settings.v1") === 0) {
        raw = localStorage.getItem(keys[i]);
        if (raw) break;
      }
    }
    var stored = raw ? JSON.parse(raw) : null;
    var m = stored && stored.themeMode;
    if (typeof m === "string" && MODES[m]) mode = m;
  } catch (e) {
    // 저장소를 못 읽으면 시스템 설정을 따른다.
  }
  if (mode === "system") {
    mode =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  }
  document.documentElement.setAttribute("data-theme-mode", mode);
  document.documentElement.style.colorScheme = mode;
})();
