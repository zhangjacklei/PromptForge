#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 PromptForge.xcodeproj（手写 pbxproj，不依赖 XcodeGen）。

为什么要生成而不是提交一个双击出来的工程：Xcode 自己写出的 pbxproj 里会带上
开发者 team、上次打开的设备、DerivedData 路径等本机痕迹；用脚本生成可以保证
仓库里只有工程结构，没有任何环境信息。

用法: python3 tools/gen_xcodeproj.py
产物: PromptForge.xcodeproj/project.pbxproj
"""
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.join(ROOT, 'PromptForge.xcodeproj')

SWIFT_FILES = [
    'PromptForgeApp.swift',
    'ContentView.swift',
    'LocalWebServer.swift',
    'WebAsset.swift',
    'ExportBridge.swift',
]

BUNDLE_PREFIX = 'io.github.promptforge'
MACOS_DEPLOY = '13.0'
IOS_DEPLOY = '16.0'


def oid(label):
    """稳定 24 位十六进制 ID —— 同一份输入每次生成结果一致，diff 才可读。"""
    return hashlib.md5(label.encode('utf-8')).hexdigest()[:24].upper()


# ---------- 目标定义 ----------

TARGETS = [
    {
        'key': 'macos',
        'name': 'PromptForge-macOS',
        'bundle_id': BUNDLE_PREFIX + '.app',
        'info_plist': 'Resources/Info-macOS.plist',
        'sdkroot': 'macosx',
        'platform': 'macosx',
        'deploy_key': 'MACOSX_DEPLOYMENT_TARGET',
        'deploy_val': MACOS_DEPLOY,
        'extra': [
            ('COMBINE_HIDPI_IMAGES', 'YES'),
            ('ENABLE_HARDENED_RUNTIME', 'YES'),
            ('INFOPLIST_KEY_NSHumanReadableCopyright', '"MIT License"'),
            ('MARKETING_VERSION', '1.0.0'),
            ('CURRENT_PROJECT_VERSION', '1'),
        ],
    },
    {
        'key': 'ios',
        'name': 'PromptForge-iOS',
        'bundle_id': BUNDLE_PREFIX + '.ios',
        'info_plist': 'Resources/Info-iOS.plist',
        'sdkroot': 'iphoneos',
        'platform': 'iphoneos iphonesimulator',
        'deploy_key': 'IPHONEOS_DEPLOYMENT_TARGET',
        'deploy_val': IOS_DEPLOY,
        'extra': [
            ('TARGETED_DEVICE_FAMILY', '"1,2"'),
            ('CODE_SIGN_STYLE', 'Automatic'),
            ('MARKETING_VERSION', '1.0.0'),
            ('CURRENT_PROJECT_VERSION', '1'),
        ],
    },
]


def build_pbxproj():
    lines = []
    add = lines.append

    add('// !$*UTF8*$!')
    add('{')
    add('\tarchiveVersion = 1;')
    add('\tclasses = {')
    add('\t};')
    add('\tobjectVersion = 56;')
    add('\tobjects = {')
    add('')

    # ---------- PBXBuildFile ----------
    add('/* Begin PBXBuildFile section */')
    for t in TARGETS:
        for f in SWIFT_FILES:
            add('\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };'
                % (oid('%s-build-%s' % (t['key'], f)), f, oid('file-source-' + f), f))
        add('\t\t%s /* web in Resources */ = {isa = PBXBuildFile; fileRef = %s /* web */; };'
            % (oid('%s-build-web' % t['key']), oid('file-web')))
        add('\t\t%s /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = %s /* Assets.xcassets */; };'
            % (oid('%s-build-assets' % t['key']), oid('file-assets')))
    add('/* End PBXBuildFile section */')
    add('')

    # ---------- PBXFileReference ----------
    add('/* Begin PBXFileReference section */')
    for f in SWIFT_FILES:
        add('\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = "<group>"; };'
            % (oid('file-source-' + f), f, f))
    add('\t\t%s /* web */ = {isa = PBXFileReference; lastKnownFileType = folder; path = web; sourceTree = "<group>"; };'
        % oid('file-web'))
    add('\t\t%s /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };'
        % oid('file-assets'))
    add('\t\t%s /* Info-macOS.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "Info-macOS.plist"; sourceTree = "<group>"; };'
        % oid('file-info-macos'))
    add('\t\t%s /* Info-iOS.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "Info-iOS.plist"; sourceTree = "<group>"; };'
        % oid('file-info-ios'))
    for t in TARGETS:
        add('\t\t%s /* %s.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = "%s.app"; sourceTree = BUILT_PRODUCTS_DIR; };'
            % (oid('product-' + t['key']), t['name'], t['name']))
    add('/* End PBXFileReference section */')
    add('')

    # ---------- PBXFrameworksBuildPhase ----------
    add('/* Begin PBXFrameworksBuildPhase section */')
    for t in TARGETS:
        add('\t\t%s /* Frameworks */ = {' % oid('%s-frameworks' % t['key']))
        add('\t\t\tisa = PBXFrameworksBuildPhase;')
        add('\t\t\tbuildActionMask = 2147483647;')
        add('\t\t\tfiles = (')
        add('\t\t\t);')
        add('\t\t\trunOnlyForDeploymentPostprocessing = 0;')
        add('\t\t};')
    add('/* End PBXFrameworksBuildPhase section */')
    add('')

    # ---------- PBXGroup ----------
    add('/* Begin PBXGroup section */')

    add('\t\t%s /* Sources */ = {' % oid('group-sources'))
    add('\t\t\tisa = PBXGroup;')
    add('\t\t\tchildren = (')
    for f in SWIFT_FILES:
        add('\t\t\t\t%s /* %s */,' % (oid('file-source-' + f), f))
    add('\t\t\t\t%s /* Resources */,' % oid('group-src-resources'))
    add('\t\t\t);')
    add('\t\t\tpath = "Sources/PromptForge";')
    add('\t\t\tsourceTree = "<group>";')
    add('\t\t};')

    add('\t\t%s /* Resources */ = {' % oid('group-src-resources'))
    add('\t\t\tisa = PBXGroup;')
    add('\t\t\tchildren = (')
    add('\t\t\t\t%s /* web */,' % oid('file-web'))
    add('\t\t\t);')
    add('\t\t\tpath = Resources;')
    add('\t\t\tsourceTree = "<group>";')
    add('\t\t};')

    add('\t\t%s /* App Resources */ = {' % oid('group-app-resources'))
    add('\t\t\tisa = PBXGroup;')
    add('\t\t\tchildren = (')
    add('\t\t\t\t%s /* Assets.xcassets */,' % oid('file-assets'))
    add('\t\t\t\t%s /* Info-macOS.plist */,' % oid('file-info-macos'))
    add('\t\t\t\t%s /* Info-iOS.plist */,' % oid('file-info-ios'))
    add('\t\t\t);')
    add('\t\t\tpath = Resources;')
    add('\t\t\tsourceTree = "<group>";')
    add('\t\t};')

    add('\t\t%s /* Products */ = {' % oid('group-products'))
    add('\t\t\tisa = PBXGroup;')
    add('\t\t\tchildren = (')
    for t in TARGETS:
        add('\t\t\t\t%s /* %s.app */,' % (oid('product-' + t['key']), t['name']))
    add('\t\t\t);')
    add('\t\t\tname = Products;')
    add('\t\t\tsourceTree = "<group>";')
    add('\t\t};')

    add('\t\t%s = {' % oid('group-main'))
    add('\t\t\tisa = PBXGroup;')
    add('\t\t\tchildren = (')
    add('\t\t\t\t%s /* Sources */,' % oid('group-sources'))
    add('\t\t\t\t%s /* App Resources */,' % oid('group-app-resources'))
    add('\t\t\t\t%s /* Products */,' % oid('group-products'))
    add('\t\t\t);')
    add('\t\t\tsourceTree = "<group>";')
    add('\t\t};')
    add('/* End PBXGroup section */')
    add('')

    # ---------- PBXNativeTarget ----------
    add('/* Begin PBXNativeTarget section */')
    for t in TARGETS:
        add('\t\t%s /* %s */ = {' % (oid('target-' + t['key']), t['name']))
        add('\t\t\tisa = PBXNativeTarget;')
        add('\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXNativeTarget "%s" */;'
            % (oid('%s-cfg-list' % t['key']), t['name']))
        add('\t\t\tbuildPhases = (')
        add('\t\t\t\t%s /* Sources */,' % oid('%s-sources-phase' % t['key']))
        add('\t\t\t\t%s /* Frameworks */,' % oid('%s-frameworks' % t['key']))
        add('\t\t\t\t%s /* Resources */,' % oid('%s-resources-phase' % t['key']))
        add('\t\t\t);')
        add('\t\t\tbuildRules = (')
        add('\t\t\t);')
        add('\t\t\tdependencies = (')
        add('\t\t\t);')
        add('\t\t\tname = %s;' % t['name'])
        add('\t\t\tproductName = %s;' % t['name'])
        add('\t\t\tproductReference = %s /* %s.app */;' % (oid('product-' + t['key']), t['name']))
        add('\t\t\tproductType = "com.apple.product-type.application";')
        add('\t\t};')
    add('/* End PBXNativeTarget section */')
    add('')

    # ---------- PBXProject ----------
    add('/* Begin PBXProject section */')
    add('\t\t%s /* Project object */ = {' % oid('project'))
    add('\t\t\tisa = PBXProject;')
    add('\t\t\tattributes = {')
    add('\t\t\t\tBuildIndependentTargetsInParallel = 1;')
    add('\t\t\t\tLastSwiftUpdateCheck = 1500;')
    add('\t\t\t\tLastUpgradeCheck = 1500;')
    add('\t\t\t\tTargetAttributes = {')
    for t in TARGETS:
        add('\t\t\t\t\t%s = {' % oid('target-' + t['key']))
        add('\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;')
        add('\t\t\t\t\t};')
    add('\t\t\t\t};')
    add('\t\t\t};')
    add('\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXProject "PromptForge" */;' % oid('project-cfg-list'))
    add('\t\t\tcompatibilityVersion = "Xcode 14.0";')
    add('\t\t\tdevelopmentRegion = en;')
    add('\t\t\thasScannedForEncodings = 0;')
    add('\t\t\tknownRegions = (')
    add('\t\t\t\ten,')
    add('\t\t\t\tBase,')
    add('\t\t\t\t"zh-Hans",')
    add('\t\t\t);')
    add('\t\t\tmainGroup = %s;' % oid('group-main'))
    add('\t\t\tproductRefGroup = %s /* Products */;' % oid('group-products'))
    add('\t\t\tprojectDirPath = "";')
    add('\t\t\tprojectRoot = "";')
    add('\t\t\ttargets = (')
    for t in TARGETS:
        add('\t\t\t\t%s /* %s */,' % (oid('target-' + t['key']), t['name']))
    add('\t\t\t);')
    add('\t\t};')
    add('/* End PBXProject section */')
    add('')

    # ---------- PBXResourcesBuildPhase ----------
    add('/* Begin PBXResourcesBuildPhase section */')
    for t in TARGETS:
        add('\t\t%s /* Resources */ = {' % oid('%s-resources-phase' % t['key']))
        add('\t\t\tisa = PBXResourcesBuildPhase;')
        add('\t\t\tbuildActionMask = 2147483647;')
        add('\t\t\tfiles = (')
        add('\t\t\t\t%s /* web in Resources */,' % oid('%s-build-web' % t['key']))
        add('\t\t\t\t%s /* Assets.xcassets in Resources */,' % oid('%s-build-assets' % t['key']))
        add('\t\t\t);')
        add('\t\t\trunOnlyForDeploymentPostprocessing = 0;')
        add('\t\t};')
    add('/* End PBXResourcesBuildPhase section */')
    add('')

    # ---------- PBXSourcesBuildPhase ----------
    add('/* Begin PBXSourcesBuildPhase section */')
    for t in TARGETS:
        add('\t\t%s /* Sources */ = {' % oid('%s-sources-phase' % t['key']))
        add('\t\t\tisa = PBXSourcesBuildPhase;')
        add('\t\t\tbuildActionMask = 2147483647;')
        add('\t\t\tfiles = (')
        for f in SWIFT_FILES:
            add('\t\t\t\t%s /* %s in Sources */,' % (oid('%s-build-%s' % (t['key'], f)), f))
        add('\t\t\t);')
        add('\t\t\trunOnlyForDeploymentPostprocessing = 0;')
        add('\t\t};')
    add('/* End PBXSourcesBuildPhase section */')
    add('')

    # ---------- XCBuildConfiguration ----------
    add('/* Begin XCBuildConfiguration section */')

    project_common = [
        ('ALWAYS_SEARCH_USER_PATHS', 'NO'),
        ('CLANG_ANALYZER_NONNULL', 'YES'),
        ('CLANG_ENABLE_MODULES', 'YES'),
        ('CLANG_ENABLE_OBJC_ARC', 'YES'),
        ('CLANG_WARN_BOOL_CONVERSION', 'YES'),
        ('CLANG_WARN_EMPTY_BODY', 'YES'),
        ('CLANG_WARN_UNREACHABLE_CODE', 'YES'),
        ('COPY_PHASE_STRIP', 'NO'),
        ('ENABLE_STRICT_OBJC_MSGSEND', 'YES'),
        ('GCC_C_LANGUAGE_STANDARD', 'gnu11'),
        ('GCC_NO_COMMON_BLOCKS', 'YES'),
        ('SWIFT_VERSION', '5.0'),
    ]

    for cfg, extra in (('Debug', [('DEBUG_INFORMATION_FORMAT', 'dwarf'),
                                  ('ENABLE_TESTABILITY', 'YES'),
                                  ('GCC_OPTIMIZATION_LEVEL', '0'),
                                  ('ONLY_ACTIVE_ARCH', 'YES'),
                                  ('SWIFT_ACTIVE_COMPILATION_CONDITIONS', 'DEBUG'),
                                  ('SWIFT_OPTIMIZATION_LEVEL', '"-Onone"')]),
                       ('Release', [('DEBUG_INFORMATION_FORMAT', '"dwarf-with-dsym"'),
                                    ('ENABLE_NS_ASSERTIONS', 'NO'),
                                    ('SWIFT_COMPILATION_MODE', 'wholemodule'),
                                    ('SWIFT_OPTIMIZATION_LEVEL', '"-O"')])):
        add('\t\t%s /* %s */ = {' % (oid('project-cfg-' + cfg), cfg))
        add('\t\t\tisa = XCBuildConfiguration;')
        add('\t\t\tbuildSettings = {')
        for k, v in project_common + extra:
            add('\t\t\t\t%s = %s;' % (k, v))
        add('\t\t\t};')
        add('\t\t\tname = %s;' % cfg)
        add('\t\t};')

    for t in TARGETS:
        for cfg in ('Debug', 'Release'):
            add('\t\t%s /* %s */ = {' % (oid('%s-cfg-%s' % (t['key'], cfg)), cfg))
            add('\t\t\tisa = XCBuildConfiguration;')
            add('\t\t\tbuildSettings = {')
            add('\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;')
            add('\t\t\t\tASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;')
            add('\t\t\t\tCODE_SIGN_STYLE = Automatic;')
            add('\t\t\t\tCURRENT_PROJECT_VERSION = 1;')
            add('\t\t\t\tENABLE_PREVIEWS = YES;')
            add('\t\t\t\tGENERATE_INFOPLIST_FILE = NO;')
            add('\t\t\t\tINFOPLIST_FILE = %s;' % t['info_plist'])
            add('\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (')
            add('\t\t\t\t\t"$(inherited)",')
            add('\t\t\t\t\t"@executable_path/../Frameworks",')
            add('\t\t\t\t);')
            add('\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = %s;' % t['bundle_id'])
            add('\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";')
            add('\t\t\t\tSDKROOT = %s;' % t['sdkroot'])
            add('\t\t\t\tSUPPORTED_PLATFORMS = "%s";' % t['platform'])
            add('\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;')
            add('\t\t\t\tSWIFT_VERSION = 5.0;')
            add('\t\t\t\t%s = %s;' % (t['deploy_key'], t['deploy_val']))
            for k, v in t['extra']:
                add('\t\t\t\t%s = %s;' % (k, v))
            add('\t\t\t};')
            add('\t\t\tname = %s;' % cfg)
            add('\t\t};')
    add('/* End XCBuildConfiguration section */')
    add('')

    # ---------- XCConfigurationList ----------
    add('/* Begin XCConfigurationList section */')
    add('\t\t%s /* Build configuration list for PBXProject "PromptForge" */ = {' % oid('project-cfg-list'))
    add('\t\t\tisa = XCConfigurationList;')
    add('\t\t\tbuildConfigurations = (')
    add('\t\t\t\t%s /* Debug */,' % oid('project-cfg-Debug'))
    add('\t\t\t\t%s /* Release */,' % oid('project-cfg-Release'))
    add('\t\t\t);')
    add('\t\t\tdefaultConfigurationIsVisible = 0;')
    add('\t\t\tdefaultConfigurationName = Release;')
    add('\t\t};')
    for t in TARGETS:
        add('\t\t%s /* Build configuration list for PBXNativeTarget "%s" */ = {' % (oid('%s-cfg-list' % t['key']), t['name']))
        add('\t\t\tisa = XCConfigurationList;')
        add('\t\t\tbuildConfigurations = (')
        add('\t\t\t\t%s /* Debug */,' % oid('%s-cfg-Debug' % t['key']))
        add('\t\t\t\t%s /* Release */,' % oid('%s-cfg-Release' % t['key']))
        add('\t\t\t);')
        add('\t\t\tdefaultConfigurationIsVisible = 0;')
        add('\t\t\tdefaultConfigurationName = Release;')
        add('\t\t};')
    add('/* End XCConfigurationList section */')
    add('')

    add('\t};')
    add('\trootObject = %s /* Project object */;' % oid('project'))
    add('}')
    return '\n'.join(lines) + '\n'


SCHEME_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1500" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{target_id}"
               BuildableName = "{product}.app"
               BlueprintName = "{name}"
               ReferencedContainer = "container:PromptForge.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target_id}"
            BuildableName = "{product}.app"
            BlueprintName = "{name}"
            ReferencedContainer = "container:PromptForge.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target_id}"
            BuildableName = "{product}.app"
            BlueprintName = "{name}"
            ReferencedContainer = "container:PromptForge.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
'''

WORKSPACE_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8"?>
<Workspace version = "1.0">
   <FileRef location = "self:">
   </FileRef>
</Workspace>
'''


def write_aux_files():
    workspace_dir = os.path.join(PROJ_DIR, 'project.xcworkspace')
    os.makedirs(workspace_dir, exist_ok=True)
    with open(os.path.join(workspace_dir, 'contents.xcworkspacedata'), 'w', encoding='utf-8') as f:
        f.write(WORKSPACE_TEMPLATE)

    schemes_dir = os.path.join(PROJ_DIR, 'xcshareddata', 'xcschemes')
    os.makedirs(schemes_dir, exist_ok=True)
    for t in TARGETS:
        body = SCHEME_TEMPLATE.format(target_id=oid('target-' + t['key']),
                                      product=t['name'], name=t['name'])
        with open(os.path.join(schemes_dir, t['name'] + '.xcscheme'), 'w', encoding='utf-8') as f:
            f.write(body)


def main():
    os.makedirs(PROJ_DIR, exist_ok=True)
    content = build_pbxproj()
    path = os.path.join(PROJ_DIR, 'project.pbxproj')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    write_aux_files()
    print('已生成', os.path.relpath(path, ROOT), len(content), 'bytes（含 2 个共享 scheme）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
