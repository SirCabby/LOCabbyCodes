SHELL := cmd
.SHELLFLAGS := /c

VERSION := $(strip $(shell cmd /C type VERSION))
REV_VERSION := $(word 2,$(MAKECMDGOALS))
INSTALL_DIR := C:/Program Files (x86)/Steam/steamapps/common/Look Outside
STEAM_APP_ID := 3373660
PLUGIN_DIR := $(INSTALL_DIR)/js/plugins
DIST_DIR := dist
STAGE_DIR := $(DIST_DIR)/stage
PACKAGE_NAME := LOCabbyCodes.v$(VERSION).zip
PACKAGE_PATH := $(DIST_DIR)/$(PACKAGE_NAME)
POWERSHELL := powershell -NoProfile -Command

.PHONY: help ensure-version check-install deploy rev package ensure-dist clean-dist run stop-game

help:
	@echo "CabbyCodes automation"
	@echo "  make deploy           Deploy CabbyCodes to the Look Outside install."
	@echo "  make package          Build dist/$(PACKAGE_NAME) zip for distribution."
	@echo "  make rev X.Y.Z        Bump VERSION, runtime constant, and README."
	@echo "  make run              Deploy, stop the game, launch via Steam."

ensure-version:
	@$(POWERSHELL) "if (-not (Test-Path -LiteralPath 'VERSION')) { Write-Error 'VERSION file missing. Run make from repo root.'; exit 1 }"

check-install:
	@$(POWERSHELL) "if (-not (Test-Path -LiteralPath '$(INSTALL_DIR)')) { Write-Error 'INSTALL_DIR not found: $(INSTALL_DIR)'; exit 1 }"
	@$(POWERSHELL) "if (-not (Test-Path -LiteralPath '$(PLUGIN_DIR)')) { Write-Error 'Plugin directory not found: $(PLUGIN_DIR)'; exit 1 }"

deploy: ensure-version check-install
	@$(POWERSHELL) "& { \
		$$ErrorActionPreference = 'Stop'; \
		$$sourceRoot   = Convert-Path '.'; \
		$$destPlugins  = '$(PLUGIN_DIR)'; \
		$$sourceLoader = Join-Path $$sourceRoot 'CabbyCodes.js'; \
		$$destLoader   = Join-Path $$destPlugins 'CabbyCodes.js'; \
		$$sourceFolder = Join-Path $$sourceRoot 'CabbyCodes'; \
		$$destFolder   = Join-Path $$destPlugins 'CabbyCodes'; \
		Write-Host 'Deploying CabbyCodes v$(VERSION) to $(PLUGIN_DIR)'; \
		Remove-Item -LiteralPath $$destLoader -Force -ErrorAction SilentlyContinue; \
		Remove-Item -LiteralPath $$destFolder -Force -Recurse -ErrorAction SilentlyContinue; \
		if ((Test-Path -LiteralPath $$destLoader) -or (Test-Path -LiteralPath $$destFolder)) { \
			Write-Error 'Failed to delete existing CabbyCodes files.'; exit 1 \
		}; \
		New-Item -ItemType Directory -Path $$destFolder -Force | Out-Null; \
		Copy-Item -LiteralPath $$sourceLoader -Destination $$destLoader -Force; \
		Copy-Item -Path (Join-Path $$sourceFolder '*') -Destination $$destFolder -Recurse -Force; \
		if (-not (Test-Path -LiteralPath $$destLoader)) { \
			Write-Error 'Deploy failed: CabbyCodes.js missing after copy.'; exit 1 \
		}; \
		if (-not (Test-Path -LiteralPath (Join-Path $$destFolder 'cabbycodes-core.js'))) { \
			Write-Error 'Deploy failed: CabbyCodes folder incomplete.'; exit 1 \
		}; \
		$$files = New-Object System.Collections.Generic.List[object]; \
		$$files.Add([pscustomobject]@{ Source = $$sourceLoader; Dest = $$destLoader }) | Out-Null; \
		Get-ChildItem -Path $$sourceFolder -File -Recurse | ForEach-Object { \
			$$destPath = $$_.FullName.Replace($$sourceFolder, $$destFolder); \
			$$files.Add([pscustomobject]@{ Source = $$_.FullName; Dest = $$destPath }) | Out-Null \
		}; \
		foreach ($$file in $$files) { \
			if (-not (Test-Path -LiteralPath $$file.Dest)) { \
				Write-Error \"Deploy failed: missing $$($$file.Dest)\"; exit 1 \
			}; \
			$$srcHash = (Get-FileHash -LiteralPath $$file.Source -Algorithm SHA256).Hash; \
			$$dstHash = (Get-FileHash -LiteralPath $$file.Dest -Algorithm SHA256).Hash; \
			if ($$srcHash -ne $$dstHash) { \
				Write-Error \"Deploy failed: hash mismatch for $$($$file.Dest)\"; exit 1 \
			}; \
			$$(Get-Item -LiteralPath $$file.Dest).LastWriteTime = Get-Date; \
		}; \
		Write-Host 'Deploy complete.' \
	}"

