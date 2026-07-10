import {useI18n} from "../../hooks/i18n.tsx";
import {useEffect, useState} from "react";
import {getConfigFilePath} from "../../lib/configFile.ts";
import {invoke} from "@tauri-apps/api/core";
import {Button, Label, ListBox, Select} from "@heroui/react";
import {Bug, FolderOpen} from "lucide-react";
import {debug} from "@tauri-apps/plugin-log";

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
        getConfigFilePath().then(setConfigPath).catch(() => setConfigPath(""));
        invoke<string>("get_log_dir").then(setLogDir).catch(() => setLogDir(""));
        invoke<boolean>("is_debug").then(setIsDebug).catch(() => setIsDebug(false));
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
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto pb-4 pl-1 pr-6">
                <h2 className="text-lg font-semibold mb-6">{t["Developer"]}</h2>

                <div className="flex flex-col gap-5">
                    {/* Config File Path */}
                    <div className="flex flex-row justify-between items-center w-full">
                        <div className="flex flex-col gap-1.5">
                            <Label>{t["Config File Path"]}</Label>
                            <p className="text-xs text-muted truncate flex-1" title={configPath}>
                                {configPath || "—"}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onPress={() => {
                                if (configPath) {
                                    invoke("open_in_file_manager", {path: configPath}).catch((e) => {
                                        debug(`Failed to open config file: ${e}`);
                                    });
                                }
                            }}
                        >
                            <FolderOpen size={15} />
                            {t["Open"]}
                        </Button>
                    </div>

                    {/* Log Directory */}
                    <div className="flex flex-row justify-between items-center w-full">
                        <div className="flex flex-col gap-1.5">
                            <Label>{t["Log Directory"]}</Label>
                            <p className="text-xs text-muted truncate flex-1" title={logDir}>
                                {logDir || "—"}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onPress={() => {
                                if (logDir) {
                                    invoke("open_in_file_manager", {path: logDir}).catch((e) => {
                                        debug(`Failed to open log directory: ${e}`);
                                    });
                                }
                            }}
                        >
                            <FolderOpen size={15} />
                            {t["Open"]}
                        </Button>
                    </div>

                    {/* DevTools */}
                    <div className="flex flex-row justify-between items-center w-full">
                        <div className="flex flex-col gap-1.5">
                            <Label>{t["DevTools"]}</Label>
                            <p className="text-xs text-muted">
                                Open the webview developer tools
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            isDisabled={!isDebug}
                            onPress={() => invoke("open_devtools").catch(() => {
                                console.log("DevTools command not available, use Ctrl+Shift+I");
                            })}
                        >
                            <Bug size={15} />
                            {t["Open"]}
                        </Button>
                    </div>

                    {/* Mock Update State — dev-only, drives the updater mock purely
                        via localStorage (see lib/updater.ts DEV MOCK). */}
                    {import.meta.env.DEV && (
                        <div className="flex flex-row justify-between items-center w-full">
                            <div className="flex flex-col gap-1.5">
                                <Label>{t["Mock Update State"]}</Label>
                                <p className="text-xs text-muted">
                                    {t["Simulate an update-check result for testing the update UI"]}
                                </p>
                            </div>
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
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
