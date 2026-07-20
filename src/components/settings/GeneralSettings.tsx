import {useGlobalConfig} from "../../hooks/config.tsx";
import {languageNames, useI18n} from "../../hooks/i18n.tsx";
import {useEffect, useMemo, useState} from "react";
import {info} from "@tauri-apps/plugin-log";
import {Button, Label, ListBox, Select, Switch} from "@heroui/react";
import {isMacOS} from "../../lib/platform.ts";
import {useIsWayland} from "../../hooks/useIsWayland.ts";

export default function GeneralSettings({ borderColor, openAbout }: { borderColor: string, openAbout: () => void }) {
    const { config, updateConfig } = useGlobalConfig();
    const t = useI18n();
    // Wayland can't know or set absolute window position, so the "remember
    // window position" toggle is hidden there (it would be a no-op that
    // confuses users). Size still works on every platform.
    const isWayland = useIsWayland();

    const currentDefault = useMemo(() => {
        return config.profiles.find(p => p.default)?.name ?? config.profiles[0]?.name ?? "";
    }, [config.profiles]);

    const [draft, setDraft] = useState({
        language: config.language,
        showTabBar: config.showTabBar ?? false,
        closeWindowOnLastTab: config.closeWindowOnLastTab !== false,
        defaultProfile: currentDefault,
        copyWithCtrl: config.copyWithCtrl ?? false,
        autoUpdateOnStartup: config.autoUpdateOnStartup !== false,
        rememberWindowPosition: config.rememberWindowPosition ?? false,
        rememberWindowSize: config.rememberWindowSize ?? false,
    });

    // Reset draft when config changes externally
    useEffect(() => {
        setDraft({
            language: config.language,
            showTabBar: config.showTabBar ?? false,
            closeWindowOnLastTab: config.closeWindowOnLastTab !== false,
            defaultProfile: currentDefault,
            copyWithCtrl: config.copyWithCtrl ?? false,
            autoUpdateOnStartup: config.autoUpdateOnStartup !== false,
            rememberWindowPosition: config.rememberWindowPosition ?? false,
            rememberWindowSize: config.rememberWindowSize ?? false,
        });
    }, [config.language, config.showTabBar, config.closeWindowOnLastTab, config.copyWithCtrl, config.autoUpdateOnStartup, config.rememberWindowPosition, config.rememberWindowSize, currentDefault]);

    const isDirty =
        draft.language !== config.language ||
        draft.showTabBar !== (config.showTabBar ?? false) ||
        draft.closeWindowOnLastTab !== (config.closeWindowOnLastTab !== false) ||
        draft.copyWithCtrl !== (config.copyWithCtrl ?? false) ||
        draft.autoUpdateOnStartup !== (config.autoUpdateOnStartup !== false) ||
        draft.rememberWindowPosition !== (config.rememberWindowPosition ?? false) ||
        draft.rememberWindowSize !== (config.rememberWindowSize ?? false) ||
        draft.defaultProfile !== currentDefault;

    const handleSave = () => {
        info("General settings saved");
        const updated: Partial<typeof config> = {
            language: draft.language,
            showTabBar: draft.showTabBar,
            closeWindowOnLastTab: draft.closeWindowOnLastTab,
            copyWithCtrl: draft.copyWithCtrl,
            autoUpdateOnStartup: draft.autoUpdateOnStartup,
            rememberWindowPosition: draft.rememberWindowPosition,
            rememberWindowSize: draft.rememberWindowSize,
        };
        if (draft.defaultProfile !== currentDefault) {
            updated.profiles = config.profiles.map(p => ({
                ...p,
                default: p.name === draft.defaultProfile ? true : p.default ? false : undefined,
            }));
        }
        updateConfig(updated);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pb-4 pl-1 pr-6 w-full">
                <h2 className="text-lg font-semibold mb-6">{t["General"]}</h2>

                <div className="flex flex-col gap-5">
                    <div className="flex flex-col lg:flex-row gap-5">
                        {/* Language */}
                        <div className="flex flex-col gap-1.5 w-full grow">
                            <Label>{t["Language"]}</Label>
                            <Select
                                selectedKey={draft.language}
                                onSelectionChange={(key) => {
                                    if (key) {
                                        setDraft((prev) => ({ ...prev, language: key as "en-us" | "zh-cn" }));
                                    }
                                }}
                            >
                                <Select.Trigger>
                                    <Select.Value />
                                    <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        {[...languageNames.keys()].map((lang) => (
                                            <ListBox.Item id={lang} key={lang} textValue={lang}>
                                                {languageNames.get(lang)}
                                            </ListBox.Item>
                                        ))}
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </div>

                        {/* Default Profile */}
                        <div className="flex flex-col gap-1.5 w-full grow">
                            <Label>{t["Default Profile"]}</Label>
                            <Select
                                selectedKey={draft.defaultProfile}
                                onSelectionChange={(key) => {
                                    if (key) {
                                        setDraft((prev) => ({ ...prev, defaultProfile: key as string }));
                                    }
                                }}
                            >
                                <Select.Trigger>
                                    <Select.Value />
                                    <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        {config.profiles.map((p) => (
                                            <ListBox.Item id={p.name} key={p.name} textValue={p.name}>
                                                {p.name}
                                            </ListBox.Item>
                                        ))}
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </div>
                    </div>

                    {/* Show Tab Bar */}
                    <div className="flex flex-row items-center justify-between">
                        <Label className="cursor-pointer">
                            {t["Show Tab Bar"]}
                        </Label>
                        <Switch
                            isSelected={draft.showTabBar}
                            onChange={(v) => setDraft((prev) => ({ ...prev, showTabBar: v }))}
                        >
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch>
                    </div>

                    {/* Close Window on Last Tab */}
                    <div className="flex flex-row items-center justify-between">
                        <Label className="cursor-pointer">
                            {t["Close Window on Last Tab Closed"]}
                        </Label>
                        <Switch
                            isSelected={draft.closeWindowOnLastTab}
                            onChange={(v) => setDraft((prev) => ({ ...prev, closeWindowOnLastTab: v }))}
                        >
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch>
                    </div>

                    {/* Remember Window Position (hidden on Wayland — compositor
                        forbids knowing/setting absolute position, so it'd be
                        a no-op that only confuses users). */}
                    {!isWayland && (
                        <div className="flex flex-row items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                                <Label className="cursor-pointer">
                                    {t["Remember Window Position"]}
                                </Label>
                                <p className="text-xs text-muted">
                                    {t["Restore the window to its last position on startup"]}
                                </p>
                            </div>
                            <Switch
                                isSelected={draft.rememberWindowPosition}
                                onChange={(v) => setDraft((prev) => ({ ...prev, rememberWindowPosition: v }))}
                            >
                                <Switch.Control>
                                    <Switch.Thumb />
                                </Switch.Control>
                            </Switch>
                        </div>
                    )}

                    {/* Remember Window Size */}
                    <div className="flex flex-row items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                            <Label className="cursor-pointer">
                                {t["Remember Window Size"]}
                            </Label>
                            <p className="text-xs text-muted">
                                {t["Restore the window to its last size on startup"]}
                            </p>
                        </div>
                        <Switch
                            isSelected={draft.rememberWindowSize}
                            onChange={(v) => setDraft((prev) => ({ ...prev, rememberWindowSize: v }))}
                        >
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch>
                    </div>

                    {/* Copy with Ctrl+C (non-macOS only) */}
                    {!isMacOS() && (
                        <div className="flex flex-row items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                                <Label className="cursor-pointer">
                                    {t["Copy with Ctrl+C"]}
                                </Label>
                                <p className="text-xs text-muted">
                                    {t["Swap Ctrl+C and Ctrl+Shift+C for copy and interrupt on non-macOS systems"]}
                                </p>
                            </div>
                            <Switch
                                isSelected={draft.copyWithCtrl}
                                onChange={(v) => setDraft((prev) => ({ ...prev, copyWithCtrl: v }))}
                            >
                                <Switch.Control>
                                    <Switch.Thumb />
                                </Switch.Control>
                            </Switch>
                        </div>
                    )}

                    {/* Auto-check for updates on startup */}
                    <div className="flex flex-row items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                            <Label className="cursor-pointer">
                                {t["Auto-check for updates on startup"]}
                            </Label>
                            <p className="text-xs text-muted">
                                {t["Check for available updates when the app starts"]}
                            </p>
                        </div>
                        <Switch
                            isSelected={draft.autoUpdateOnStartup}
                            onChange={(v) => setDraft((prev) => ({ ...prev, autoUpdateOnStartup: v }))}
                        >
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch>
                    </div>
                </div>
            </div>
            {/* Fixed bottom: Save */}
            <div className="shrink-0 border-t pt-3 pr-6" style={{ borderColor: borderColor }}>
                <div className="flex items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="primary"
                            isDisabled={!isDirty}
                            onPress={handleSave}
                        >
                            {t["Save"]}
                        </Button>
                        {isDirty && (
                            <span className="text-xs text-muted">{t["Unsaved changes"]}</span>
                        )}
                    </div>
                    <Button
                        variant="outline"
                        onPress={openAbout}
                    >
                        {t["About"]} Lumina Terminal
                    </Button>
                </div>
            </div>
        </div>
    );
}
