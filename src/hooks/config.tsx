import {createContext, ReactNode, useContext, useEffect, useState} from "react";
import {GlobalConfig} from "../types/config.ts";
import {LazyStore} from "@tauri-apps/plugin-store";
import {TerminalProfile} from "../types/terminal.ts";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {CONFIG_SAVE_PATH, DEFAULT_CONFIG} from "../constants.ts";
import { info, debug, error } from "@tauri-apps/plugin-log";

const store = new LazyStore(CONFIG_SAVE_PATH);

interface GlobalConfigContextType {
    config: GlobalConfig;
    updateConfig: (newConfig: Partial<GlobalConfig>) => void;
    newProfile: (profile: TerminalProfile) => void;
    isLoading: boolean;
}

export const GlobalConfigContext = createContext<GlobalConfigContextType | null>(null);

export function useGlobalConfig() {
    const context = useContext(GlobalConfigContext);
    if (!context) {
        throw new Error("useGlobalConfig must be used within a GlobalConfigProvider");
    }
    return context;
}

export function GlobalConfigProvider({ children }: { children: ReactNode }) {
    const [config, setConfig] = useState<GlobalConfig>(DEFAULT_CONFIG);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useEffect(() => {
        const loadConfig = async () => {
            info("Loading config...");
            const savedConfig = await store.get<GlobalConfig>("config");
            let loadedConfig = DEFAULT_CONFIG;
            if (savedConfig) {
                loadedConfig = { ...loadedConfig, ...savedConfig };
            }
            setConfig(loadedConfig);
            store.set("config", loadedConfig).then();
            info(`Config loaded: language=${loadedConfig.language}, profiles=${loadedConfig.profiles.length}`);
            setIsLoading(false);
            // Preload the global profile's font for ligature support so the
            // first terminal (and all subsequent ones sharing the global font)
            // find it already parsed — no startup lag from findFont + loadBuffer.
            // The module-level font cache in ligatures.ts dedupes this.
            if (loadedConfig.globalProfile?.ligatures && loadedConfig.globalProfile?.fontFamily) {
                import("../lib/ligatures.ts")
                    .then(({preloadFont}) => preloadFont(loadedConfig.globalProfile!.fontFamily!))
                    .catch(() => {});
            }
        };
        loadConfig().catch((e) => {
            error(`Failed to load config: ${e}`).catch(() => {});
            setIsLoading(false);
        });
    }, []);

    const saveConfig = (newConfig: GlobalConfig) => {
        store.set("config", newConfig).then(() => {
            store.save().then(undefined, (e: unknown) => {
                error(`Failed to persist config to disk: ${e}`).catch(() => {});
            });
        }).catch((e: unknown) => {
            error(`Failed to save config: ${e}`).catch(() => {});
        });
    };

    const updateConfig = (newConfig: Partial<GlobalConfig>) => {
        debug(`updateConfig: ${JSON.stringify(newConfig)}`);
        setConfig((prevState) => {
            const updated: GlobalConfig = {...prevState, ...newConfig};
            saveConfig(updated);
            return updated;
        });
    };

    const newProfile = (profile: TerminalProfile) => {
        setConfig((prevState) => {
            const isFirst = prevState.profiles.length === 0 && !profile.default;
            const updatedProfile = isFirst ? { ...profile, default: true } : profile;
            const updatedProfiles = [...prevState.profiles, updatedProfile];
            const updated: GlobalConfig = {...prevState, profiles: updatedProfiles};
            saveConfig(updated);
            return updated;
        });
    };

    useEffect(() => {
        if (!isLoading) {
            const window = getCurrentWindow();
            window.show().then(() => {
                window.setFocus().then(undefined, (e: unknown) => {
                    error(`Failed to set window focus: ${e}`).catch(() => {});
                });
                info("Window shown, config loaded");
            }).catch((e: unknown) => {
                error(`Failed to show window: ${e}`).catch(() => {});
            });
        }
    }, [isLoading]);

    return (
        <GlobalConfigContext.Provider value={{config, updateConfig, newProfile, isLoading}}>
            {children}
        </GlobalConfigContext.Provider>
    );
}