rev: ensure-version
	@$(POWERSHELL) "if (-not '$(REV_VERSION)') { Write-Error 'Usage: make rev X.Y.Z'; exit 1 }"
	@$(POWERSHELL) "if (-not ('$(REV_VERSION)' -match '^[0-9]+\.[0-9]+\.[0-9]+$$')) { Write-Error 'Invalid version: $(REV_VERSION). Use semantic format X.Y.Z'; exit 1 }"
	@$(POWERSHELL) "Set-Content -LiteralPath 'VERSION' -Value '$(REV_VERSION)'"
	@node scripts/update-version.js "$(REV_VERSION)"
	@$(POWERSHELL) "Write-Host 'Version bumped to $(REV_VERSION).'"

ensure-dist:
	@$(POWERSHELL) "New-Item -ItemType Directory -Path '$(DIST_DIR)' -Force | Out-Null"

clean-dist:
	@$(POWERSHELL) "if (Test-Path -LiteralPath '$(DIST_DIR)') { Remove-Item -LiteralPath '$(DIST_DIR)' -Recurse -Force }"

package: ensure-version ensure-dist
	@$(POWERSHELL) "& { \
		if (Test-Path -LiteralPath '$(STAGE_DIR)') { Remove-Item -LiteralPath '$(STAGE_DIR)' -Recurse -Force }; \
		New-Item -ItemType Directory -Path '$(STAGE_DIR)' -Force | Out-Null; \
		Copy-Item -LiteralPath 'CabbyCodes.js' -Destination '$(STAGE_DIR)/CabbyCodes.js' -Force; \
		Copy-Item -Path 'CabbyCodes' -Destination '$(STAGE_DIR)' -Recurse -Force; \
		Copy-Item -LiteralPath 'README.md','LICENSE' -Destination '$(STAGE_DIR)' -Force; \
		if (Test-Path -LiteralPath '$(PACKAGE_PATH)') { Remove-Item -LiteralPath '$(PACKAGE_PATH)' -Force }; \
		Compress-Archive -Path '$(STAGE_DIR)/*' -DestinationPath '$(PACKAGE_PATH)' -Force; \
		Remove-Item -LiteralPath '$(STAGE_DIR)' -Recurse -Force; \
		Write-Host 'Package created at $(PACKAGE_PATH)' \
	}"

stop-game:
	@$(POWERSHELL) "& { \
		Write-Host 'Stopping Look Outside if running...'; \
		$$names = @('Look Outside.exe','LookOutside.exe'); \
		foreach ($$name in $$names) { \
			cmd /c \"taskkill /F /IM \"\"$${name}\"\" >nul 2>&1\" | Out-Null \
		} \
	}"

run: deploy stop-game
	@$(POWERSHELL) "& { \
		$$steam = '$(STEAM_APP_ID)'; \
		if (-not [string]::IsNullOrWhiteSpace($$steam)) { \
			Write-Host \"Launching Look Outside via Steam (app $$steam)...\"; \
			Start-Process -FilePath 'steam://rungameid/$(STEAM_APP_ID)'; \
		} else { \
			Write-Host 'Launching Look Outside via executable fallback...'; \
			Start-Process -FilePath '$(GAME_PATH)' \
		} \
	}"

%:
	@rem

