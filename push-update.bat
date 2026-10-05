@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  UNLABLED RP BOT - Manual Push/Update
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git not found.
  pause
  exit /b 1
)

echo Current status:
git status -sb
echo.

set /p MSG=Commit message (empty = push only, no new commit): 
if not "%MSG%"=="" (
  git add -A
  git diff --cached --quiet
  if errorlevel 1 (
    git commit -m "%MSG%"
    if errorlevel 1 (
      echo ERROR: commit failed.
      pause
      exit /b 1
    )
  ) else (
    echo No file changes to commit.
  )
) else (
  echo Skipping commit.
)

echo.
echo Pushing to GitHub (origin main)...
git push origin main
if errorlevel 1 (
  echo ERROR: push failed.
  pause
  exit /b 1
)
echo Push OK.
echo.

where railway >nul 2>&1
if errorlevel 1 (
  echo railway CLI not found. Push is done - deploy from Railway dashboard if needed.
  pause
  exit /b 0
)

echo Waiting ~45s for GitHub Actions to build/push the Docker image...
timeout /t 45 /nobreak
echo.

echo Redeploying Railway...
railway redeploy --yes --from-source
if errorlevel 1 (
  echo ERROR: railway redeploy failed.
  echo If the image was still building, wait 30s and run: railway redeploy --yes --from-source
  pause
  exit /b 1
)

echo.
echo Recent logs:
railway logs --lines 12 --latest
echo.
echo ========================================
echo  Done. Bot should be updated.
echo ========================================
pause
endlocal
