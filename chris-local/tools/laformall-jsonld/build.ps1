# 라포르몰 JSON-LD 생성기 빌드 스크립트
# 실행: powershell -ExecutionPolicy Bypass -File build.ps1
# 결과: 이 폴더의 dist\laformall-jsonld.exe (저장소 안에서 관리한다)
#
# exe 하나로 끝나야 한다. 담당자 PC 에는 파이썬이 없다고 가정한다.
# 구글 자동 테스트는 설치된 Edge(없으면 Chrome)를 DevTools 프로토콜로 제어하고,
# 내장 창은 pywebview 를 동봉해 쓴다. playwright 는 쓰지 않는다(Node 드라이버 때문에
# exe 가 280MB 가 되어 GitHub 파일 한 개 상한 100MB 를 넘긴다).

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "[1/4] 파이썬 확인"
python --version

Write-Host "[2/4] 의존 패키지 설치 (playwright 는 브라우저를 내려받지 않고 설치된 Edge 를 쓴다)"
python -m pip install --user --disable-pip-version-check -r requirements.txt

Write-Host "[3/4] PyInstaller 빌드"
Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue
$args = @(
  "--onefile", "--windowed", "--name", "laformall-jsonld",
  "--hidden-import", "bs4", "--hidden-import", "requests",
  "--hidden-import", "websocket", "--collect-submodules", "bs4",
  "--hidden-import", "openpyxl", "--collect-submodules", "openpyxl",
  "--hidden-import", "PIL", "--hidden-import", "PIL.Image", "--hidden-import", "PIL.ImageTk",
  "--hidden-import", "webview", "--hidden-import", "webview.platforms.winforms",
  "--hidden-import", "webview.platforms.edgechromium", "--collect-data", "webview",
  "--hidden-import", "clr", "--collect-all", "clr_loader", "--collect-all", "pythonnet",
  "--exclude-module", "playwright",
  "--exclude-module", "PyQt5", "--exclude-module", "PyQt6", "--exclude-module", "PySide2",
  "--exclude-module", "PySide6", "--exclude-module", "qtpy", "--exclude-module", "gi",
  "--exclude-module", "cefpython3", "--exclude-module", "webview.platforms.qt",
  "--exclude-module", "webview.platforms.gtk", "--exclude-module", "webview.platforms.android",
  "--exclude-module", "webview.platforms.cocoa",
  "--exclude-module", "numpy", "--exclude-module", "pandas",
  "--exclude-module", "matplotlib", "--exclude-module", "scipy", "--exclude-module", "lxml",
  "--exclude-module", "IPython", "--exclude-module", "pytest"
)
python -m PyInstaller @args app.py

$exe = Join-Path $here "dist\laformall-jsonld.exe"
if (-not (Test-Path $exe)) { throw "빌드 결과가 없습니다: $exe" }

Write-Host "[4/4] 결과 확인"
$info = Get-Item $exe
Write-Host ("완료: {0} ({1:N1} MB)" -f $info.FullName, ($info.Length / 1MB))
Write-Host '자기검사: Start-Process ".\dist\laformall-jsonld.exe" -ArgumentList "--selftest","--out","$env:TEMP\lj-selftest" -Wait'
