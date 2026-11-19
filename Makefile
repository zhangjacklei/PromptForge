APP_NAME  := PromptForge
BUILD_DIR := build
APP       := $(BUILD_DIR)/$(APP_NAME).app
SDK       := $(shell xcrun --show-sdk-path)
ARCH      := $(shell uname -m)
TARGET    := $(ARCH)-apple-macos13.0
SOURCES   := $(wildcard Sources/PromptForge/*.swift)
WEB       := Sources/PromptForge/Resources/web/index.html

.PHONY: all app dmg web binary icon run clean

all: app

## 重新打包内置单文件页面（会先跑 make_demo_library.py 才有 data/library.js）
web:
	python3 tools/build_web.py

binary: $(SOURCES) $(WEB)
	@mkdir -p $(BUILD_DIR)
	swiftc -O -parse-as-library -target $(TARGET) -sdk "$(SDK)" $(SOURCES) -o $(BUILD_DIR)/$(APP_NAME)
	@echo "已生成 $(BUILD_DIR)/$(APP_NAME)"

icon:
	python3 tools/make_icon.py

app: binary icon
	@rm -rf $(APP)
	@mkdir -p $(APP)/Contents/MacOS $(APP)/Contents/Resources
	@cp $(BUILD_DIR)/$(APP_NAME) $(APP)/Contents/MacOS/$(APP_NAME)
	@cp Resources/Info-macOS.plist $(APP)/Contents/Info.plist
	@rm -rf $(APP)/Contents/Resources/web
	@cp -R Sources/PromptForge/Resources/web $(APP)/Contents/Resources/web
	@cp Resources/AppIcon.icns $(APP)/Contents/Resources/AppIcon.icns
	@printf 'APPL????' > $(APP)/Contents/PkgInfo
	@codesign --force --sign - $(APP) >/dev/null 2>&1 || echo "（ad-hoc 签名失败，可忽略；首次打开右键 → 打开）"
	@echo "已生成 $(APP)"

## 分发用 DMG（内含 App + Applications 快捷方式 + 安装说明）
dmg: app
	@rm -rf $(BUILD_DIR)/dmgroot
	@mkdir -p $(BUILD_DIR)/dmgroot
	@cp -R $(APP) $(BUILD_DIR)/dmgroot/
	@ln -s /Applications $(BUILD_DIR)/dmgroot/Applications
	@cp Resources/安装说明.txt "$(BUILD_DIR)/dmgroot/使用说明.txt"
	@rm -f $(BUILD_DIR)/$(APP_NAME)-1.0-macOS-$(ARCH).dmg
	@hdiutil create -volname "$(APP_NAME)" -srcfolder $(BUILD_DIR)/dmgroot -ov -format UDZO \
		$(BUILD_DIR)/$(APP_NAME)-1.0-macOS-$(ARCH).dmg >/dev/null
	@echo "已生成 $(BUILD_DIR)/$(APP_NAME)-1.0-macOS-$(ARCH).dmg"

run: app
	open $(APP)

clean:
	rm -rf $(BUILD_DIR) .build
