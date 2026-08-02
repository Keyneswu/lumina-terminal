import {useI18n} from "../../hooks/i18n.tsx";
import {useEffect, useState} from "react";
import {getConfigFilePath} from "../../lib/configFile.ts";
import {invoke} from "@tauri-apps/api/core";
import {Button, Label, ListBox, Select} from "@heroui/react";
import {Bug, FolderOpen} from "lucide-react";
import {warn, error} from "@tauri-apps/plugin-log";
import SettingsShell from "../ui/SettingsShell.tsx";
import SettingRow from "../ui/SettingRow.tsx";
import SectionTitle from "../ui/SectionTitle.tsx";

// localStorage key + values kept in sync with the dev mock in lib/updater.ts.
const MOCK_KEY = "LUMINA_MOCK_UPDATE";
type MockValue = "available" | "upToDate" | "error" | "";

export default function DeveloperSettings() {
    const t = useI18n();
    const [configPath, setConfigPath] = useState("");
    const [logDir, setLogDir] = useState("");
    const [isDebug, setIsDebug] = useState(false);
    // Mock update state — read straight from localStorage, no real data involved.
    const [mockUpdate, setMockUpdate] = useState<MockValue>("");

    useEffect(() => {
        getConfigFilePath().then(setConfigPath).catch((e) => {
            error(`Failed to resolve config file path: ${e}`).catch(() => {});
            setConfigPath("");
        });
        invoke<string>("get_log_dir").then(setLogDir).catch((e) => {
            error(`Failed to resolve log directory: ${e}`).catch(() => {});
            setLogDir("");
        });
        invoke<boolean>("is_debug").then(setIsDebug).catch((e) => {
            error(`Failed to check debug mode: ${e}`).catch(() => {});
            setIsDebug(false);
        });
        setMockUpdate((localStorage.getItem(MOCK_KEY) ?? "") as MockValue);
    }, []);

    const applyMock = (value: MockValue) => {
        setMockUpdate(value);
        if (value === "") {
            localStorage.removeItem(MOCK_KEY);
        } else {
            localStorage.setItem(MOCK_KEY, value);
        }
    };

    return (
        <SettingsShell>
            <SectionTitle>{t["Developer"]}</SectionTitle>

            <div className="flex flex-col gap-5">
                {/* Config File Path */}
                <SettingRow
                    variant="action"
                    label={<Label>{t["Config File Path"]}</Label>}
                    description={<span className="truncate block" title={configPath}>{configPath || "—"}</span>}
                >
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onPress={() => {
                            if (configPath) {
                                invoke("open_in_file_manager", {path: configPath}).catch((e) => {
                                    warn(`Failed to open config file: ${e}`).catch(() => {});
                                });
                            }
                        }}
                    >
                        <FolderOpen size={15} />
                        {t["Open"]}
                    </Button>
                </SettingRow>

                {/* Log Directory */}
                <SettingRow
                    variant="action"
                    label={<Label>{t["Log Directory"]}</Label>}
                    description={<span className="truncate block" title={logDir}>{logDir || "—"}</span>}
                >
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onPress={() => {
                            if (logDir) {
                                invoke("open_in_file_manager", {path: logDir}).catch((e) => {
                                    warn(`Failed to open log directory: ${e}`).catch(() => {});
                                });
                            }
                        }}
                    >
                        <FolderOpen size={15} />
                        {t["Open"]}
                    </Button>
                </SettingRow>

                {/* DevTools */}
                <SettingRow
                    variant="action"
                    label={<Label>{t["DevTools"]}</Label>}
                    description={"Open the webview developer tools"}
                >
                    <Button
                        variant="outline"
                        size="sm"
                        isDisabled={!isDebug}
                        onPress={() => invoke("open_devtools").catch(() => {
                            warn("DevTools command not available, use Ctrl+Shift+I").catch(() => {});
                        })}
                    >
                        <Bug size={15} />
                        {t["Open"]}
                    </Button>
                </SettingRow>

                {/* Mock Update State — dev-only, drives the updater mock purely
                    via localStorage (see lib/updater.ts DEV MOCK). */}
                {import.meta.env.DEV && (
                    <SettingRow
                        variant="action"
                        label={<Label>{t["Mock Update State"]}</Label>}
                        description={t["Simulate an update-check result for testing the update UI"]}
                    >
                        <div className="w-40 shrink-0">
                            <Select
                                selectedKey={mockUpdate || "none"}
                                onSelectionChange={(key) => {
                                    applyMock((key === "none" ? "" : key) as MockValue);
                                }}
                            >
                                <Select.Trigger>
                                    <Select.Value />
                                    <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id="none" key="none" textValue="none">
                                            {t["None"]}
                                        </ListBox.Item>
                                        <ListBox.Item id="available" key="available" textValue="available">
                                            {t["Available"]}
                                        </ListBox.Item>
                                        <ListBox.Item id="upToDate" key="upToDate" textValue="upToDate">
                                            {t["Up to Date"]}
                                        </ListBox.Item>
                                        <ListBox.Item id="error" key="error" textValue="error">
                                            {t["Error"]}
                                        </ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </div>
                    </SettingRow>
                )}
            </div>
        </SettingsShell>
    );
}
